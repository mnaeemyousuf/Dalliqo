/** Offset (minutes) of a time zone from UTC at a given instant, e.g. Asia/Karachi → 300. */
export function tzOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** [start, end) of the calendar day containing `at`, in the business time zone, as UTC instants. */
export function dayRange(timeZone: string, at = new Date()): { start: Date; end: Date } {
  const offset = tzOffsetMinutes(timeZone, at);
  const local = new Date(at.getTime() + offset * 60_000);
  const startLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const start = new Date(startLocal - offset * 60_000);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}
