import { Link } from 'react-router'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { must, useLoad } from '../../lib/useLoad'
import { campDayLabel, useCurrentEvent } from '../../lib/useEvent'
import { classDates, sessionState, when } from '../../lib/camp'
import { loadPeople, type PersonCard } from '../../lib/people'
import { Banner, ButtonA, ButtonLink, Card, EmptyState, Skeleton } from '../../components/ui'
import { QuickLinkRow, UpdateCard, type QuickLink, type Update } from '../instructor/InstructorHome'
import '../instructor/instructor.css'
import './student.css'

interface FeedPost {
  id: string
  author_id: string | null
  body: string
  created_at: string
  course: { short_code: string; name: string } | null
}
interface Standing {
  state: 'live' | 'frozen' | 'hidden'
  rank: number | null
  of: number
  total: number | null
  team: string | null
  team_rank: number | null
}
interface MyCourse {
  id: string
  short_code: string
  name: string
  time_slot: string | null
  zoom_join_url: string | null
  sessions: { number: number }[]
}

/** Latest course announcements, newest first, each linking to its course. */
function CourseFeed({ posts, people, linkBase, empty }: { posts: FeedPost[]; people: Map<string, PersonCard>; linkBase: string; empty: string }) {
  return (
    <section className="feed" aria-labelledby="feed-title">
      <h2 id="feed-title">Recent Course Announcements</h2>
      {posts.length === 0 && <EmptyState title={empty} />}
      {posts.map((p) => (
        <Link key={p.id} to={`${linkBase}/${p.course?.short_code ?? ''}${linkBase === '/course' ? '/announcements' : ''}`} className="feedrow">
          <div className="feedrow__top">
            <span className="feedrow__course">{p.course?.name}</span>
            <span className="feedrow__meta">
              {(p.author_id && people.get(p.author_id)?.name) || 'Instructor'} · {when(p.created_at)}
            </span>
          </div>
          <span className="feedrow__text">{p.body}</span>
        </Link>
      ))}
    </section>
  )
}

