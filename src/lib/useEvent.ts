import { supabase } from './supabase'
import { must, useLoad } from './useLoad'

export interface Settings {
  event_id: string
  leaderboard_state: 'live' | 'frozen' | 'hidden'
  leaderboard_top_n: number
  course_top_n: number
  credits_per_point: number
  takeover_bonus: number
  admin_id_prefix: string
  first_day: string | null
  last_day: string | null
  sessions_per_course: number
  courses_that_count: number
  faq_url: string | null
  attendance_url: string | null
}

export interface CampEvent {
  id: string
  name: string
  year: number
  is_current: boolean
}

/** The current camp and its settings. */
export function useCurrentEvent() {
  return useLoad(async () => {
    const event = must(await supabase.from('events').select('id, name, year, is_current').eq('is_current', true).maybeSingle()) as CampEvent | null
    if (!event) return { event: null, settings: null }
    const settings = must(await supabase.from('settings').select('*').eq('event_id', event.id).maybeSingle()) as Settings | null
    return { event, settings }
  })
}

/**
 * "Day 4 of Camp · Mon, Jul 13". Camp days are Mondays, Wednesdays and
 * Fridays (matching the mockup: Jul 6 is day 1, Jul 13 is day 4).
 * Nothing is shown before the first day or after the last day.
 */
export const CAMP_WEEKDAYS = [1, 3, 5]

export function campDayLabel(firstDay: string | null, lastDay: string | null, now = new Date()): string | null {
  if (!firstDay) return null
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const start = new Date(firstDay + 'T00:00:00')
  if (today < start) return null
  if (lastDay && today > new Date(lastDay + 'T00:00:00')) return null
  if (!CAMP_WEEKDAYS.includes(today.getDay())) return null
  let n = 0
  for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) if (CAMP_WEEKDAYS.includes(d.getDay())) n++
  const label = today.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return `Day ${n} of Camp · ${label}`
}
