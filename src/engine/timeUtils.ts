/** All times are integer minutes since 00:00 of the operating day (IST). Values ≥ 1440 are next day. */
export const DAY = 1440;

export function parseHHMM(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`Invalid time "${s}" (expected HH:MM)`);
  const h = Number(m[1]); const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Invalid time "${s}"`);
  return h * 60 + min;
}

export function fmtTime(mins: number | null | undefined, opts: { dayMarker?: boolean } = {}): string {
  if (mins === null || mins === undefined || Number.isNaN(mins)) return '—';
  const dayOffset = Math.floor(mins / DAY);
  const m = ((mins % DAY) + DAY) % DAY;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  const marker = opts.dayMarker !== false && dayOffset !== 0 ? ` (${dayOffset > 0 ? '+' : ''}${dayOffset})` : '';
  return `${hh}:${mm}${marker}`;
}

export function fmtDuration(mins: number): string {
  const sign = mins < 0 ? '-' : '';
  const a = Math.abs(Math.round(mins));
  const h = Math.floor(a / 60); const m = a % 60;
  if (h === 0) return `${sign}${m}m`;
  return `${sign}${h}h ${String(m).padStart(2, '0')}m`;
}

export const fmtDelay = (m: number) => (m > 0 ? `+${m}m` : '0m');

/** Clock-hour bucket index containing minute t. */
export const hourBucket = (t: number) => Math.floor(t / 60);
/** First minute of the next clock hour after t's bucket. */
export const nextBucketStart = (t: number) => (Math.floor(t / 60) + 1) * 60;
export const inWindow = (t: number, start: number, end: number) => t >= start && t < end;
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
