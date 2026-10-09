import { Link } from 'react-router'
import { supabase } from '../../lib/supabase'
import { must, useLoad } from '../../lib/useLoad'
import { useCurrentEvent, campDayLabel } from '../../lib/useEvent'
import { ButtonLink, Card, Skeleton } from '../../components/ui'
import { AdminHead, LoadError } from './AdminBits'

interface OverviewData {
  students: number
  students_signed_up: number
  instructors: number
  instructors_signed_up: number
  courses: number
  leaderboard_state: 'live' | 'frozen' | 'hidden' | null
  leaderboard_updated: string | null
  first_day: string | null
  missing_scores: { item: string; courses: number }[]
  feedback_missing: ('midpoint' | 'final')[]
  activity: { who: string; at: string; what: string }[]
}

const STATE_LABEL = { live: 'Live', frozen: 'Frozen', hidden: 'Frozen & Hidden' } as const

export function formatWhen(iso: string): string {
  const d = new Date(iso)
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ', ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  )
}

export function Overview() {
  const ev = useCurrentEvent()
  const { data, error, loading } = useLoad(async () => must(await supabase.rpc('admin_overview')) as OverviewData)

  const s = ev.data?.settings
  const eyebrow = campDayLabel(s?.first_day ?? null, s?.last_day ?? null) ?? ev.data?.event?.name
  const started = !!s?.first_day && new Date(s.first_day + 'T00:00:00') <= new Date()

  const attention: { text: string; to: string }[] = []
  if (data) {
    if (started)
      for (const m of data.missing_scores)
        attention.push({ text: `${m.courses} ${m.courses === 1 ? 'course has' : 'courses have'} no ${m.item} scores yet`, to: '/admin/grade-items' })
    for (const k of data.feedback_missing)
      if (started) attention.push({ text: `${k === 'final' ? 'Final' : 'Midpoint'} feedback hasn't been imported`, to: '/admin/feedback' })
  }

  return (
    <>
      <AdminHead eyebrow={eyebrow} title="Admin Overview">
        <ButtonLink to="/admin/announcements">Post Announcement</ButtonLink>
        <ButtonLink to="/admin/leaderboard" variant="secondary">
          Enter Points
        </ButtonLink>
      </AdminHead>
      {error && <LoadError message={error} />}

      <section aria-label="Camp numbers" className="stats">
        <div className="stat">
          <span className="stat__label">Student Count</span>
          <span className="stat__value">{loading || !data ? <Skeleton width={70} height={34} /> : data.students}</span>
          <span className="stat__sub">{data ? `[${data.students_signed_up} Signed Up]` : ' '}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Instructor Count</span>
          <span className="stat__value">{loading || !data ? <Skeleton width={70} height={34} /> : data.instructors}</span>
          <span className="stat__sub">{data ? `${data.instructors_signed_up} Finished Onboarding` : ' '}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Courses</span>
          <span className="stat__value">{loading || !data ? <Skeleton width={70} height={34} /> : data.courses}</span>
          <span className="stat__sub">Offered</span>
        </div>
        <Link to="/admin/leaderboard" className="stat stat--blue" style={{ textDecoration: 'none' }}>
          <span className="stat__label">Leaderboard</span>
          <span className="stat__value">{data?.leaderboard_state ? STATE_LABEL[data.leaderboard_state] : ' '}</span>
          <span className="stat__sub">{data?.leaderboard_updated ? `Last Updated ${formatWhen(data.leaderboard_updated)}` : ' '}</span>
        </Link>
      </section>

      <div className="arow">
        <Card title="Needs Attention [URGENT]">
          {attention.length === 0 ? (
            <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>[Nothing needs attention right now]</p>
          ) : (
            attention.map((a) => (
              <Link key={a.text} to={a.to} className="attn">
                <span className="attn__left">
                  <span className="attn__dot" aria-hidden="true" />
                  <span>{a.text}</span>
                </span>
                <span aria-hidden="true">→</span>
              </Link>
            ))
          )}
        </Card>
        <Card title="Recent Activity" className="activity">
          {data && data.activity.length === 0 && <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>[No activity yet]</p>}
          {data?.activity.map((a, i) => (
            <div key={i} className="act">
              <div className="act__top">
                <span className="act__who">{a.who}</span>
                <span className="act__at">{formatWhen(a.at)}</span>
              </div>
              <span className="act__what">{a.what}</span>
            </div>
          ))}
          <Link to="/admin/logs" className="act__more">
            See all edit logs
          </Link>
        </Card>
      </div>
    </>
  )
}
