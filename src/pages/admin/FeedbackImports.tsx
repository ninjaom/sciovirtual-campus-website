import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { must, useLoad } from '../../lib/useLoad'
import { useCurrentEvent } from '../../lib/useEvent'
import { useAutosave } from '../../lib/useAutosave'
import { when } from '../../lib/camp'
import { postApiAuth } from '../../lib/api'
import { summarizeFeedback, type FeedbackSummary } from '../../lib/feedback'
import { Button, Card, Pill, SavedStatus, Skeleton, TableWrap, TextField } from '../../components/ui'
import { Dialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import { AdminHead, LoadError } from './AdminBits'
import './phase6.css'

type Kind = 'midpoint' | 'final'
const TITLE: Record<Kind, string> = { midpoint: 'Midpoint', final: 'Final' }
const URL_KEY = { midpoint: 'feedback_midpoint_url', final: 'feedback_final_url' } as const
const SHEET_ERRORS: Record<string, string> = {
  not_a_sheet: 'That isn’t a Google Sheets link',
  not_shared: 'Couldn’t open that sheet. Share it as “Anyone with the link can view”, or upload a CSV instead.',
  too_big: 'That sheet is too big to import',
  admins_only: 'Only admins can import feedback',
  signed_out: 'Please sign in again',
  server: 'Something went wrong. Please try again.',
}

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
  const s = ev.data?.settings ?? null
  const [origin, setOrigin] = useState<HTMLElement | null>(null)
  const [review, setReview] = useState<{ kind: Kind; source: 'link' | 'csv'; summary: FeedbackSummary } | null>(null)

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

  function start(kind: Kind, source: 'link' | 'csv', text: string) {
    if (!data) return
    const summary = summarizeFeedback(text, data.courses)
    if (!summary.courseColumn) return toast('Couldn’t find a Course column in that file', 'error')
    if (!summary.results.length) return toast('No responses matched a course', 'error')
    setReview({ kind, source, summary })
  }

  async function confirm() {
    if (!review) return
    const { kind, source, summary } = review
    const res = await supabase.rpc('admin_import_feedback', {
      p_kind: kind,
      p_rows: summary.results,
      p_responses: summary.responses - summary.unmatched,
      p_unmatched: summary.unmatched,
      p_source: source,
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
              eventId={eventId}
              initialUrl={(s?.[URL_KEY[k]] as string | null) ?? ''}
              last={last ?? null}
              loading={!data || !s}
              onText={(source, text) => start(k, source, text)}
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

function FormCard({
  kind,
  eventId,
  initialUrl,
  last,
  loading,
  onText,
}: {
  kind: Kind
  eventId: string | null
  initialUrl: string
  last: ImportRow | null
  loading: boolean
  onText: (source: 'link' | 'csv', text: string) => void
}) {
  const toast = useToast()
  const [url, setUrl] = useState(initialUrl)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const save = useAutosave<Record<string, string | null>>((patch) => supabase.from('settings').update(patch).eq('event_id', eventId ?? ''))

  async function fromLink() {
    if (!url.trim()) return toast('Paste the responses sheet link first', 'error')
    setBusy(true)
    const res = await postApiAuth<{ ok: boolean; csv?: string; error?: string }>('fetch-sheet', { url: url.trim() })
    setBusy(false)
    if (!res.ok || !res.csv) return toast(SHEET_ERRORS[res.error ?? 'server'] ?? SHEET_ERRORS.server, 'error')
    onText('link', res.csv)
  }
  async function fromFile(f: File | null | undefined) {
    if (!f) return
    onText('csv', await f.text())
    if (fileRef.current) fileRef.current.value = ''
  }

  if (loading) return <Card title={TITLE[kind]}><Skeleton height={120} /></Card>
  return (
    <Card>
      <div className="p6head">
        <h2>{TITLE[kind]}</h2>
        {last ? <Pill tone="green">Imported</Pill> : <Pill tone="amber">Not imported</Pill>}
      </div>
      <span className="p6sub">{last ? `Last imported ${when(last.imported_at)} · ${last.responses.toLocaleString('en-US')} responses` : 'Not imported yet'}</span>
      <TextField
        label="Google Form responses sheet link"
        value={url}
        placeholder="https://docs.google.com/spreadsheets/d/…"
        onChange={(e) => {
          setUrl(e.target.value)
          save.change({ [URL_KEY[kind]]: e.target.value.trim() || null })
        }}
      />
      {save.state !== 'saved' && <SavedStatus state={save.state} />}
      <div className="p6btns">
        <Button onClick={fromLink} disabled={busy}>{busy ? 'Importing…' : last ? 'Import again' : 'Import'}</Button>
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>Upload CSV instead</Button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => fromFile(e.target.files?.[0])} />
      </div>
    </Card>
  )
}
