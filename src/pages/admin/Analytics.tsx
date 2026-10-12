import { useMemo, useState } from 'react'
import { useLoad } from '../../lib/useLoad'
import { useCurrentEvent } from '../../lib/useEvent'
import { postApiAuth } from '../../lib/api'
import { Card, EmptyState, Skeleton, TableWrap } from '../../components/ui'
import { AdminHead, LoadError } from './AdminBits'
import './phase6.css'

type Range = '14' | 'camp' | 'all'
interface Result {
  ok: boolean
  connected?: boolean
  error?: string
  days?: { date: string; views: number; visits: number }[]
  paths?: { path: string; views: number; visits: number }[]
}

// Page names for the paths people visit (anything else shows its path)
const PAGES: [RegExp, string][] = [
  [/^\/home\/?$/, 'Home'],
  [/^\/leaderboard\/?$/, 'Leaderboard'],
  [/^\/courses(\/|$)/, 'My Courses'],
  [/^\/course\//, 'Course Pages (instructors)'],
  [/^\/learn(\/|$)/, 'Learn'],
  [/^\/past-resources\/?$/, 'Past Resources'],
  [/^\/merchandise\/?$/, 'Merchandise'],
  [/^\/account\/?$/, 'Account'],
  [/^\/admin(\/|$)/, 'Admin'],
  [/^\/(sign-up|forgot-password|reset-password)?\/?$/, 'Sign In'],
]
const pageName = (path: string) => PAGES.find(([re]) => re.test(path))?.[1] ?? path

const iso = (d: Date) => d.toISOString().slice(0, 10)
const n = (x: number) => x.toLocaleString('en-US')

/** Admin › Analytics (AdminAnalytics mockup board). */
export function Analytics() {
  const ev = useCurrentEvent()
  const s = ev.data?.settings ?? null
  const [range, setRange] = useState<Range>('14')

  const span = useMemo(() => {
    const today = new Date()
    if (range === 'camp' && s?.first_day) {
      const end = s.last_day && new Date(s.last_day) < today ? s.last_day : iso(today)
      return { start: s.first_day, end: s.first_day > end ? s.first_day : end }
    }
    if (range === 'all') return { start: iso(new Date(Date.now() - 180 * 86_400_000)), end: iso(today) }
    return { start: iso(new Date(Date.now() - 13 * 86_400_000)), end: iso(today) }
  }, [range, s?.first_day, s?.last_day])

  const { data, error } = useLoad(() => postApiAuth<Result>('analytics', span), [span.start, span.end])

  const pages = useMemo(() => {
    const m = new Map<string, { views: number; visits: number }>()
    for (const p of data?.paths ?? []) {
      const k = pageName(p.path)
      const v = m.get(k) ?? { views: 0, visits: 0 }
      v.views += p.views
      v.visits += p.visits
      m.set(k, v)
    }
    return [...m].map(([page, v]) => ({ page, ...v })).sort((a, b) => b.views - a.views)
  }, [data])
  const days = data?.days ?? []
  const totals = { views: days.reduce((a, d) => a + d.views, 0), visits: days.reduce((a, d) => a + d.visits, 0) }
  const max = Math.max(1, ...days.map((d) => d.views))

  return (
    <>
      <AdminHead eyebrow="Page views from Cloudflare Web Analytics" title="Analytics">
        <select className="p6select p6select--soft" aria-label="Range" value={range} onChange={(e) => setRange(e.target.value as Range)}>
          <option value="14">Last 14 days</option>
          <option value="camp" disabled={!s?.first_day}>This camp</option>
          <option value="all">All time</option>
        </select>
      </AdminHead>
      {error && <LoadError message={error} />}

      {!data && !error && <Skeleton height={300} />}
      {data && !data.ok && <LoadError message={data.error === 'cloudflare' ? 'Cloudflare didn’t answer; try again in a minute' : data.error ?? 'server'} />}
      {data?.ok && data.connected === false && (
        <Card>
          <EmptyState title="Analytics isn't connected yet" body="Once the Cloudflare Web Analytics settings are added, page views show here." />
        </Card>
      )}

      {data?.ok && data.connected && (
        <>
          <section className="p6stats" aria-label="Totals">
            <div className="p6stat">
              <span className="p6stat__label">Page views</span>
              <span className="p6stat__value">{n(totals.views)}</span>
            </div>
            <div className="p6stat">
              <span className="p6stat__label">Visits</span>
              <span className="p6stat__value">{n(totals.visits)}</span>
            </div>
            <div className="p6stat">
              <span className="p6stat__label">Busiest page</span>
              <span className="p6stat__value">{pages[0]?.page ?? '—'}</span>
            </div>
          </section>

          <Card title="Page views per day">
            {days.length === 0 ? (
              <p className="p6sub">No visits in this range yet</p>
            ) : (
              <div className="p6bars" role="list">
                {days.map((d) => {
                  const label = new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
                  return (
                    <div key={d.date} className="p6bars__col" role="listitem" tabIndex={0} aria-label={`${label}: ${n(d.views)} page views, ${n(d.visits)} visits`}>
                      <span className="p6bars__tip">
                        <strong>{n(d.views)}</strong> views · {n(d.visits)} visits
                      </span>
                      <div className="p6bars__track">
                        <div className="p6bars__bar" style={{ height: `${Math.max(2, (d.views / max) * 100)}%` }} />
                      </div>
                      <span className="p6bars__x">{label}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

          <Card title="Views By Page">
            <TableWrap>
              <table className="atable">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th className="p6right">Views</th>
                    <th className="p6right">Visits</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.map((p) => (
                    <tr key={p.page}>
                      <td><strong>{p.page}</strong></td>
                      <td className="p6right">{n(p.views)}</td>
                      <td className="p6right">{n(p.visits)}</td>
                    </tr>
                  ))}
                  {pages.length === 0 && (
                    <tr>
                      <td colSpan={3} className="p6empty">No visits in this range yet</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        </>
      )}
    </>
  )
}
