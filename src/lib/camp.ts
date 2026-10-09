import { CAMP_WEEKDAYS } from './useEvent'

/** Midnight today, local time. */
export function today(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

/**
 * Class dates: classes meet Mondays, Wednesdays and Fridays, starting on the
 * first day of camp (set in Admin > Home Page Content > Links & Dates).
 * Session 1 is the first class day on or after the first day.
 */
export function classDates(firstDay: string | null, count: number): (Date | null)[] {
  if (!firstDay) return Array.from({ length: count }, () => null)
  const out: Date[] = []
  const d = new Date(firstDay + 'T00:00:00')
  while (out.length < count) {
    if (CAMP_WEEKDAYS.includes(d.getDay())) out.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

export const shortDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
export const dayDate = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

export type SessionState = 'past' | 'today' | 'upcoming'
export function sessionState(date: Date | null, now = new Date()): SessionState {
  if (!date) return 'upcoming'
  const t = today(now).getTime()
  return date.getTime() < t ? 'past' : date.getTime() === t ? 'today' : 'upcoming'
}

/**
 * The session to show as "today's": today's class if there is one, else the
 * next class, else (after camp) the last one.
 */
export function currentSession(dates: (Date | null)[], now = new Date()): number | null {
  if (!dates.length || !dates[0]) return null
  const t = today(now).getTime()
  const i = dates.findIndex((d) => d && d.getTime() >= t)
  return (i === -1 ? dates.length - 1 : i) + 1
}

/** "Jul 13, 9:00 AM" */
export function when(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** 9.4, 8.95 -> "9.0" style one decimal. */
export const oneDecimal = (n: number | null | undefined) => (n == null ? '—' : Number(n).toFixed(1))

/** Trims trailing zeros: 85.50 -> "85.5". */
export const num = (n: number | string | null | undefined) => (n == null || n === '' ? '' : String(Number(n)))
