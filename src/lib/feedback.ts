import { parseCsv } from './csv'

/** One course's results, as the instructor Feedback page shows them. */
export interface CourseResult {
  course_id: string
  questions: { question: string; average: number | null; camp_average: number | null }[]
  comments: { question: string; answers: string[] }[]
  responses: number
  class_rank: number | null
}
export interface FeedbackSummary {
  results: CourseResult[]
  responses: number
  unmatched: number
  ratingQuestions: string[]
  commentQuestions: string[]
  courseColumn: string | null
}

// Columns that aren't questions (never stored: names, emails, IDs)
const SKIP = /timestamp|e-?mail|student\s*id|^id$|first name|last name|^name$|username/i
const COURSE = /course|class/i

/**
 * Reads a Google Form responses export: finds the course column, treats
 * columns of 1-10 numbers as rating questions and text columns as comment
 * questions, and works out each course's averages, comments and rank (by
 * its average across all rating questions; a tie goes to the course whose
 * students earned more Bonus points, and courses still level share a rank).
 * Student IDs and names are read past and never kept.
 */
export function summarizeFeedback(
  csvText: string,
  courses: { id: string; short_code: string; name: string }[],
  bonusByCourse: Map<string, number> = new Map(),
): FeedbackSummary {
  const table = parseCsv(csvText).filter((r) => r.some((c) => c.trim() !== ''))
  const empty: FeedbackSummary = { results: [], responses: 0, unmatched: 0, ratingQuestions: [], commentQuestions: [], courseColumn: null }
  if (table.length < 2) return empty
  const headers = table[0].map((h) => h.trim())
  const rows = table.slice(1)
  const courseCol = headers.findIndex((h) => COURSE.test(h) && !SKIP.test(h))
  if (courseCol < 0) return { ...empty, responses: rows.length, unmatched: rows.length }

  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
  const byKey = new Map<string, string>()
  for (const c of courses) {
    byKey.set(norm(c.short_code), c.id)
    byKey.set(norm(c.name), c.id)
  }
  const match = (v: string): string | null => {
    const k = norm(v)
    if (!k) return null
    if (byKey.has(k)) return byKey.get(k)!
    // "Course A (COA)" or "COA - Course A"
    for (const c of courses) if (new RegExp(`\\b${c.short_code}\\b`, 'i').test(v) || k.includes(norm(c.name))) return c.id
    return null
  }

  const qCols = headers.map((_, i) => i).filter((i) => i !== courseCol && headers[i] && !SKIP.test(headers[i]))
  const isRating = (i: number) => {
    const vals = rows.map((r) => (r[i] ?? '').trim()).filter((v) => v !== '')
    if (!vals.length) return false
    const nums = vals.filter((v) => /^\d+(\.\d+)?$/.test(v) && Number(v) >= 0 && Number(v) <= 10)
    return nums.length / vals.length >= 0.9
  }
  const ratingCols = qCols.filter(isRating)
  const commentCols = qCols.filter((i) => !ratingCols.includes(i))

  const groups = new Map<string, string[][]>()
  let unmatched = 0
  for (const r of rows) {
    const id = match(r[courseCol] ?? '')
    if (!id) {
      unmatched++
      continue
    }
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id)!.push(r)
  }
  const matchedRows = [...groups.values()].flat()
  const avg = (list: string[][], i: number) => {
    const nums = list.map((r) => (r[i] ?? '').trim()).filter((v) => v !== '' && !Number.isNaN(Number(v))).map(Number)
    return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : null
  }
  const campAvg = new Map(ratingCols.map((i) => [i, avg(matchedRows, i)]))

  const results: CourseResult[] = [...groups.entries()].map(([course_id, list]) => ({
    course_id,
    responses: list.length,
    questions: ratingCols.map((i) => ({ question: headers[i], average: avg(list, i), camp_average: campAvg.get(i) ?? null })),
    comments: commentCols.map((i) => ({ question: headers[i], answers: list.map((r) => (r[i] ?? '').trim()).filter(Boolean) })),
    class_rank: null,
  }))
  // Rank: average of the course's rating-question averages; ties go to the
  // course with more total Bonus points, and are shared if those match too
  const score = (r: CourseResult) => {
    const xs = r.questions.map((q) => q.average).filter((x): x is number => x != null)
    return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1e6) / 1e6 : -1
  }
  const bonus = (r: CourseResult) => bonusByCourse.get(r.course_id) ?? 0
  const sorted = [...results].sort((a, b) => score(b) - score(a) || bonus(b) - bonus(a))
  sorted.forEach((r, i) => {
    const prev = sorted[i - 1]
    r.class_rank = prev && score(r) === score(prev) && bonus(r) === bonus(prev) ? prev.class_rank : i + 1
  })
  return {
    results,
    responses: rows.length,
    unmatched,
    ratingQuestions: ratingCols.map((i) => headers[i]),
    commentQuestions: commentCols.map((i) => headers[i]),
    courseColumn: headers[courseCol],
  }
}
