import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { must, useLoad } from '../../lib/useLoad'
import { useCurrentEvent } from '../../lib/useEvent'
import { useAutosave } from '../../lib/useAutosave'
import { PRACTICE_URL } from '../../layout/nav'
import { Button, Card, SavedStatus, SelectField, Skeleton, TextAreaField, TextField } from '../../components/ui'
import { Dialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import { AdminHead, LoadError } from './AdminBits'

interface Reminder {
  id: string
  body: string
  sort: number
}
interface QuickLink {
  id: string
  label: string
  audience: 'students' | 'instructors' | 'both'
  page: string | null
  url: string | null
  sort: number
}

const AUDIENCE = { students: 'Students', instructors: 'Instructors', both: 'Students & Instructors' } as const
const PAGES: Record<string, string> = {
  merchandise: 'Merchandise page',
  learn: 'Learn page',
  leaderboard: 'Leaderboard page',
  'past-resources': 'Past Resources page',
  courses: 'My Courses page',
}

export function HomeContent() {
  const toast = useToast()
  const ev = useCurrentEvent()
  const eventId = ev.data?.event?.id ?? null
  const [origin, setOrigin] = useState<HTMLElement | null>(null)
  const [editReminder, setEditReminder] = useState<Reminder | 'new' | null>(null)
  const [editLink, setEditLink] = useState<QuickLink | 'new' | null>(null)

  const { data, error, reload, setData } = useLoad(
    async () => {
      if (!eventId) return null
      const [reminders, links] = await Promise.all([
        supabase.from('reminders').select('id, body, sort').eq('event_id', eventId).order('sort').order('created_at'),
        supabase.from('quick_links').select('id, label, audience, page, url, sort').eq('event_id', eventId).order('sort'),
      ])
      return { reminders: must(reminders) as Reminder[], links: must(links) as QuickLink[] }
    },
    [eventId],
  )

  async function saveOrder(table: 'reminders' | 'quick_links', ids: string[]) {
    for (let i = 0; i < ids.length; i++) {
      const res = await supabase.from(table).update({ sort: i + 1 }).eq('id', ids[i])
      if (res.error) return toast('Something went wrong. Please try again.', 'error')
    }
  }
  async function remove(table: 'reminders' | 'quick_links', id: string) {
    const res = await supabase.from(table).delete().eq('id', id)
    if (res.error) return toast('Something went wrong. Please try again.', 'error')
    toast('Removed')
    reload()
  }

  return (
    <>
      <AdminHead eyebrow="Shown on Both Student & Instructor Home Pages" title="Home Page Content" />
      {error && <LoadError message={error} />}

      <div className="arow">
        <Card
          title="Important Reminders!"
          actions={<Button variant="secondary" onClick={(e) => { setOrigin(e.currentTarget); setEditReminder('new') }}>+ Add</Button>}
        >
          {!data ? (
            <Skeleton height={60} />
          ) : (
            <Reorder
              items={data.reminders}
              label={(r) => r.body}
              onReorder={(next) => {
                setData((d) => (d ? { ...d, reminders: next } : d))
                saveOrder('reminders', next.map((r) => r.id))
              }}
              render={(r) => (
                <>
                  <div className="lrow__text">
                    <span className="lrow__title">{r.body}</span>
                    <span className="lrow__sub">Shown to: Instructors</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={(e) => { setOrigin(e.currentTarget); setEditReminder(r) }}>Edit</Button>
                  <Button variant="outline" size="sm" className="btn--danger-outline" aria-label="Remove" onClick={() => remove('reminders', r.id)}>×</Button>
                </>
              )}
            />
          )}
          {data && data.reminders.length === 0 && <span className="field__hint">No reminders yet</span>}
        </Card>

        <Card title="Quick Links" actions={<Button variant="secondary" onClick={(e) => { setOrigin(e.currentTarget); setEditLink('new') }}>+ Add</Button>}>
          {!data ? (
            <Skeleton height={60} />
          ) : (
            <Reorder
              items={data.links}
              label={(l) => l.label}
              onReorder={(next) => {
                setData((d) => (d ? { ...d, links: next } : d))
                saveOrder('quick_links', next.map((l) => l.id))
              }}
              render={(l) => (
                <>
                  <div className="lrow__text">
                    <span className="lrow__title">{l.label}</span>
                    <span className="lrow__sub">
                      {AUDIENCE[l.audience]} · {l.page ? PAGES[l.page] : `${l.label} link`}
                    </span>
                  </div>
                  <Button variant="outline" size="sm" onClick={(e) => { setOrigin(e.currentTarget); setEditLink(l) }}>Edit</Button>
                  <Button variant="outline" size="sm" className="btn--danger-outline" aria-label="Remove" onClick={() => remove('quick_links', l.id)}>×</Button>
                </>
              )}
            />
          )}
          {data && data.links.length === 0 && <span className="field__hint">No quick links yet</span>}
        </Card>
      </div>

      {ev.data?.settings && <LinksAndDates eventId={ev.data.settings.event_id} initial={ev.data.settings} />}

      {editReminder && eventId && (
        <EditReminder reminder={editReminder === 'new' ? null : editReminder} eventId={eventId} sort={(data?.reminders.length ?? 0) + 1} origin={origin} onClose={() => setEditReminder(null)} onSaved={() => { setEditReminder(null); reload(); toast('All Changes Saved') }} />
      )}
      {editLink && eventId && (
        <EditLink link={editLink === 'new' ? null : editLink} eventId={eventId} sort={(data?.links.length ?? 0) + 1} origin={origin} onClose={() => setEditLink(null)} onSaved={() => { setEditLink(null); reload(); toast('All Changes Saved') }} />
      )}
    </>
  )
}

/**
 * List you can reorder by dragging the ⋮⋮ handle (mouse or touch), or by
 * focusing the handle and pressing the up/down arrow keys.
 */
function Reorder<T extends { id: string }>({
  items,
  render,
  label,
  onReorder,
}: {
  items: T[]
  render: (item: T) => React.ReactNode
  label: (item: T) => string
  onReorder: (next: T[]) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ id: string; startY: number; dy: number } | null>(null)
  const [order, setOrder] = useState(items)
  useEffect(() => setOrder(items), [items])

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length || from === to) return order
    const next = order.slice()
    const [x] = next.splice(from, 1)
    next.splice(to, 0, x)
    return next
  }

  function onDown(e: RPointerEvent<HTMLButtonElement>, id: string) {
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ id, startY: e.clientY, dy: 0 })
  }
  function onMove(e: RPointerEvent<HTMLButtonElement>) {
    if (!drag || !listRef.current) return
    const dy = e.clientY - drag.startY
    const rows = Array.from(listRef.current.children) as HTMLElement[]
    const from = order.findIndex((o) => o.id === drag.id)
    const h = rows[from]?.offsetHeight ?? 60
    const steps = Math.round(dy / (h + 16))
    if (steps !== 0) {
      const to = Math.max(0, Math.min(order.length - 1, from + steps))
      if (to !== from) {
        setOrder(move(from, to))
        setDrag({ id: drag.id, startY: drag.startY + (to - from) * (h + 16), dy: dy - (to - from) * (h + 16) })
        return
      }
    }
    setDrag({ ...drag, dy })
  }
  function onUp() {
    if (!drag) return
    setDrag(null)
    if (order.map((o) => o.id).join() !== items.map((o) => o.id).join()) onReorder(order)
  }
  function onKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const next = move(i, i + (e.key === 'ArrowUp' ? -1 : 1))
    if (next !== order) {
      setOrder(next)
      onReorder(next)
      requestAnimationFrame(() => (listRef.current?.querySelectorAll<HTMLButtonElement>('.lrow__handle')[i + (e.key === 'ArrowUp' ? -1 : 1)])?.focus())
    }
  }

  return (
    <div ref={listRef} className="reorder">
      {order.map((item, i) => (
        <div
          key={item.id}
          className={'lrow' + (drag?.id === item.id ? ' is-dragging' : '')}
          style={drag?.id === item.id ? { transform: `translateY(${drag.dy}px)`, position: 'relative', zIndex: 2 } : undefined}
        >
          <button
            type="button"
            className="lrow__handle"
            aria-label={`Move ${label(item)} (use up and down arrow keys)`}
            onPointerDown={(e) => onDown(e, item.id)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onKeyDown={(e) => onKey(e, i)}
          >
            ⋮⋮
          </button>
          {render(item)}
        </div>
      ))}
    </div>
  )
}

