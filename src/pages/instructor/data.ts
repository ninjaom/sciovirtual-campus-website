import { supabase } from '../../lib/supabase'
import { must } from '../../lib/useLoad'
import type { Course, Session } from './CourseLayout'

export interface GradeItem {
  id: string
  name: string
  kind: 'manual' | 'attendance'
  max_points: number
  points_per_session: number | null
  sort: number
}
export interface Student {
  id: string
  person_code: string
  first_name: string
  last_name: string
  grade: number | null
  school: string | null
  city: string | null
  state: string | null
  student_email: string | null
  parent_email: string | null
}

/** The course's grade items: its own set when overridden, else the shared set. */
export async function loadGradeItems(course: Course): Promise<GradeItem[]> {
  const own = must(await supabase.from('grade_items').select('id, name, kind, max_points, points_per_session, sort').eq('course_id', course.id).order('sort')) as GradeItem[]
  if (own.length) return own
  return must(
    await supabase.from('grade_items').select('id, name, kind, max_points, points_per_session, sort').eq('event_id', course.event_id).is('course_id', null).order('sort'),
  ) as GradeItem[]
}

export async function loadStudents(course: Course): Promise<Student[]> {
  const rows = must(
    await supabase
      .from('enrollments')
      .select('person:people(id, person_code, first_name, last_name, grade, school, city, state, student_email, parent_email)')
      .eq('course_id', course.id),
  ) as unknown as { person: Student | null }[]
  return rows
    .map((r) => r.person)
    .filter((p): p is Student => !!p)
    .sort((a, b) => a.person_code.localeCompare(b.person_code))
}

/** person id -> set of session ids they checked in to. */
export async function loadCheckins(sessions: Session[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>()
  if (!sessions.length) return out
  const rows: { person_id: string; session_id: string }[] = []
  for (let from = 0; ; from += 1000) {
    const page = must(
      await supabase.from('attendance').select('person_id, session_id').in('session_id', sessions.map((s) => s.id)).range(from, from + 999),
    ) as { person_id: string; session_id: string }[]
    rows.push(...page)
    if (page.length < 1000) break
  }
  for (const r of rows) {
    if (!out.has(r.person_id)) out.set(r.person_id, new Set())
    out.get(r.person_id)!.add(r.session_id)
  }
  return out
}

/** gradeKey(person, item) -> points */
export const gradeKey = (person: string, item: string) => person + ':' + item

export async function loadGrades(course: Course): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (let from = 0; ; from += 1000) {
    const page = must(
      await supabase.from('grades').select('person_id, grade_item_id, points').eq('course_id', course.id).range(from, from + 999),
    ) as { person_id: string; grade_item_id: string; points: number }[]
    for (const g of page) out.set(gradeKey(g.person_id, g.grade_item_id), Number(g.points))
    if (page.length < 1000) break
  }
  return out
}

export function attendancePoints(item: GradeItem, attended: number): number {
  return Math.min(attended * (item.points_per_session ?? 0), item.max_points)
}

export interface Totals {
  total: number
  hasScore: boolean
}

/** A student's course total: entered scores plus calculated attendance. */
export function studentTotal(personId: string, items: GradeItem[], grades: Map<string, number>, attended: number): Totals {
  let total = 0
  let hasScore = false
  for (const it of items) {
    if (it.kind === 'attendance') total += attendancePoints(it, attended)
    else {
      const v = grades.get(gradeKey(personId, it.id))
      if (v != null) {
        total += v
        hasScore = true
      }
    }
  }
  return { total, hasScore }
}

export const maxTotal = (items: GradeItem[]) => items.reduce((s, i) => s + Number(i.max_points), 0)
