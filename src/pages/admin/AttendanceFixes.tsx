import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { must, useLoad } from '../../lib/useLoad'
import { useCurrentEvent } from '../../lib/useEvent'
import { classDates, sessionState, shortDate } from '../../lib/camp'
import { Card, Skeleton, TableWrap } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { loadCheckins, loadStudents } from '../instructor/data'
import type { Course, Session } from '../instructor/CourseLayout'
import { AdminHead, LoadError, Note } from './AdminBits'
import '../instructor/instructor.css'
import './phase6.css'

interface CourseRow {
  id: string
  short_code: string
  name: string
  event_id: string
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5L19 7" />
    </svg>
  )
}

/** Admin › Attendance Fixes (AdminAttendance mockup board). */
export function AttendanceFixes() {
  const { profile } = useAuth()
  const toast = useToast()
  const ev = useCurrentEvent()
  const eventId = ev.data?.event?.id ?? null
  const firstDay = ev.data?.settings?.first_day ?? null
  const [courseId, setCourseId] = useState<string | null>(null)

  const courses = useLoad(async () => {
    if (!eventId) return null
    return must(await supabase.from('courses').select('id, short_code, name, event_id').eq('event_id', eventId).eq('archived', false).order('sort').order('name')) as CourseRow[]
  }, [eventId])
  const course = courses.data?.find((c) => c.id === courseId) ?? courses.data?.[0] ?? null

  const { data, error, setData } = useLoad(async () => {
    if (!course) return null
    const rows = must(await supabase.from('sessions').select('id, number, attendance_codes(code)').eq('course_id', course.id).order('number')) as unknown as {
      id: string
      number: number
      attendance_codes: { code: string } | null
    }[]
    const dates = classDates(firstDay, rows.length)
    const sessions: Session[] = rows.map((r, i) => ({ id: r.id, number: r.number, date: dates[i], code: r.attendance_codes?.code ?? null }))
    const [students, checkins] = await Promise.all([loadStudents(course as Course), loadCheckins(sessions)])
    return { sessions, students, checkins }
  }, [course?.id, firstDay])

  async function toggle(personId: string, s: Session, present: boolean) {
    // Optimistic, then saved; put back if it fails.
    const flip = (on: boolean) =>
      setData((d) => {
        if (!d) return d
        const next = new Map(d.checkins)
        const set = new Set(next.get(personId) ?? [])
        if (on) set.add(s.id)
        else set.delete(s.id)
        next.set(personId, set)
        return { ...d, checkins: next }
      })
    flip(!present)
    const res = present
      ? await supabase.from('attendance').delete().eq('session_id', s.id).eq('person_id', personId)
      : await supabase.from('attendance').insert({ session_id: s.id, person_id: personId, fixed_by: profile?.id ?? null })
    if (res.error) {
      flip(present)
      toast('Something went wrong. Please try again.', 'error')
    }
  }

  return (
    <>
      <AdminHead title="Attendance Fixes">
        {courses.data && (
          <select className="p6select p6select--course" aria-label="Course" value={course?.id ?? ''} onChange={(e) => setCourseId(e.target.value)}>
            {courses.data.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
      </AdminHead>
      {(error || courses.error) && <LoadError message={(error || courses.error) as string} />}

      <Card>
        <div className="p6head">
          <h2>Class Codes</h2>
          <Note>Note: Codes are set by admins and shown to the course's instructors</Note>
        </div>
        {!data ? <Skeleton height={80} /> : <CodeFields key={course?.id} sessions={data.sessions} />}
      </Card>

      <Card>
        <div className="p6head">
          <h2>Attendance · {course?.name ?? ''}</h2>
          <span className="p6hint">Click a box to mark present or missed</span>
        </div>
        {!data ? (
          <Skeleton height={240} />
        ) : (
          <TableWrap sticky maxHeight={640}>
            <table className="itable atttable" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th>Student ID</th>
                  <th>First Name</th>
                  <th>Last Name</th>
                  {data.sessions.map((s) => (
                    <th key={s.id} className="c attcol">S{s.number}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.students.map((p) => {
                  const mine = data.checkins.get(p.id)
                  return (
                    <tr key={p.id}>
                      <td className="muted">{p.person_code}</td>
                      <td className="strong">{p.first_name}</td>
                      <td className="strong">{p.last_name}</td>
                      {data.sessions.map((s) => {
                        const yes = !!mine?.has(s.id)
                        const kind = yes ? 'yes' : sessionState(s.date) === 'past' ? 'no' : 'future'
                        const label = `${p.first_name} ${p.last_name}, S${s.number}: ${yes ? 'Checked in' : kind === 'no' ? 'Missed' : 'Upcoming'}`
                        return (
                          <td key={s.id} className="c attcol">
                            <button type="button" className={'attcell attcell--' + kind + ' p6attbtn'} aria-label={label} aria-pressed={yes} onClick={() => toggle(p.id, s, yes)}>
                              {yes && <Check />}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
                {data.students.length === 0 && (
                  <tr>
                    <td colSpan={3 + data.sessions.length} className="p6empty">No students in this course yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Note>Note: every change is logged in Edit Logs</Note>
      </Card>
    </>
  )
}

/** One code per session; each saves a moment after typing stops. */
function CodeFields({ sessions }: { sessions: Session[] }) {
  const toast = useToast()
  const [codes, setCodes] = useState<Record<string, string>>(() => Object.fromEntries(sessions.map((s) => [s.id, s.code ?? ''])))
  const [timers] = useState(() => new Map<string, ReturnType<typeof setTimeout>>())
  useEffect(() => () => timers.forEach((t) => clearTimeout(t)), [timers])

  function change(s: Session, v: string) {
    const code = v.toUpperCase().replace(/\s+/g, '')
    setCodes((c) => ({ ...c, [s.id]: code }))
    clearTimeout(timers.get(s.id))
    timers.set(
      s.id,
      setTimeout(async () => {
        const res = code
          ? await supabase.from('attendance_codes').upsert({ session_id: s.id, code })
          : await supabase.from('attendance_codes').delete().eq('session_id', s.id)
        if (res.error) toast('Something went wrong. Please try again.', 'error')
      }, 700),
    )
  }

  return (
    <div className="p6codes">
      {sessions.map((s) => (
        <label key={s.id} className="p6code">
          <span className="p6code__label">S{s.number}{s.date ? ` · ${shortDate(s.date)}` : ''}</span>
          <input className="p6code__input" value={codes[s.id] ?? ''} onChange={(e) => change(s, e.target.value)} aria-label={`Code for session ${s.number}`} spellCheck={false} autoCapitalize="characters" />
        </label>
      ))}
    </div>
  )
}
