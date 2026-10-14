export type Member = { id: string; nickname: string; owner: boolean; online: boolean; status: string };
export type Timeline = { revision: number; position: number; at: number; playing: boolean; actor: string };
export type Room = { id: string; invite: string; source: { videoId: string; url: string } | null; sourceRevision: number; timeline: Timeline; members: Member[]; chat: { id: string; memberId: string; nickname: string; text: string; at: number }[]; locked: boolean; serverNow: number };
export type Session = { roomId: string; credential: string; memberId: string };
export type Player = { playVideo(): void; pauseVideo(): void; seekTo(time: number, allowSeekAhead: boolean): void; cueVideoById(id: string): void; getCurrentTime(): number; getDuration(): number; getPlayerState(): number; setPlaybackRate(rate: number): void; destroy(): void };
declare global { interface Window { YT: { Player: new (element: HTMLElement, config: unknown) => Player }; onYouTubeIframeAPIReady: () => void } }