function LinksAndDates({ eventId, initial }: { eventId: string; initial: { faq_url: string | null; attendance_url: string | null; first_day: string | null; last_day: string | null } }) {
  const [f, setF] = useState({
    faq_url: initial.faq_url ?? '',
    attendance_url: initial.attendance_url ?? '',
    first_day: initial.first_day ?? '',
    last_day: initial.last_day ?? '',
  })
  const save = useAutosave<{ faq_url: string | null; attendance_url: string | null; first_day: string | null; last_day: string | null }>((patch) =>
    supabase.from('settings').update(patch).eq('event_id', eventId),
  )
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setF((x) => ({ ...x, [k]: e.target.value }))
    save.change({ [k]: e.target.value.trim() || null })
  }
  return (
    <Card className="acard" title="Links & Dates">
      <div className="fieldrow">
        <TextField label="FAQ Google Doc link" value={f.faq_url} onChange={set('faq_url')} placeholder="https://docs.google.com/document/d/…" fieldStyle={{ flex: '1 1 320px' }} />
        <TextField label="Attendance form link" value={f.attendance_url} onChange={set('attendance_url')} placeholder="https://www.sciovirtual.org/attendance" fieldStyle={{ flex: '1 1 260px' }} />
      </div>
      <div className="fieldrow">
        <TextField label="First day of camp" type="date" value={f.first_day} onChange={set('first_day')} hint='Used for "Day 4 of Camp"' fieldStyle={{ flex: '1 1 200px' }} />
        <TextField label="Last day of camp" type="date" value={f.last_day} onChange={set('last_day')} min={f.first_day || undefined} fieldStyle={{ flex: '1 1 200px' }} />
      </div>
      <SavedStatus state={save.state} />
    </Card>
  )
}

