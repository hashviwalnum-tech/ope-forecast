/**
 * Calendar days as "2026-01-15" strings, the shape the API takes, converted to
 * and from the Date a calendar picker works with. Kept apart from the picker
 * so it can be tested without a phone.
 */

/** "2026-01-15" -> a Date at local noon, so no timezone can move the day. */
export function isoToDate(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const d = new Date(`${iso}T12:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** A Date's own calendar day as "2026-01-15" — local, not UTC. */
export function dateToIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
