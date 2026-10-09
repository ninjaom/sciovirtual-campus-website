import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { must, useLoad } from '../../lib/useLoad'
import { oneDecimal, shortDate } from '../../lib/camp'
import { Card, Skeleton, TableWrap } from '../../components/ui'
import { useCourse } from './CourseLayout'

interface Result {
  kind: 'midpoint' | 'final'
  questions: { question: string; average: number | null; camp_average: number | null }[]
  comments: { question: string; answers: string[] }[]
  responses: number
  camp_responses: number | null
  class_rank: number | null
  imported_at: string
}
type Tab = 'daily' | 'midpoint' | 'final'

export function Feedback() {
  const { course, sessions } = useCourse()
  const [tab, setTab] = useState<Tab>('daily')
  const [picked, setPicked] = useState<number | null>(null)

  const { data } = useLoad(async () => {
    const [ratings, results, checkins] = await Promise.all([
      supabase.rpc('course_ratings', { p_course: course.id }),
      supabase.from('feedback_results').select('kind, questions, comments, responses, camp_responses, class_rank, imported_at').eq('course_id', course.id),
      sessions.length
        ? supabase.from('attendance').select('session_id, rating, comment, submitted_at').in('session_id', sessions.map((s) => s.id)).order('submitted_at')
        : Promise.resolve({ data: [], error: null }),
    ])
    return {
      ratings: (must(ratings) as { sessions: { number: number; average: number | null; responses: number }[] }).sessions,
      results: must(results) as Result[],
      checkins: must(checkins) as { session_id: string; rating: number | null; comment: string | null }[],
    }
  }, [course.id, sessions.length])

  const byNumber = new Map((data?.ratings ?? []).map((r) => [r.number, r]))
  const lastRated = [...(data?.ratings ?? [])].reverse().find((r) => r.responses > 0)?.number ?? 1
  const current = sessions.find((s) => s.number === (picked ?? lastRated)) ?? sessions[0]
  const sessionCheckins = (data?.checkins ?? []).filter((c) => c.session_id === current?.id)
  const comments = sessionCheckins.filter((c) => c.comment && c.comment.trim())

  const result = data?.results.find((r) => r.kind === tab)

  return (
    <>
      <div role="tablist" aria-label="Feedback type" className="ftabs">
        {(['daily', 'midpoint', 'final'] as Tab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className="ftab" onClick={() => setTab(t)}>
            {t === 'daily' ? 'Daily' : t === 'midpoint' ? 'Midpoint' : 'Final'}
          </button>
        ))}
      </div>

      {tab === 'daily' && (
        <>
          <Card>
            <div className="secthead" style={{ alignItems: 'baseline' }}>
              <h2>Session Ratings</h2>
              <span className="secthead__count">Average student rating, out of 10</span>
            </div>
            {!data ? (
              <Skeleton height={80} />
            ) : (
              <div className="srates">
                {sessions.map((s) => {
                  const r = byNumber.get(s.number)
                  const on = s.id === current?.id
                  const empty = !r || r.responses === 0
                  return (
                    <button key={s.id} type="button" className={'srate' + (on ? ' is-on' : '') + (empty ? ' is-empty' : '')} aria-pressed={on} onClick={() => setPicked(s.number)}>
                      <span className="srate__label">
                        S{s.number}
                        {s.date ? ` · ${shortDate(s.date)}` : ''}
                      </span>
                      <span className="srate__value">{empty ? '—' : oneDecimal(r.average)}</span>
                      <span className="srate__label">
                        {r?.responses ?? 0} {r?.responses === 1 ? 'response' : 'responses'}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </Card>
          {current && (
            <Card>
              <div className="secthead" style={{ alignItems: 'baseline' }}>
                <h2>Student Feedback · Session {current.number}</h2>
                <span className="secthead__count">
                  {current.date ? `${shortDate(current.date)} · ` : ''}
                  {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
                </span>
              </div>
              {comments.length > 0 ? (
                <div className="fcomments">
                  {comments.map((c, i) => (
                    <div key={i} className="fcomment">
                      {c.rating != null && <span className="fcomment__rating">{c.rating} / 10</span>}
                      <span className="fcomment__text">{c.comment}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="nomatch" style={{ padding: 28 }}>
                  {sessionCheckins.length ? 'No comments for this session' : 'No check-ins for this session yet'}
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {tab !== 'daily' && data && result && (
        <>
          <Card>
            <div className="secthead" style={{ alignItems: 'baseline' }}>
              <h2>{tab === 'midpoint' ? 'Midpoint' : 'Final'} feedback results</h2>
              <span className="secthead__count">Imported from the Google Form · {shortDate(new Date(result.imported_at))}</span>
            </div>
            <TableWrap>
              <table className="itable ftable" style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th aria-label="Group" />
                    <th className="c">Responses</th>
                    {result.questions.map((q) => (
                      <th key={q.question} className="c">
                        {q.question}
                      </th>
                    ))}
                    <th className="c">Camp Rank</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Your class</th>
                    <td className="c tnum">{result.responses}</td>
                    {result.questions.map((q) => (
                      <td key={q.question} className="c tnum strong">
                        {oneDecimal(q.average)}
                      </td>
                    ))}
                    <td className="c" style={{ fontWeight: 700, color: 'var(--blue-ink)' }}>
                      {result.class_rank ? `#${result.class_rank}` : '—'}
                    </td>
                  </tr>
                  <tr className="ftable__camp">
                    <th scope="row">Camp</th>
                    <td className="c tnum">{result.camp_responses ?? '—'}</td>
                    {result.questions.map((q) => (
                      <td key={q.question} className="c tnum">
                        {oneDecimal(q.camp_average)}
                      </td>
                    ))}
                    <td className="c">—</td>
                  </tr>
                </tbody>
              </table>
            </TableWrap>
          </Card>
          <div className="irow">
            {result.comments.map((c) => (
              <Card key={c.question} title={c.question} className="fanswers">
                {c.answers.map((a, i) => (
                  <div key={i} className="fanswer">
                    {a}
                  </div>
                ))}
                {c.answers.length === 0 && <p className="inote" style={{ fontSize: 14 }}>No answers</p>}
              </Card>
            ))}
          </div>
        </>
      )}

      {tab !== 'daily' && data && !result && (
        <Card className="fsoon">
          <span className="fsoon__icon" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
          </span>
          <h2>[{tab === 'midpoint' ? 'Midpoint' : 'Final'} feedback isn't available yet]</h2>
          <p>Results Coming Soon!</p>
        </Card>
      )}
    </>
  )
}