function EditReminder({ reminder, eventId, sort, origin, onClose, onSaved }: { reminder: Reminder | null; eventId: string; sort: number; origin: HTMLElement | null; onClose: () => void; onSaved: () => void }) {
  const [body, setBody] = useState(reminder?.body ?? '')
  const [err, setErr] = useState<string | null>(null)
  async function save() {
    if (!body.trim()) return setErr('Reminder text is required')
    const res = reminder
      ? await supabase.from('reminders').update({ body: body.trim() }).eq('id', reminder.id)
      : await supabase.from('reminders').insert({ event_id: eventId, body: body.trim(), sort })
    if (res.error) return setErr('Something went wrong. Please try again.')
    onSaved()
  }
  return (
    <Dialog
      open
      origin={origin}
      onClose={onClose}
      title={reminder ? 'Edit Reminder' : '+ Add Reminder'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </>
      }
    >
      <div className="acard dlgform">
        <TextAreaField label="Reminder text" value={body} onChange={(e) => setBody(e.target.value)} hint="Shown to: Instructors" />
        {err && <div role="alert" className="auth__formerror">{err}</div>}
      </div>
    </Dialog>
  )
}

function EditLink({ link, eventId, sort, origin, onClose, onSaved }: { link: QuickLink | null; eventId: string; sort: number; origin: HTMLElement | null; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState(link?.label ?? '')
  const [audience, setAudience] = useState<QuickLink['audience']>(link?.audience ?? 'both')
  const [target, setTarget] = useState(link?.page ?? (link?.url ? 'url' : 'learn'))
  const [url, setUrl] = useState(link?.url ?? '')
  const [err, setErr] = useState<string | null>(null)
  async function save() {
    if (!label.trim()) return setErr('Label is required')
    if (target === 'url' && !/^https?:\/\/\S+\.\S+/.test(url.trim())) return setErr('Enter a full link starting with https://')
    const row = { label: label.trim(), audience, page: target === 'url' ? null : target, url: target === 'url' ? url.trim() : null }
    const res = link ? await supabase.from('quick_links').update(row).eq('id', link.id) : await supabase.from('quick_links').insert({ ...row, event_id: eventId, sort })
    if (res.error) return setErr('Something went wrong. Please try again.')
    onSaved()
  }
  return (
    <Dialog
      open
      origin={origin}
      onClose={onClose}
      title={link ? `Edit ${link.label}` : '+ Add Quick Link'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </>
      }
    >
      <div className="acard dlgform">
        <TextField label="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
        <SelectField label="Shown to" value={audience} onChange={(e) => setAudience(e.target.value as QuickLink['audience'])}>
          {Object.entries(AUDIENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </SelectField>
        <SelectField label="Links to" value={target} onChange={(e) => setTarget(e.target.value)}>
          {Object.entries(PAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          <option value="url">Other link</option>
        </SelectField>
        {target === 'url' && <TextField label="Link" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={PRACTICE_URL} />}
        {err && <div role="alert" className="auth__formerror">{err}</div>}
      </div>
    </Dialog>
  )
}
