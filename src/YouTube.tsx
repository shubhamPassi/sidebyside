import { useEffect, useRef, useState } from 'react';
import type { Room, Player } from './types';
import { expectedPosition } from './sync';
import { StartupAlignment } from './startupAlignment';
import { trace, playbackDiagnostics, isAppleTouchDevice } from './diagnostics';
let api: Promise<void> | undefined;
function loadApi() { if (window.YT?.Player) return Promise.resolve(); return api ||= new Promise((resolve, reject) => { window.onYouTubeIframeAPIReady = resolve; const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api'; script.onerror = () => { api = undefined; reject(new Error('YouTube could not load. Check your internet connection and content blockers.')); }; document.head.append(script); }); }
type Props = { room: Room; memberId: string; online: boolean; offset: React.RefObject<number>; force: number; send: (msg: Record<string, unknown>) => void; onTime: (time: number, duration: number) => void };
export default function YouTube(props: Props) {
  const container = useRef<HTMLDivElement>(null); const player = useRef<Player | null>(null); const latest = useRef(props); latest.current = props;
  const suppression = useRef(0); const activated = useRef(false); const ready = useRef(false); const applied = useRef(''); const lastSample = useRef({ time: 0, at: 0 }); const stall = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const startup = useRef(new StartupAlignment());
  const seekResume = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activationPending = useRef(false);
  const appleTouch = isAppleTouchDevice(navigator.userAgent, navigator.maxTouchPoints);
  const [copiedDiagnostics, setCopiedDiagnostics] = useState(false);
  const [diagnosticsCopyFailed, setDiagnosticsCopyFailed] = useState(false);
  const [loaded, setLoaded] = useState(false); const [issue, setIssue] = useState(''); const [needsClick, setNeedsClick] = useState(true); const [drift, setDrift] = useState(0);
  function status(value: string) { trace('status', {status:value}); const p = latest.current; if (p.online) p.send({ type: 'status', status: value, sourceRevision: p.room.sourceRevision }); }
  function command(action: string, position?: number) { const p = latest.current; p.send({ type: 'control', action, position, revision: p.room.timeline.revision, sourceRevision: p.room.sourceRevision }); }
  function apply(force = false) {
    const p = latest.current; const yt = player.current; if (!yt || !ready.current || !activated.current || !p.online) return;
    const key = `${p.room.sourceRevision}:${p.room.timeline.revision}`; if (applied.current === key && !force) return;
    clearTimeout(seekResume.current);
    applied.current = key; suppression.current = Date.now() + 1800;
    trace('apply', { revision:p.room.timeline.revision, playing:p.room.timeline.playing, force });
    const time = expectedPosition(p.room.timeline, p.offset.current); const actual = yt.getCurrentTime();
    if (force || Math.abs(actual - time) > (appleTouch ? 1.5 : .35)) yt.seekTo(time, true);
    yt.setPlaybackRate(1);
    if (p.room.timeline.playing) { if (!appleTouch) startup.current.arm(yt.getDuration()); else startup.current.cancel(); yt.playVideo(); }
    else { startup.current.cancel(); yt.pauseVideo(); }
    lastSample.current = { time: yt.getCurrentTime(), at: Date.now() };
  }
  useEffect(() => {
    if (!props.room.source || !container.current) return;
    let disposed = false; ready.current = false; activated.current = false; activationPending.current = false; applied.current = ''; startup.current.cancel(); clearTimeout(seekResume.current); setLoaded(false); setIssue(''); setNeedsClick(true);
    const element = document.createElement('div'); container.current.replaceChildren(element);
    loadApi().then(() => {
      if (disposed) return;
      player.current = new window.YT.Player(element, { width: '100%', height: '100%', videoId: props.room.source!.videoId, playerVars: { controls: 1, playsinline: 1, origin: location.origin }, events: {
        onReady: () => { if (disposed) return; ready.current = true; setLoaded(true); },
        onAutoplayBlocked: () => { if (disposed) return; activationPending.current = false; startup.current.cancel(); trace('autoplay-blocked'); setNeedsClick(true); status('needs-interaction'); },
        onError: (e: { data: number }) => { if (disposed) return; const errors: Record<number, string> = { 2: 'This video link is invalid.', 5: 'Your browser could not play this video.', 100: 'This video is unavailable or private.', 101: 'The creator does not allow this video to be embedded.', 150: 'The creator does not allow this video to be embedded.', 153: 'YouTube could not identify this website. Use its configured HTTP/HTTPS address and allow referrer headers.' }; setIssue(errors[e.data] || `YouTube playback error (${e.data}).`); status('error'); },
        onStateChange: (e: { data: number }) => {
          if (disposed) return; clearTimeout(stall.current);
          const p = latest.current; const me = p.room.members.find(m => m.id === p.memberId);
          trace('player-event', { state:e.data, revision:p.room.timeline.revision, playing:p.room.timeline.playing, suppressed:Date.now()<suppression.current });
          if (e.data === 1 && (!activated.current || activationPending.current)) { activated.current = true; activationPending.current = false; setNeedsClick(false); status('ready'); suppression.current = Date.now() + 1800; if (p.room.timeline.playing) { applied.current = ''; apply(); } else player.current?.pauseVideo(); return; }
          if (e.data === 1 && activated.current) { setNeedsClick(false); if (me?.status !== 'ready' && me?.status !== 'waiting' && me?.status !== 'error') status('ready'); }
          if (e.data === 0 || me?.status === 'waiting' || me?.status === 'error') startup.current.cancel();
          if (!activated.current || !p.online || Date.now() < suppression.current || me?.status === 'waiting' || me?.status === 'error') return;
          if (e.data === 3 && p.room.timeline.playing) stall.current = setTimeout(() => { status('buffering'); }, 1500);
          if (e.data === 1 && !p.room.timeline.playing && me?.status === 'ready') command('play');
          if ((e.data === 2 || e.data === 0) && p.room.timeline.playing) command('pause');
        }
      } });
    }).catch(e => { if (!disposed) { setIssue(e.message); status('error'); } });
    return () => { disposed = true; clearTimeout(stall.current); clearTimeout(seekResume.current); player.current?.destroy(); player.current = null; };
  }, [props.room.sourceRevision]);
  useEffect(() => { apply(); }, [props.room.timeline.revision, loaded, props.online]);
  useEffect(() => { if (props.online && activated.current && ready.current) { status('ready'); apply(true); } }, [props.online]);
  useEffect(() => { if (props.force) apply(true); }, [props.force]);
  useEffect(() => {
    const interval = setInterval(() => {
      const yt = player.current; const p = latest.current; if (!yt || !ready.current) return;
      const time = yt.getCurrentTime(); const duration = yt.getDuration(); p.onTime(time, duration); const now = Date.now();
      setDrift(time - expectedPosition(p.room.timeline, p.offset.current));
      const sample = lastSample.current; const state = yt.getPlayerState(); const me = p.room.members.find(m => m.id === p.memberId);
      trace('sample', { state, position:time, expected:expectedPosition(p.room.timeline,p.offset.current), revision:p.room.timeline.revision, playing:p.room.timeline.playing, online:p.online, status:me?.status || 'unknown' });
      if (state === 1) {
        const target = startup.current.observe(time, duration, expectedPosition(p.room.timeline, p.offset.current), activated.current && p.online && p.room.timeline.playing && me?.status === 'ready', now);
        if (target !== null) {
          suppression.current = now + 1800;
          const revision = `${p.room.sourceRevision}:${p.room.timeline.revision}`;
          yt.seekTo(target, false); yt.playVideo();
          // Some IFrame players pause asynchronously while processing a seek.
          // One guarded follow-up restores the intended playing state; no retry loop.
          clearTimeout(seekResume.current);
          seekResume.current = setTimeout(() => {
            const latestProps = latest.current; const member = latestProps.room.members.find(m => m.id === latestProps.memberId);
            if (player.current === yt && latestProps.online && latestProps.room.timeline.playing && member?.status === 'ready' && `${latestProps.room.sourceRevision}:${latestProps.room.timeline.revision}` === revision && [2, 5].includes(yt.getPlayerState())) {
              suppression.current = Date.now() + 1800; yt.playVideo();
            }
          }, 250);
          lastSample.current = { time: yt.getCurrentTime(), at: now }; return;
        }
      }
      if (!p.online || !p.room.timeline.playing || me?.status === 'waiting' || me?.status === 'error' || me?.status === 'needs-interaction') startup.current.cancel();
      // A pause emitted inside the feedback-suppression window must not leave
      // this viewer silently paused while the room keeps playing.
      if (activated.current && p.online && me?.status === 'ready' && p.room.timeline.playing && state === 2 && now > suppression.current) {
        startup.current.cancel(); setNeedsClick(true); status('needs-interaction'); lastSample.current = { time, at: now }; return;
      }
      if (!appleTouch && document.visibilityState === 'visible' && activated.current && p.online && me?.status === 'ready' && now > suppression.current && sample.at && now - sample.at <= 2000 && (state === 1 || state === 2)) {
        const natural = sample.time + (state === 1 ? (now - sample.at) / 1000 : 0);
        // Detect discontinuities from native YouTube seeking. No periodic corrective seeks:
        // the official API cannot reliably distinguish ads from content.
        if (Math.abs(time - natural) > 2.5 && time > 0 && duration > 0) { suppression.current = now + 1800; command('seek', time); }
      }
      lastSample.current = { time, at: now };
    }, 800); return () => clearInterval(interval);
  }, []);
  const me = props.room.members.find(m => m.id === props.memberId);
  function activate() { const yt = player.current; if (!yt) return; if (activated.current && !needsClick && me?.status === 'ready') { status('ready'); return; } activationPending.current = true; startup.current.cancel(); suppression.current = Date.now() + 2500; status('preparing'); yt.playVideo(); }
  async function copyDiagnostics() { try { await navigator.clipboard.writeText(JSON.stringify(playbackDiagnostics(),null,2)); setCopiedDiagnostics(true); setDiagnosticsCopyFailed(false); } catch { setDiagnosticsCopyFailed(true); } }
  return <>
    <div className="video-frame" ref={container} aria-label="Official YouTube player" />
    <div className="player-readiness">
      <div><span className={`status-dot ${me?.status === 'ready' ? 'green' : 'amber'}`} /><span>{issue || (needsClick ? 'One quick click to get your player ready' : me?.status === 'waiting' ? 'Waiting together. Press Ready when your video or ad is finished.' : me?.status === 'buffering' ? 'Your player is buffering. Press Ready when it recovers.' : me?.status === 'ready' ? `Player ready${Math.abs(drift) > 2 ? ' · out of sync? Try Resync' : ''}` : 'Preparing your player…')}</span></div>
      <div>{!issue && <button className="button small" disabled={!loaded || !props.online} onClick={activate}>{needsClick ? 'Activate & ready' : 'I’m ready'}</button>}<button className="button small" onClick={copyDiagnostics}>{diagnosticsCopyFailed ? 'Copy failed' : copiedDiagnostics ? 'Copied' : 'Copy diagnostics'}</button></div>
    </div>
    {appleTouch && <p className="notice">On iPhone/iPad, tap Play inside the YouTube player once if activation is blocked. Keep this tab visible. Use the shared slider to seek and Resync deliberately; automatic catch-up seeks are disabled.</p>}
  </>;
}
