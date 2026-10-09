import { NavLink, Outlet, useLocation, useOutletContext, useParams } from 'react-router'
import { supabase } from '../../lib/supabase'
import { must, useLoad } from '../../lib/useLoad'
import { useCurrentEvent, type Settings } from '../../lib/useEvent'
import { classDates } from '../../lib/camp'
import { Skeleton } from '../../components/ui'
import './instructor.css'

export interface Course {
  id: string
  short_code: string
  name: string
  time_slot: string | null
  zoom_join_url: string | null
  event_id: string
}
export interface Session {
  id: string
  number: number
  date: Date | null
  code: string | null
}
export interface CourseCtx {
  course: Course
  sessions: Session[]
  settings: Settings | null
}

export const useCourse = () => useOutletContext<CourseCtx>()

const SECTIONS = [
  { to: '', label: 'Dashboard' },
  { to: 'scores', label: 'Scores' },
  { to: 'roster', label: 'Student Roster' },
  { to: 'attendance', label: 'Attendance' },
  { to: 'feedback', label: 'Feedback' },
  { to: 'announcements', label: 'Announcements' },
]

/** "COA · 1–2 PM ET" */
export const courseTag = (c: Course) => [c.short_code, c.time_slot].filter(Boolean).join(' · ')

export function CourseLayout() {
  const { code = '' } = useParams()
  const { pathname } = useLocation()
  const ev = useCurrentEvent()
  const eventId = ev.data?.event?.id ?? null
  const settings = ev.data?.settings ?? null

  const { data, error } = useLoad(async () => {
    if (!eventId) return null
    const course = must(
      await supabase.from('courses').select('id, short_code, name, time_slot, zoom_join_url, event_id').eq('event_id', eventId).ilike('short_code', code).maybeSingle(),
    ) as Course | null
    if (!course) return { course: null, sessions: [] }
    const rows = must(await supabase.from('sessions').select('id, number, attendance_codes(code)').eq('course_id', course.id).order('number')) as unknown as {
      id: string
      number: number
      attendance_codes: { code: string } | null
    }[]
    return { course, rows }
  }, [eventId, code])

  const base = `/course/${code}`
  const current = SECTIONS.find((s) => (s.to ? pathname.startsWith(`${base}/${s.to}`) : false)) ?? SECTIONS[0]
  const wide = current.to === 'scores' || current.to === 'roster' || current.to === 'attendance'

  if (error) return <main className="page"><p role="alert">Something went wrong loading this course. ({error})</p></main>
  if (data && !data.course) return <main className="page"><h1 style={{ color: 'var(--blue)' }}>Course not found</h1></main>

  const course = data?.course ?? null
  const rows = data && 'rows' in data ? data.rows : []
  const dates = classDates(settings?.first_day ?? null, rows.length)
  const sessions: Session[] = rows.map((r, i) => ({ id: r.id, number: r.number, date: dates[i], code: r.attendance_codes?.code ?? null }))

  return (
    <main className={'page' + (wide ? ' page--course-wide' : '')}>
      <div className="chead">
        <div className="chead__text">
          {course ? <span className="chead__tag">{courseTag(course)}</span> : <Skeleton width={120} height={26} />}
          <h1>{course?.name ?? <Skeleton width={220} height={34} />}</h1>
        </div>
        <nav aria-label="Course sections" className="csec">
          {SECTIONS.map((s) => (
            <NavLink key={s.label} to={s.to ? `${base}/${s.to}` : base} end={!s.to} className={({ isActive }) => 'csec__link' + (isActive ? ' is-active' : '')}>
              {s.label}
            </NavLink>
          ))}
        </nav>
        {/* Phones: the section tabs become a dropdown */}
        <div className="dd csec__dd">
          <button type="button" className="admin__ddbtn" aria-haspopup="true">
            <span className="admin__ddtext">
              <span className="admin__ddeyebrow">{course?.short_code ?? ''}</span>
              <span className="admin__ddcur">{current.label}</span>
            </span>
            <svg className="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          <div className="dd__menu csec__ddmenu" role="menu">
            {SECTIONS.map((s) => (
              <NavLink key={s.label} to={s.to ? `${base}/${s.to}` : base} end={!s.to} className={({ isActive }) => 'dd__item' + (isActive ? ' is-active' : '')}>
                {s.label}
              </NavLink>
            ))}
          </div>
        </div>
      </div>
      {course ? <Outlet context={{ course, sessions, settings } satisfies CourseCtx} /> : <Skeleton height={240} />}
    </main>
  )
}
