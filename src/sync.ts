import type { Timeline } from './types';
export function expectedPosition(t: Timeline, offset = 0, now = Date.now()) { return t.position + (t.playing ? Math.max(0, now + offset - t.at) / 1000 : 0); }
export function acceptSnapshot(current: {sourceRevision: number; timeline: Timeline} | null, incoming: {sourceRevision: number; timeline: Timeline}) { return !current || incoming.sourceRevision > current.sourceRevision || (incoming.sourceRevision === current.sourceRevision && incoming.timeline.revision >= current.timeline.revision); }
