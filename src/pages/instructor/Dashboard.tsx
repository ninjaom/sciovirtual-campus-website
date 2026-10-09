import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { supabase } from '../../lib/supabase'
import { must, useLoad } from '../../lib/useLoad'
import { currentSession, oneDecimal, shortDate } from '../../lib/camp'
import { loadPeople } from '../../lib/people'
import { Button, ButtonLink, Card, Skeleton } from '../../components/ui'
import { useCourse } from './CourseLayout'
import { loadCheckins, loadGradeItems, loadGrades, loadStudents, maxTotal, studentTotal } from './data'
import { Ava } from './bits'

interface Ratings {
  sessions: { number: number; average: number | null; responses: number }[]
  camp_average: number | null
  rank: number | null
  of: number
}

const bare = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')

export function Dashboard() {
  const { course, sessions, settings } = useCourse()
  const [showPw, setShowPw] = useState(false)

  const { data } = useLoad(async () => {
    const [ratings, host, posts, staff, items, students, grades, checkins] = await Promise.all([
      supabase.rpc('course_ratings', { p_course: course.id }),
      supabase.from('course_zoom_hosts').select('host_email, host_password').eq('course_id', course.id).maybeSingle(),
      supabase.from('announcements').select('id, author_id, body, created_at, announcement_comments(count)').eq('course_id', course.id).order('created_at', { ascending: false }).limit(2),
      supabase.from('course_staff').select('person:people(id, first_name, last_name, email)').eq('course_id', course.id),
      loadGradeItems(course),
      loadStudents(course),
      loadGrades(course),
      loadCheckins(sessions),
    ])
    const postRows = must(posts) as unknown as { id: string; author_id: string | null; body: string; created_at: string; announcement_comments: { count: number }[] }[]
    const staffRows = (must(staff) as unknown as { person: { id: string; first_name: string; last_name: string; email: string | null } | null }[])
      .map((r) => r.person)
      .filter((p): p is { id: string; first_name: string; last_name: string; email: string | null } => !!p)
      .sort((a, b) => a.first_name.localeCompare(b.first_name) || a.last_name.localeCompare(b.last_name))
    const people = await loadPeople([...postRows.map((p) => p.author_id), ...staffRows.map((s) => s.id)])

    const totals = students.map((s) => studentTotal(s.id, items, grades, checkins.get(s.id)?.size ?? 0)).filter((t) => t.hasScore || t.total > 0)
    return {
      ratings: must(ratings) as Ratings,
      host: must(host) as { host_email: string | null; host_password: string | null } | null,
      posts: postRows,
      staff: staffRows,
      people,
      avg: totals.length ? Math.round(totals.reduce((s, t) => s + t.total, 0) / totals.length) : null,
      high: totals.length ? Math.max(...totals.map((t) => t.total)) : null,
      max: maxTotal(items),
    }
  }, [course.id])

  // Previous rating: the last session with ratings, against the one before it.
  const rated = (data?.ratings.sessions ?? []).filter((s) => s.responses > 0 && s.average != null)
  const last = rated[rated.length - 1]
  const prev = rated[rated.length - 2]
  const change = last && prev ? Number(last.average) - Number(prev.average) : null

  const n = currentSession(sessions.map((s) => s.date))
  const todays = n ? sessions[n - 1] : null
  const principles = settings?.daily_principles ?? []
  const v = (x: ReactNode) => (data ? x : <Skeleton width={70} height={34} />)

  return (
    <>
      <section aria-label="Class numbers" className="istats">
        <div className="istat">
          <span className="istat__label">Previous Class Rating:</span>
          <span className="istat__value">{v(last ? oneDecimal(last.average) : '—')}</span>
          {change != null && (
            <span className={'istat__sub ' + (change >= 0 ? 'is-up' : 'is-down')}>
              {(change >= 0 ? '+' : '−') + Math.abs(change).toFixed(1)} vs previous session
            </span>
          )}
        </div>
        <div className="istat">
          <span className="istat__label">Camp Average:</span>
          <span className="istat__value">{v(oneDecimal(data?.ratings.camp_average))}</span>
          <span className="istat__sub">All Courses</span>
        </div>
        <div className="istat istat--blue">
          <span className="istat__label">Class Ranking</span>
          <span className="istat__value">{v(data?.ratings.rank ? `#${data.ratings.rank}` : '—')}</span>
          <span className="istat__sub">{data?.ratings.rank ? `${data.ratings.rank} of ${data.ratings.of} courses` : ' '}</span>
        </div>
        <div className="istat">
          <span className="istat__label">Your Avg. Student Score</span>
          <span className="istat__value">{v(data?.avg ?? '—')}</span>
          <span className="istat__sub">/ {data?.max ?? 1000}</span>
        </div>
        <div className="istat">
          <span className="istat__label">Highest Student Score</span>
          <span className="istat__value">{v(data?.high ?? '—')}</span>
          <span className="istat__sub">/ {data?.max ?? 1000}</span>
        </div>
      </section>

      <div className="irow">
        <div className="icol icol--main">
          <Card title="Important Links!">
            <div className="links">
              <div className="links__row">
                <span className="links__label">Zoom Link</span>
                {course.zoom_join_url ? (
                  <a href={course.zoom_join_url} target="_blank" rel="noreferrer">{bare(course.zoom_join_url)}</a>
                ) : (
                  <span className="links__val">—</span>
                )}
              </div>
              <div className="links__row">
                <span className="links__label">Zoom Host Email</span>
                <span className="links__val">{data ? data.host?.host_email ?? '—' : <Skeleton width={180} />}</span>
              </div>
              <div className="links__row">
                <span className="links__label">Zoom Host Password</span>
                <span className="pwshow">
                  <span className={showPw ? 'links__val' : 'pwshow__dots'}>{showPw ? data?.host?.host_password ?? '—' : '••••••••••'}</span>
                  {data?.host?.host_password && (
                    <Button size="sm" className="btn--teal-soft" onClick={() => setShowPw((x) => !x)}>
                      {showPw ? 'Hide' : 'Show'}
                    </Button>
                  )}
                </span>
              </div>
              <div className="links__row">
                <span className="links__label">Attendance Page</span>
                {settings?.attendance_url ? (
                  <a href={settings.attendance_url} target="_blank" rel="noreferrer">{bare(settings.attendance_url)}</a>
                ) : (
                  <span className="links__val">—</span>
                )}
              </div>
            </div>
            <span className="inote">
              Note: host details are visible to this course's instructors and admins only <b>(DO NOT SHARE)</b>
            </span>
          </Card>

          <Card title="Latest announcements" actions={<ButtonLink to="announcements">New announcement</ButtonLink>}>
            {!data && <Skeleton height={80} />}
            {data?.posts.map((p) => (
              <Link key={p.id} to="announcements" className="apreview">
                <div className="apreview__top">
                  <span className="apreview__who">{(p.author_id && data.people.get(p.author_id)?.name) || 'Instructor'}</span>
                  <span className="apreview__meta">
                    {shortDate(new Date(p.created_at))} · {p.announcement_comments[0]?.count ?? 0} {(p.announcement_comments[0]?.count ?? 0) === 1 ? 'comment' : 'comments'}
                  </span>
                </div>
                <span className="apreview__text">{p.body}</span>
              </Link>
            ))}
            {data && data.posts.length === 0 && <p className="inote" style={{ fontSize: 14 }}>No announcements yet</p>}
          </Card>
        </div>

        <div className="icol icol--side">
          {principles.length > 0 && (
            <section className="principles">
              <h2>Daily Principles!</h2>
              <div className="principles__list">
                {principles.map((p) => <span key={p}>{p}</span>)}
              </div>
            </section>
          )}

          <Card title="Today's Attendance Code">
            {todays ? (
              <div className="codebox">
                <span className="codebox__label">
                  Session {todays.number}
                  {todays.date ? ` · ${shortDate(todays.date)}` : ''}
                </span>
                <span className="codebox__code">{todays.code ?? '—'}</span>
              </div>
            ) : (
              <p className="inote" style={{ fontSize: 14 }}>Set the first day of camp to see session codes</p>
            )}
            <Link to="attendance" style={{ fontSize: 14, fontWeight: 600 }}>See all session codes</Link>
          </Card>

          <Card title="Instructor Roster">
            {!data && <Skeleton height={60} />}
            {data?.staff.map((s) => (
              <div key={s.id} className="person">
                <Ava person={data.people.get(s.id)} size={36} />
                <div className="person__text">
                  <span className="person__name">{s.first_name} {s.last_name}</span>
                  {s.email && <a href={`mailto:${s.email}`} className="person__sub">{s.email}</a>}
                </div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </>
  )
}
