import { useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { must, useLoad } from '../../lib/useLoad'
import { when } from '../../lib/camp'
import { Skeleton } from '../../components/ui'
import './leaderboard.css'

interface Slot {
  ord: number
  name: string | null
  points: number
  extrapolated: boolean
}
interface IndRow {
  username: string
  avatar: string | null
  team: string | null
  courses: Slot[]
  challenges: Record<string, number>
  total: number
  rank: number
  is_me: boolean
}
interface TeamRow {
  name: string
  number: number | null
  counselors: string | null
  takeovers: number | null
  challenges: Record<string, number>
  total: number
  rank: number
  is_mine: boolean
}
interface CourseList {
  course_id: string
  name: string
  rows: { username: string; avatar: string | null; score: number; rank: number; is_me: boolean }[]
}
interface Challenge {
  id: string
  name: string
  individual_max: number | null
  team_max: number | null
}
interface Board {
  state: 'live' | 'frozen' | 'hidden'
  updated: string | null
  top_n: number
  course_n: number
  students: number
  takeovers_shown: boolean
  course_max: number | null
  individual: IndRow[]
  me_below_cutoff: IndRow | null
  teams: TeamRow[]
  courses: CourseList[]
  challenges: Challenge[]
}
type View = 'ind' | 'team' | 'crs'

const fmt = (n: number | null | undefined) => (n == null ? '—' : Math.round(Number(n)).toLocaleString('en-US'))
const MEDALS = ['gold', 'silver', 'bronze']

function Rank({ rank, i, prefix = '#' }: { rank: number; i: number; prefix?: string }) {
  if (i < 3 && rank <= 3)
    return (
      <span className={'medal medal--' + MEDALS[rank - 1]} aria-label={`Rank ${rank}`}>
        {rank}
      </span>
    )
  return <span className="lbrank">{prefix}{rank}</span>
}

function Face({ url, size = 34 }: { url: string | null | undefined; size?: number }) {
  return (
    <span className="lbface" style={{ width: size, height: size }} aria-hidden="true">
      {url ? (
        <img src={url} alt="" />
      ) : (
        <svg width={size * 0.53} height={size * 0.53} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
        </svg>
      )}
    </span>
  )
}

function rowClass(i: number, rank: number, me: boolean) {
  if (me) return 'is-me'
  if (i < 3 && rank <= 3) return 'is-' + MEDALS[rank - 1]
  return i % 2 ? 'is-alt' : ''
}

export function Leaderboard() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [view, setView] = useState<View>('ind')
  const [courseId, setCourseId] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  const { data, error } = useLoad(async () => {
    const board = must(await supabase.rpc('get_leaderboard')) as Board | null
    // Photos are private files; sign the ones on screen.
    const paths = new Set<string>()
    if (board?.individual) {
      for (const r of [...board.individual, ...(board.me_below_cutoff ? [board.me_below_cutoff] : [])]) if (r.avatar) paths.add(r.avatar)
      for (const c of board.courses) for (const r of c.rows) if (r.avatar) paths.add(r.avatar)
    }
    const urls = new Map<string, string>()
    const list = [...paths]
    for (let i = 0; i < list.length; i += 200) {
      const { data: signed } = await supabase.storage.from('avatars').createSignedUrls(list.slice(i, i + 200), 3600)
      for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl)
    }
    return { board, urls }
  }, [])

  const b = data?.board ?? null
  const urls = data?.urls ?? new Map<string, string>()
  const hidden = b?.state === 'hidden' && !isAdmin
  const ready = !!b && !hidden && !!b.individual
  const indCols = (b?.challenges ?? [])
  const slots = useMemo(() => {
    const n = Math.max(0, ...(b?.individual ?? []).map((r) => r.courses.length), b?.me_below_cutoff?.courses.length ?? 0)
    return Array.from({ length: n }, (_, i) => i + 1)
  }, [b])
  const course = b?.courses?.find((c) => c.course_id === courseId) ?? b?.courses?.[0]
  const me = b?.individual?.find((r) => r.is_me) ?? b?.me_below_cutoff ?? null

  function jumpToMe() {
    const row = scroller.current?.querySelector<HTMLElement>('#me')
    if (row) row.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  const indRow = (r: IndRow, i: number) => (
    <tr key={r.username + i} id={r.is_me ? 'me' : undefined} className={rowClass(i, r.rank, r.is_me)}>
      <td className="c1">
        <Rank rank={r.rank} i={i} />
      </td>
      <td className="c2">
        <div className="lbplayer">
          <Face url={r.avatar ? urls.get(r.avatar) : null} />
          <div className="lbplayer__text">
            <span className="lbplayer__name">
              {r.username}
              {r.is_me && <span className="youtag">You</span>}
            </span>
            {r.team && <span className="lbteam">{r.team}</span>}
          </div>
        </div>
      </td>
      {slots.map((n) => {
        const s = r.courses.find((c) => c.ord === n)
        return (
          <td key={'s' + n} className="lbcourse">
            <span className={'lbcourse__name' + (s?.extrapolated ? ' is-x' : '')}>{s ? (s.extrapolated ? 'Extrapolate' : s.name) : '—'}</span>
            <span className="lbcourse__pts">{s ? `${fmt(s.points)} pts` : ''}</span>
          </td>
        )
      })}
      {indCols.map((c) => (
        <td key={c.id} className={'lbnum' + (r.challenges[c.id] == null ? ' is-empty' : '')}>
          {fmt(r.challenges[c.id])}
        </td>
      ))}
      <td className="lbtotal">{fmt(r.total)}</td>
    </tr>
  )

  return (
    <>
      <section className="lbhero">
        <span className="banner__c1" aria-hidden="true" />
        <div className="lbhero__inner">
          <div className="lbhero__text">
            <h1>Leaderboard</h1>
            {b?.updated && !hidden && <span className="lbhero__sub">Last Updated {when(b.updated)}</span>}
            {b && !hidden && <span className="lbhero__pill">Top {b.top_n} Students</span>}
          </div>
          {!hidden && (
            <div role="tablist" aria-label="Leaderboard view" className="lbtabs">
              {(
                [
                  ['ind', 'Individual'],
                  ['team', 'Teams'],
                  ['crs', 'Courses'],
                ] as [View, string][]
              ).map(([v, label]) => (
                <button key={v} type="button" role="tab" aria-selected={view === v} className="lbtab" onClick={() => setView(v)}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <main className="lbpage">
        {error && <p role="alert">Something went wrong loading the leaderboard. ({error})</p>}

        {b?.state === 'frozen' && (
          <div className="lbnotice">
            <span className="lbnotice__icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v20M4.9 4.9l14.2 14.2M2 12h20M4.9 19.1L19.1 4.9" />
              </svg>
            </span>
            <span>
              {isAdmin
                ? 'You are seeing live standings. Students see the standings from when the leaderboard was frozen.'
                : 'Standings are frozen. New points will appear when the directors unfreeze the leaderboard.'}
            </span>
          </div>
        )}
        {b?.state === 'hidden' && isAdmin && (
          <div className="lbnotice">
            <span className="lbnotice__icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10 10 0 0 1 22 12a17 17 0 0 1-3 3.6M6.6 6.6A17 17 0 0 0 2 12a10 10 0 0 0 13.3 5.4" />
              </svg>
            </span>
            <span>You are seeing live standings. The leaderboard is hidden from students and instructors.</span>
          </div>
        )}

        {hidden && (
          <section className="lbhidden">
            <span className="lbhidden__c1" aria-hidden="true" />
            <span className="lbhidden__c2" aria-hidden="true" />
            <span className="lbhidden__icon" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
            </span>
            <h2>The Leaderboard is Hidden</h2>
            <p>Coming Soon...</p>
          </section>
        )}

        {!data && !error && (
          <section className="lbcard" aria-busy="true">
            <Skeleton width={240} height={22} />
            <Skeleton height={420} />
          </section>
        )}

        {ready && view === 'ind' && (
          <section className="lbcard">
            <div className="lbcard__head">
              <h2>Individual Leaderboard</h2>
              <div className="lbcard__tools">
                <span className="lbcard__hint">Reminder: Only your T3 courses count</span>
                {me && (
                  <button type="button" className="jumpbtn" onClick={jumpToMe}>
                    Jump to me
                  </button>
                )}
              </div>
            </div>
            <div className="lb" ref={scroller}>
              <table>
                <thead>
                  <tr>
                    <th className="c1">#</th>
                    <th className="c2">Player</th>
                    {slots.map((n) => (
                      <th key={n} className="lbcol lbcol--course">
                        Course #{n}
                        <br />
                        <span className="lbcol__max">{fmt(b.course_max ?? 1000)} pts</span>
                      </th>
                    ))}
                    {indCols.map((c) => (
                      <th key={c.id} className="lbcol">
                        {c.name}
                        <br />
                        <span className="lbcol__max">{c.individual_max == null ? '—' : `${fmt(c.individual_max)} pts`}</span>
                      </th>
                    ))}
                    <th className="lbcol lbcol--total">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {b.individual.map((r, i) => indRow(r, i))}
                  {b.me_below_cutoff && (
                    <>
                      <tr className="lbgap" aria-hidden="true">
                        <td className="c1" />
                        <td className="c2">…</td>
                        <td colSpan={slots.length + indCols.length + 1} />
                      </tr>
                      {indRow(b.me_below_cutoff, 99)}
                    </>
                  )}
                </tbody>
              </table>
            </div>
            {b.individual.length === 0 && <p className="lbempty">No scores yet</p>}
          </section>
        )}

        {ready && view === 'team' && (
          <section className="lbcard">
            <h2>Team Leaderboard</h2>
            <div className="lb">
              <table>
                <thead>
                  <tr>
                    <th className="c1">#</th>
                    <th className="c2 c2--team">Team</th>
                    <th className="lbcol">Counselor(s)</th>
                    {b.takeovers_shown && <th className="lbcol">Course Takeovers</th>}
                    {indCols.map((c) => (
                      <th key={c.id} className="lbcol">
                        {c.name}
                        <br />
                        <span className="lbcol__max">{c.team_max == null ? '—' : `${fmt(c.team_max)} pts`}</span>
                      </th>
                    ))}
                    <th className="lbcol lbcol--total">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {b.teams.map((t, i) => (
                    <tr key={t.name} className={rowClass(i, t.rank, t.is_mine && !(i < 3 && t.rank <= 3))}>
                      <td className="c1">
                        <Rank rank={t.rank} i={i} />
                      </td>
                      <td className="c2 c2--team">
                        <div className="lbplayer__text">
                          <span className="lbplayer__name">
                            {t.name}
                            {t.is_mine && <span className="youtag">Your team</span>}
                          </span>
                          {t.number != null && <span className="lbteam">Team {t.number}</span>}
                        </div>
                      </td>
                      <td className="lbcounselors">{t.counselors ?? '—'}</td>
                      {b.takeovers_shown && <td className={'lbnum' + (t.takeovers == null ? ' is-empty' : '')}>{fmt(t.takeovers)}</td>}
                      {indCols.map((c) => (
                        <td key={c.id} className={'lbnum' + (t.challenges[c.id] == null ? ' is-empty' : '')}>
                          {fmt(t.challenges[c.id])}
                        </td>
                      ))}
                      <td className="lbtotal">{fmt(t.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {ready && view === 'crs' && (
          <section className="lbcard lbcard--narrow">
            <div className="lbcard__head" style={{ alignItems: 'center' }}>
              <div className="lbcard__title">
                <h2>Course Leaderboard</h2>
                <span className="lbcard__hint">Top {b.course_n} in each course</span>
              </div>
              <select aria-label="Choose a course" className="lbselect" value={course?.course_id ?? ''} onChange={(e) => setCourseId(e.target.value)}>
                {b.courses.map((c) => (
                  <option key={c.course_id} value={c.course_id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="lb lb--plain">
              <table>
                <thead>
                  <tr>
                    <th className="c1">#</th>
                    <th>Player</th>
                    <th className="lbcol--right">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {(course?.rows ?? []).map((r, i) => (
                    <tr key={r.username + i} className={rowClass(i, r.rank, r.is_me)}>
                      <td className="c1">
                        <Rank rank={r.rank} i={i} />
                      </td>
                      <td>
                        <div className="lbplayer">
                          <Face url={r.avatar ? urls.get(r.avatar) : null} size={30} />
                          <span className="lbplayer__name">
                            {r.username}
                            {r.is_me && <span className="youtag">You</span>}
                          </span>
                        </div>
                      </td>
                      <td className="lbscore">{fmt(r.score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {course && course.rows.length === 0 && <p className="lbempty">No scores yet</p>}
          </section>
        )}
      </main>
    </>
  )
}
