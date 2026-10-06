/** Small in-memory sliding-window limiter keyed by caller. Suitable for one control service. */
export class RateLimiter {
  private readonly buckets = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly windowMs = 60_000) {}

  /** Returns true when the request is allowed. */
  hit(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    let arr = this.buckets.get(key);
    if (!arr) {
      arr = [];
      this.buckets.set(key, arr);
    }
    while (arr.length && arr[0] < cutoff) arr.shift();
    if (arr.length >= this.limit) return false;
    arr.push(now);
    if (this.buckets.size > 50_000) this.sweep(now);
    return true;
  }

  private sweep(now: number): void {
    const cutoff = now - this.windowMs;
    for (const [k, arr] of this.buckets) {
      while (arr.length && arr[0] < cutoff) arr.shift();
      if (!arr.length) this.buckets.delete(k);
    }
  }
}
