import { useEffect, useRef, useState } from 'react';
import type { Room, Player } from './types';
import { expectedPosition } from './sync';
let api: Promise<void> | undefined;
function loadApi() { if (window.YT?.Player) return Promise.resolve(); return api ||= new Promise((resolve, reject) => { window.onYouTubeIframeAPIReady = resolve; const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api'; script.onerror = () => { api = undefined; reject(new Error('YouTube could not load. Check your internet connection and content blockers.')); }; document.head.append(script); }); }
type Props = { room: Room; memberId: string; online: boolean; offset: React.RefObject<number>; force: number; send: (msg: Record<string, unknown>) => void; onTime: (time: number, duration: number) => void };
export default function YouTube(props: Props) {
  const container = useRef<HTMLDivElement>(null); const player = useRef<Player | null>(null); const latest = useRef(props); latest.current = props;
  const suppression = useRef(0); const activated = useRef(false); const ready = useRef(false); const applied = useRef(''); const lastSample = useRef({ time: 0, at: 0 }); const stall = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [loaded, setLoaded] = useState(false); const [issue, setIssue] = useState(''); const [needsClick, setNeedsClick] = useState(true); const [drift, setDrift] = useState(0);
  function status(value: string) { const p = latest.current; if (p.online) p.send({ type: 'status', status: value, sourceRevision: p.room.sourceRevision }); }
  function command(action: string, position?: number) { const p = latest.current; p.send({ type: 'control', action, position, revision: p.room.timeline.revision, sourceRevision: p.room.sourceRevision }); }
  function apply(force = false) {
    const p = latest.current; const yt = player.current; if (!yt || !ready.current || !activated.current || !p.online) return;
    const key = `${p.room.sourceRevision}:${p.room.timeline.revision}`; if (applied.current === key && !force) return;
    applied.current = key; suppression.current = Date.now() + 1800;
    const time = expectedPosition(p.room.timeline, p.offset.current); const actual = yt.getCurrentTime();
    if (force || Math.abs(actual - time) > 1) yt.seekTo(time, true);
    yt.setPlaybackRate(1);
    if (p.room.timeline.playing) yt.playVideo(); else yt.pauseVideo();
    lastSample.current = { time, at: Date.now() };
  }
  useEffect(() => {
    if (!props.room.source || !container.current) return;
    let disposed = false; ready.current = false; activated.current = false; applied.current = ''; setLoaded(false); setIssue(''); setNeedsClick(true);
    const element = document.createElement('div'); container.current.replaceChildren(element);
    loadApi().then(() => {
      if (disposed) return;
      player.current = new window.YT.Player(element, { width: '100%', height: '100%', videoId: props.room.source!.videoId, playerVars: { controls: 1, playsinline: 1, origin: location.origin }, events: {
        onReady: () => { if (disposed) return; ready.current = true; setLoaded(true); },
        onAutoplayBlocked: () => { if (disposed) return; setNeedsClick(true); status('needs-interaction'); },
        onError: (e: { data: number }) => { if (disposed) return; const errors: Record<number, string> = { 2: 'This video link is invalid.', 5: 'Your browser could not play this video.', 100: 'This video is unavailable or private.', 101: 'The creator does not allow this video to be embedded.', 150: 'The creator does not allow this video to be embedded.', 153: 'YouTube could not identify this website. Use its configured HTTP/HTTPS address and allow referrer headers.' }; setIssue(errors[e.data] || `YouTube playback error (${e.data}).`); status('error'); },
        onStateChange: (e: { data: number }) => {
          if (disposed) return; clearTimeout(stall.current);
          const p = latest.current; const me = p.room.members.find(m => m.id === p.memberId);
          if (e.data === 1 && !activated.current) { activated.current = true; setNeedsClick(false); status('ready'); suppression.current = Date.now() + 1800; apply(true); return; }
          if (e.data === 1 && activated.current) { setNeedsClick(false); if (me?.status !== 'ready' && me?.status !== 'waiting' && me?.status !== 'error') status('ready'); }
          if (!activated.current || !p.online || Date.now() < suppression.current || me?.status === 'waiting' || me?.status === 'error') return;
          if (e.data === 3 && p.room.timeline.playing) stall.current = setTimeout(() => { status('buffering'); }, 1500);
          if (e.data === 1 && !p.room.timeline.playing && me?.status === 'ready') command('play');
          if ((e.data === 2 || e.data === 0) && p.room.timeline.playing) command('pause');
        }
      } });
    }).catch(e => { if (!disposed) { setIssue(e.message); status('error'); } });
    return () => { disposed = true; clearTimeout(stall.current); player.current?.destroy(); player.current = null; };
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
      if (activated.current && p.online && me?.status === 'ready' && now > suppression.current && sample.at && (state === 1 || state === 2)) {
        const natural = sample.time + (state === 1 ? (now - sample.at) / 1000 : 0);
        // Detect discontinuities from native YouTube seeking. No periodic corrective seeks:
        // the official API cannot reliably distinguish ads from content.
        if (Math.abs(time - natural) > 2.5 && time > 0 && duration > 0) { suppression.current = now + 1800; command('seek', time); }
      }
      lastSample.current = { time, at: now };
    }, 800); return () => clearInterval(interval);
  }, []);
  const me = props.room.members.find(m => m.id === props.memberId);
  function activate() { const yt = player.current; if (!yt) return; activated.current = true; suppression.current = Date.now() + 2500; yt.playVideo(); if (!props.room.timeline.playing) yt.pauseVideo(); setNeedsClick(false); status('ready'); applied.current = ''; apply(true); }
  return <>
    <div className="video-frame" ref={container} aria-label="Official YouTube player" />
    <div className="player-readiness">
      <div><span className={`status-dot ${me?.status === 'ready' ? 'green' : 'amber'}`} /><span>{issue || (needsClick ? 'One quick click to get your player ready' : me?.status === 'waiting' ? 'Waiting together. Press Ready when your video or ad is finished.' : me?.status === 'buffering' ? 'Your player is buffering. Press Ready when it recovers.' : me?.status === 'ready' ? `Player ready${Math.abs(drift) > 2 ? ' · out of sync? Try Resync' : ''}` : 'Preparing your player…')}</span></div>
      {!issue && <button className="button small" disabled={!loaded || !props.online} onClick={activate}>{needsClick ? 'Activate & ready' : 'I’m ready'}</button>}
    </div>
  </>;
}
