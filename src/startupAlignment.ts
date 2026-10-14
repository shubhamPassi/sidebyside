// One bounded recovery per explicit shared playback revision. This is not a
// periodic drift corrector: ads and ambiguous provider transitions need manual recovery.
export class StartupAlignment {
  private pending: { expires: number; duration: number; sample: { position: number; at: number } | null } | null = null;
  arm(duration: number, now = Date.now()) { this.pending = { expires: now + 12000, duration, sample: null }; }
  cancel() { this.pending = null; }
  observe(position: number, duration: number, expected: number, eligible: boolean, now = Date.now()): number | null {
    const p = this.pending; if (!p) return null;
    if (now > p.expires || !eligible || !Number.isFinite(position) || !Number.isFinite(expected) || duration <= 0 || p.duration <= 0 || Math.abs(duration - p.duration) > 1 || expected >= duration || position < 0) { this.cancel(); return null; }
    if (!p.sample) { p.sample = { position, at: now }; return null; }
    const elapsed = (now - p.sample.at) / 1000;
    if (elapsed < .35) return null;
    const progressing = position - p.sample.position;
    if (Math.abs(progressing - elapsed) > .3) { p.sample = { position, at: now }; return null; }
    // Finish after observing stable playback, whether or not a correction is needed.
    this.cancel(); const lag = expected - position;
    return lag > .35 && lag <= 4 ? expected : null;
  }
}
