import { Navigate, NavLink, useParams } from 'react-router'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { must, useLoad } from '../../lib/useLoad'
import { useCurrentEvent } from '../../lib/useEvent'
import { num } from '../../lib/camp'
import { loadPeople } from '../../lib/people'
import { ButtonA, Card, EmptyState, Skeleton } from '../../components/ui'
import { PostCard, useCoursePosts } from '../instructor/Announcements'
import { attendancePoints, loadGradeItems, maxTotal, type GradeItem } from '../instructor/data'
import type { Course } from '../instructor/CourseLayout'
import '../instructor/instructor.css'
import './student.css'

interface StudentCourse extends Course {
  days: string | null
  course_staff: { person_id: string }[]
}

/** /courses: go to the first course. */
export function MyCoursesIndex() {
  const { profile } = useAuth()
  const first = profile?.courses.slice().sort((a, b) => a.name.localeCompare(b.name))[0]
  if (!first) return <main className="page"><EmptyState title="You aren't in any courses yet" /></main>
  return <Navigate to={`/courses/${first.code}`} replace />
}

export function MyCourses() {
  const { code = '' } = useParams()
  const { profile } = useAuth()
  const me = profile!
  const ev = useCurrentEvent()
  const eventId = ev.data?.event?.id ?? null
  const s = ev.data?.settings ?? null
  const pills = me.courses.slice().sort((a, b) => a.name.localeCompare(b.name))

  const { data } = useLoad(async () => {
    if (!eventId) return null
    const course = must(
      await supabase.from('courses').select('id, short_code, name, time_slot, days, zoom_join_url, event_id, course_staff(person_id)').eq('event_id', eventId).ilike('short_code', code).maybeSingle(),
    ) as unknown as StudentCourse | null
    if (!course) return { course: null }
    const [items, grades, sessions, staff] = await Promise.all([
      loadGradeItems(course),
      supabase.from('grades').select('grade_item_id, points').eq('course_id', course.id).eq('person_id', me.id),
      supabase.from('sessions').select('id').eq('course_id', course.id),
      loadPeople(course.course_staff.map((c) => c.person_id)),
    ])
    const sessionIds = (must(sessions) as { id: string }[]).map((x) => x.id)
    const att = sessionIds.length
      ? (must(await supabase.from('attendance').select('id', { count: 'exact' }).eq('person_id', me.id).in('session_id', sessionIds)) as unknown[]).length
      : 0
    return {
      course,
      items,
      grades: new Map((must(grades) as { grade_item_id: string; points: number }[]).map((g) => [g.grade_item_id, Number(g.points)])),
      attended: att,
      staff: [...staff.values()].sort((a, b) => a.name.localeCompare(b.name)),
    }
  }, [eventId, code, me.id])

  const posts = useCoursePosts(data?.course?.id ?? '', me.id)

  if (data && !data.course) return <main className="page"><h1 style={{ color: 'var(--blue)' }}>Course not found</h1></main>
  const c = data?.course ?? null

  const value = (it: GradeItem) => (it.kind === 'attendance' ? attendancePoints(it, data?.attended ?? 0) : data?.grades.get(it.id) ?? null)
  const items = data?.items ?? []
  const total = items.reduce((sum, it) => sum + Number(value(it) ?? 0), 0)

  return (
    <main className="page">
      <nav aria-label="My courses" className="coursepills">
        {pills.map((p) => (
          <NavLink key={p.id} to={`/courses/${p.code}`} className={({ isActive }) => 'coursepill' + (isActive ? ' is-active' : '')}>
            {p.name}
          </NavLink>
        ))}
      </nav>

      <div className="chead">
        <div className="chead__text">
          {c ? <span className="chead__tag">{[c.time_slot, c.days].filter(Boolean).join(' · ') || c.short_code}</span> : <Skeleton width={160} height={26} />}
          <h1>{c?.name ?? <Skeleton width={220} height={34} />}</h1>
          {data?.staff && data.staff.length > 0 && <span className="chead__staff">{data.staff.map((p) => p.name).join(' · ')}</span>}
        </div>
        <div className="chead__btns">
          {c?.zoom_join_url && (
            <ButtonA href={c.zoom_join_url} target="_blank" rel="noreferrer" size="lg">
              Join Zoom
            </ButtonA>
          )}
          {s?.attendance_url && (
            <ButtonA href={s.attendance_url} target="_blank" rel="noreferrer" variant="accent" size="lg">
              Attendance Form
            </ButtonA>
          )}
        </div>
      </div>

      <div className="irow">
        <div className="icol" style={{ flex: '999 1 600px', gap: 20 }}>
          <h2>Announcements</h2>
          {(!data || !posts.data) && <Skeleton height={180} />}
          {posts.data?.posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              people={posts.data!.people}
              urls={posts.data!.urls}
              me={me.id}
              canManage={false}
              moderate={false}
              defaultOpen={p.announcement_comments.length > 0}
              editing={null}
              onEdit={() => {}}
              onEditChange={() => {}}
              onEditCancel={() => {}}
              onEditSave={() => {}}
              onDelete={() => {}}
              onChanged={posts.reload}
            />
          ))}
          {posts.data && posts.data.posts.length === 0 && <EmptyState title="No announcements yet" body="Your instructors will post here" />}
        </div>

        <aside className="icol" style={{ flex: '1 1 320px', gap: 20 }}>
          <Card title="Class Points" className="points">
            {!data ? (
              <Skeleton height={160} />
            ) : (
              <>
                <div className="points__total">
                  <span className="points__big">{num(total)}</span>
                  <span className="points__of">/ {maxTotal(items)}</span>
                </div>
                {items.map((it) => {
                  const v = value(it)
                  const pct = Math.max(0, Math.min(100, (Number(v ?? 0) / Number(it.max_points)) * 100))
                  const tone = it.kind === 'attendance' ? ' pbar__fill--att' : it.name.trim().toLowerCase() === 'bonus' ? ' pbar__fill--bonus' : ''
                  return (
                    <div key={it.id} className="pbar">
                      <div className="pbar__top">
                        <span className="pbar__name">{it.name}</span>
                        <span className="pbar__val">
                          {v == null ? '—' : num(v)} / {num(it.max_points)}
                        </span>
                      </div>
                      <div className="pbar__track" role="progressbar" aria-label={it.name} aria-valuemin={0} aria-valuemax={Number(it.max_points)} aria-valuenow={Number(v ?? 0)}>
                        <div className={'pbar__fill' + tone} style={{ width: pct + '%' }} />
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </Card>
        </aside>
      </div>
    </main>
  )
}
