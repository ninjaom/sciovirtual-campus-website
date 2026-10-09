import { Link } from 'react-router'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { must, useLoad } from '../../lib/useLoad'
import { campDayLabel, useCurrentEvent } from '../../lib/useEvent'
import { classDates, currentSession, dayDate, sessionState, when } from '../../lib/camp'
import { loadPeople } from '../../lib/people'
import { Banner, ButtonA, ButtonLink, Card, Skeleton } from '../../components/ui'
import { Ava, FileIcon, LinkIcon, type Attachment } from './bits'
import './instructor.css'

interface Update {
  id: string
  author_id: string | null
  title: string
  body: string
  attachments: Attachment[]
  pinned: boolean
  created_at: string
}
interface QuickLink {
  id: string
  label: string
  page: string | null
  url: string | null
}
interface MyCourse {
  id: string
  short_code: string
  name: string
  time_slot: string | null
  zoom_join_url: string | null
  sessions: { number: number; attendance_codes: { code: string } | null }[]
}

const PAGE_ROUTES: Record<string, string> = {
  merchandise: '/merchandise',
  learn: '/learn',
  leaderboard: '/leaderboard',
  'past-resources': '/past-resources',
  courses: '/courses',
}

export function QuickLinkRow({ link }: { link: QuickLink }) {
  const arrow = <span aria-hidden="true">→</span>
  if (link.page && PAGE_ROUTES[link.page])
    return (
      <Link to={PAGE_ROUTES[link.page]} className="qlink">
        {link.label} {arrow}
      </Link>
    )
  return (
    <a href={link.url ?? '#'} target="_blank" rel="noreferrer" className="qlink">
      {link.label} {arrow}
    </a>
  )
}

export function UpdateCard({ u, author }: { u: Update; author?: Parameters<typeof Ava>[0]['person'] }) {
  return (
    <article className={'update' + (u.pinned ? ' is-pinned' : '')}>
      <div className="update__head">
        <div className="update__who">
          <Ava person={author} fallback="DR" />
          <div className="update__meta">
            <span className="update__name">{author?.name ?? 'Director'}</span>
            <span className="update__when">{when(u.created_at)}</span>
          </div>
        </div>
        {u.pinned && (
          <span className="pinned">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 17v5M9 3h6l-1 6 3 3H7l3-3z" />
            </svg>
            Pinned
          </span>
        )}
      </div>
      <h3>{u.title}</h3>
      <p className="update__body">{u.body}</p>
      {u.attachments.map((a, i) =>
        a.type === 'link' ? (
          <a key={i} href={a.url} target="_blank" rel="noreferrer" className="filechip">
            <LinkIcon />
            {a.label || a.url}
          </a>
        ) : (
          <span key={i} className="filechip">
            <FileIcon />
            {a.name}
          </span>
        ),
      )}
    </article>
  )
}

export function InstructorHome() {
  const { profile } = useAuth()
  const ev = useCurrentEvent()
  const eventId = ev.data?.event?.id ?? null
  const s = ev.data?.settings ?? null
  const courseIds = (profile?.courses ?? []).map((c) => c.id)

  const { data } = useLoad(async () => {
    if (!eventId) return null
    const [updates, reminders, links, courses] = await Promise.all([
      supabase.from('camp_updates').select('id, author_id, title, body, attachments, pinned, created_at').eq('event_id', eventId).order('pinned', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('reminders').select('id, body').eq('event_id', eventId).order('sort').order('created_at'),
      supabase.from('quick_links').select('id, label, page, url').eq('event_id', eventId).in('audience', ['instructors', 'both']).order('sort'),
      courseIds.length
        ? supabase.from('courses').select('id, short_code, name, time_slot, zoom_join_url, sessions(number, attendance_codes(code))').in('id', courseIds).order('name')
        : Promise.resolve({ data: [], error: null }),
    ])
    const u = must(updates) as Update[]
    return {
      updates: u,
      authors: await loadPeople(u.map((x) => x.author_id)),
      reminders: must(reminders) as { id: string; body: string }[],
      links: must(links) as QuickLink[],
      courses: must(courses) as unknown as MyCourse[],
    }
  }, [eventId, courseIds.join()])

  const eyebrow = campDayLabel(s?.first_day ?? null, s?.last_day ?? null) ?? ev.data?.event?.name

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
          {data?.updates.map((u) => <UpdateCard key={u.id} u={u} author={u.author_id ? data.authors.get(u.author_id) : null} />)}
          {data && data.updates.length === 0 && <Card><p className="inote" style={{ fontSize: 14 }}>No camp updates yet</p></Card>}
        </div>

        <aside className="ihome__side">
          <Card title="Important Reminders!">
            {data?.reminders.map((r) => <p key={r.id} className="reminder">{r.body}</p>)}
            {data && data.reminders.length === 0 && <p className="inote" style={{ fontSize: 14 }}>No reminders right now</p>}
          </Card>

          <Card title="Today's Schedule">
            {!data && <Skeleton height={120} />}
            {data?.courses.map((c) => {
              const sessions = [...c.sessions].sort((a, b) => a.number - b.number)
              const dates = classDates(s?.first_day ?? null, sessions.length)
              const n = currentSession(dates)
              const sess = n ? sessions[n - 1] : null
              const date = n ? dates[n - 1] : null
              const isToday = sessionState(date) === 'today'
              const sub = [c.time_slot, n ? `Session ${n}` : null, date && !isToday ? dayDate(date) : null].filter(Boolean).join(' · ')
              return (
                <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span className="sched__course">{c.name}</span>
                    {sub && <span className="sched__sub">{sub}</span>}
                  </div>
                  {sess?.attendance_codes?.code && (
                    <div className="codebox" style={{ padding: '14px 16px' }}>
                      <span className="codebox__label">Attendance Code</span>
                      <span className="codebox__code" style={{ fontSize: 20 }}>{sess.attendance_codes.code}</span>
                    </div>
                  )}
                  <div className="sched__btns">
                    {c.zoom_join_url && (
                      <ButtonA href={c.zoom_join_url} target="_blank" rel="noreferrer">
                        Join Zoom
                      </ButtonA>
                    )}
                    <ButtonLink to={`/course/${c.short_code}`} variant="secondary">
                      Open Dashboard
                    </ButtonLink>
                  </div>
                </div>
              )
            })}
          </Card>

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
