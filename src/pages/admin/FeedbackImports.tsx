import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { must, useLoad } from '../../lib/useLoad'
import { useCurrentEvent } from '../../lib/useEvent'
import { when } from '../../lib/camp'
import { summarizeFeedback, type FeedbackSummary } from '../../lib/feedback'
import { Button, Card, Pill, Skeleton, TableWrap } from '../../components/ui'
import { Dialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import { AdminHead, LoadError } from './AdminBits'
import './phase6.css'

type Kind = 'midpoint' | 'final'
const TITLE: Record<Kind, string> = { midpoint: 'Midpoint', final: 'Final' }
interface ImportRow {
  id: string
  kind: Kind
  imported_at: string
  responses: number
  unmatched: number
  imported_by: string | null
}

/** Admin › Feedback Imports [Midpoint/Final] (AdminFeedback mockup board). */
export function FeedbackImports() {
  const toast = useToast()
  const ev = useCurrentEvent()
  const eventId = ev.data?.event?.id ?? null
  const [origin, setOrigin] = useState<HTMLElement | null>(null)
  const [review, setReview] = useState<{ kind: Kind; summary: FeedbackSummary } | null>(null)

  const { data, error, reload } = useLoad(async () => {
    if (!eventId) return null
    const [imports, courses] = await Promise.all([
      supabase.from('feedback_imports').select('id, kind, imported_at, responses, unmatched, imported_by').eq('event_id', eventId).order('imported_at', { ascending: false }),
      supabase.from('courses').select('id, short_code, name').eq('event_id', eventId),
    ])
    const rows = must(imports) as ImportRow[]
    const ids = [...new Set(rows.map((r) => r.imported_by).filter((x): x is string => !!x))]
    const people = ids.length ? (must(await supabase.from('people').select('id, first_name, last_name').in('id', ids)) as { id: string; first_name: string; last_name: string }[]) : []
    return {
      imports: rows,
      courses: must(courses) as { id: string; short_code: string; name: string }[],
      names: new Map(people.map((p) => [p.id, `${p.first_name} ${p.last_name}`])),
    }
  }, [eventId])

  async function start(kind: Kind, text: string) {
    if (!data) return
    const summary = summarizeFeedback(text, data.courses)
    if (!summary.courseColumn) return toast('Couldn’t find a Course column in that file', 'error')
    if (!summary.results.length) return toast('No responses matched a course', 'error')
    setReview({ kind, summary })
  }

  async function confirm() {
    if (!review) return
    const { kind, summary } = review
    const res = await supabase.rpc('admin_import_feedback', {
      p_kind: kind,
      p_rows: summary.results,
      p_responses: summary.responses - summary.unmatched,
      p_unmatched: summary.unmatched,
      p_source: 'csv',
    })
    setReview(null)
    if (res.error) return toast('Something went wrong. Please try again.', 'error')
    toast(`Imported ${summary.responses - summary.unmatched} responses`)
    reload()
  }

  return (
    <>
      <AdminHead title="Feedback Imports" />
      {error && <LoadError message={error} />}

      <div className="p6two">
        {(['midpoint', 'final'] as Kind[]).map((k) => {
          const last = data?.imports.find((i) => i.kind === k)
          return (
            <FormCard
              key={k}
              kind={k}
              last={last ?? null}
              loading={!data}
              onText={(text) => start(k, text)}
            />
          )
        })}
      </div>

      <Card title="Import History">
        {!data ? (
          <Skeleton height={120} />
        ) : (
          <TableWrap>
            <table className="atable">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Form</th>
                  <th className="num">Responses</th>
                  <th className="num">Not matched to a course</th>
                </tr>
              </thead>
              <tbody>
                {data.imports.map((i) => (
                  <tr key={i.id}>
                    <td>{when(i.imported_at)}</td>
                    <td>{i.imported_by ? data.names.get(i.imported_by) ?? '—' : '—'}</td>
                    <td>{TITLE[i.kind]}</td>
                    <td className="num">{i.responses.toLocaleString('en-US')}</td>
                    <td className="num">{i.unmatched}</td>
                  </tr>
                ))}
                {data.imports.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p6empty">No imports yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      {review && (
        <Dialog
          open
          origin={origin}
          onClose={() => setReview(null)}
          title={`Import ${TITLE[review.kind]} Feedback?`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setReview(null)}>Cancel</Button>
              <Button onClick={(e) => { setOrigin(e.currentTarget); confirm() }}>Import</Button>
            </>
          }
        >
          <div className="p6review">
            <p>
              <strong>{(review.summary.responses - review.summary.unmatched).toLocaleString('en-US')}</strong> responses for{' '}
              <strong>{review.summary.results.length}</strong> courses
              {review.summary.unmatched > 0 && <> · {review.summary.unmatched} not matched to a course</>}
            </p>
            <p>Rating questions: {review.summary.ratingQuestions.join(' · ') || '—'}</p>
            <p>Comment questions: {review.summary.commentQuestions.join(' · ') || '—'}</p>
            <p className="field__hint">This replaces any {TITLE[review.kind]} results imported before. Student IDs and names aren't saved.</p>
          </div>
        </Dialog>
      )}
    </>
  )
}

function FormCard({ kind, last, loading, onText }: { kind: Kind; last: ImportRow | null; loading: boolean; onText: (text: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function fromFile(f: File | null | undefined) {
    if (!f) return
    setBusy(true)
    try {
      await onText(await f.text())
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (loading) return <Card title={TITLE[kind]}><Skeleton height={120} /></Card>
  return (
    <Card>
      <div className="p6head">
        <h2>{TITLE[kind]}</h2>
        {last ? <Pill tone="green">Imported</Pill> : <Pill tone="amber">Not imported</Pill>}
      </div>
      <span className="p6sub">{last ? `Last imported ${when(last.imported_at)} · ${last.responses.toLocaleString('en-US')} responses` : 'Not imported yet'}</span>
      <p className="field__hint">In the Google Form's responses sheet, choose File › Download › Comma-separated values (.csv), then upload that file here. The sheet stays private.</p>
      <div className="p6btns">
        <Button onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? 'Reading…' : last ? 'Upload CSV again' : 'Upload CSV'}</Button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => fromFile(e.target.files?.[0])} />
      </div>
    </Card>
  )
}
