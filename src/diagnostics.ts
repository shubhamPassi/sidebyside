const records: { at: string; event: string; values: Record<string, number | boolean | string> }[] = [];
export function trace(event: string, values: Record<string, number | boolean | string> = {}) {
  records.push({ at: new Date().toISOString(), event, values }); if (records.length > 180) records.shift();
}
export function playbackDiagnostics() { return { version: 'iphone-readiness-1', userAgent: navigator.userAgent, visible: document.visibilityState, events: [...records] }; }
if (typeof window !== 'undefined') Object.assign(window, { __watchDiagnostics: playbackDiagnostics });
export function isAppleTouchDevice(userAgent: string, touchPoints = 0) { return /iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && touchPoints > 1); }