export function StudentHome() {
  const { profile } = useAuth()
  const ev = useCurrentEvent()
  const eventId = ev.data?.event?.id ?? null
  const s = ev.data?.settings ?? null
  const isAdmin = profile?.role === 'admin'
  const courseIds = isAdmin ? [] : (profile?.courses ?? []).map((c) => c.id)

  const { data } = useLoad(async () => {
    if (!eventId) return null
    const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
    const feedQuery = supabase
      .from('announcements')
      .select('id, author_id, body, created_at, course:courses(short_code, name)')
      .order('created_at', { ascending: false })
    const [updates, links, feed, courses, standing] = await Promise.all([
      supabase.from('camp_updates').select('id, author_id, title, body, attachments, pinned, created_at').eq('event_id', eventId).order('pinned', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('quick_links').select('id, label, page, url').eq('event_id', eventId).in('audience', isAdmin ? ['students', 'instructors', 'both'] : ['students', 'both']).order('sort'),
      isAdmin ? feedQuery.gte('created_at', since).limit(100) : feedQuery.limit(5),
      courseIds.length
        ? supabase.from('courses').select('id, short_code, name, time_slot, zoom_join_url, sessions(number)').in('id', courseIds).order('name')
        : Promise.resolve({ data: [], error: null }),
      isAdmin ? Promise.resolve({ data: null, error: null }) : supabase.rpc('get_my_standing'),
    ])
    const u = must(updates) as Update[]
    const f = must(feed) as unknown as FeedPost[]
    return {
      updates: u,
      links: must(links) as QuickLink[],
      feed: f,
      people: await loadPeople([...u.map((x) => x.author_id), ...f.map((x) => x.author_id)]),
      courses: must(courses) as unknown as MyCourse[],
      standing: must(standing) as Standing | null,
    }
  }, [eventId, isAdmin, courseIds.join()])

  const eyebrow = campDayLabel(s?.first_day ?? null, s?.last_day ?? null) ?? ev.data?.event?.name

  // Today's classes: a course is listed when one of its sessions falls today.
  const today = (data?.courses ?? [])
    .map((c) => {
      const dates = classDates(s?.first_day ?? null, c.sessions.length)
      const i = dates.findIndex((d) => sessionState(d) === 'today')
      return i === -1 ? null : { course: c, session: i + 1 }
    })
    .filter((x): x is { course: MyCourse; session: number } => !!x)
    .sort((a, b) => (a.course.time_slot ?? '').localeCompare(b.course.time_slot ?? ''))

  const st = data?.standing
  const showStanding = !isAdmin && st && st.state !== 'hidden' && st.rank != null

  return (
    <>
      <Banner eyebrow={eyebrow} title="Welcome Back!">
        {s?.faq_url && (
          <a href={s.faq_url} target="_blank" rel="noreferrer" className="faqbtn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.5 9a2.5 2.5 0 0 1 4.8 1c0 1.7-2.3 2-2.3 3.5" />
              <path d="M12 17h.01" />
            </svg>
            <span>FAQ</span>
          </a>
        )}
      </Banner>
      <main className="ihome">
        <div className="ihome__main">
          <h2>Camp Updates</h2>
          {!data && <Skeleton height={160} />}
          {data?.updates.map((u) => <UpdateCard key={u.id} u={u} author={u.author_id ? data.people.get(u.author_id) : null} />)}
          {data && data.updates.length === 0 && <EmptyState title="No camp updates yet" body="Check back soon" />}
          {data && (
            <CourseFeed
              posts={data.feed}
              people={data.people}
              linkBase={isAdmin ? '/course' : '/courses'}
              empty={isAdmin ? 'No course announcements in the past 48 hours' : 'No course announcements yet'}
            />
          )}
        </div>

        <aside className="ihome__side">
          {!isAdmin && (
            <Card title="Today's Schedule">
              {!data && <Skeleton height={100} />}
              {data && today.length === 0 && <p className="noclass">No Classes Today!</p>}
              {today.map(({ course, session }) => (
                <div key={course.id} className="todayrow">
                  <div className="todayrow__text">
                    <span className="todayrow__name">{course.name}</span>
                    <span className="sched__sub">{[course.time_slot, `Session ${session}`].filter(Boolean).join(' · ')}</span>
                  </div>
                  {course.zoom_join_url && (
                    <ButtonA href={course.zoom_join_url} target="_blank" rel="noreferrer" size="sm">
                      Join Zoom
                    </ButtonA>
                  )}
                </div>
              ))}
              {today.length > 0 && s?.attendance_url && (
                <ButtonA href={s.attendance_url} target="_blank" rel="noreferrer" variant="accent">
                  Attendance Form
                </ButtonA>
              )}
            </Card>
          )}

          {showStanding && st && (
            <section className="standing" aria-labelledby="standing-title">
              <h2 id="standing-title">Your Standing</h2>
              <div className="standing__grid">
                <div className="standing__tile">
                  <span className="standing__label">Camp Rank</span>
                  <span className="standing__value">#{st.rank}</span>
                  <span className="standing__sub">of {st.of}</span>
                </div>
                <div className="standing__tile">
                  <span className="standing__label">Total Points</span>
                  <span className="standing__value">{Math.round(Number(st.total ?? 0)).toLocaleString('en-US')}</span>
                  <span className="standing__sub">pts</span>
                </div>
              </div>
              {st.team && (
                <div className="standing__team">
                  <div className="standing__teamtext">
                    <span className="standing__label">Team</span>
                    <span className="standing__teamname">{st.team}</span>
                  </div>
                  {st.team_rank != null && <span className="standing__teamrank">#{st.team_rank}</span>}
                </div>
              )}
              <ButtonLink to="/leaderboard" variant="secondary">
                View Leaderboard
              </ButtonLink>
            </section>
          )}

          <Card title="Quick Links">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: -6 }}>
              {data?.links.map((l) => <QuickLinkRow key={l.id} link={l} />)}
            </div>
          </Card>
        </aside>
      </main>
    </>
  )
}
