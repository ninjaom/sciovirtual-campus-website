import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { must, useLoad } from '../../lib/useLoad'
import { useAutosave } from '../../lib/useAutosave'
import { Button, Card, Pill, SavedStatus, SelectField, Skeleton, TableWrap, TextField } from '../../components/ui'
import { Dialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import { AdminHead, ListRow, LoadError, Note } from './AdminBits'

interface Item {
  id: string
  course_id: string | null
  name: string
  kind: 'manual' | 'attendance'
  max_points: number
  points_per_session: number | null
  sort: number
}
interface Ev {
  id: string
  year: number
  is_current: boolean
}

const num = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100))

export function GradeItems() {
  const toast = useToast()
  const events = useLoad(async () => must(await supabase.from('events').select('id, year, is_current').order('year', { ascending: false })) as Ev[])
  const [eventId, setEventId] = useState<string | null>(null)
  useEffect(() => {
    if (!eventId && events.data?.length) setEventId((events.data.find((e) => e.is_current) ?? events.data[0]).id)
  }, [events.data, eventId])

  const { data, error, reload, setData } = useLoad(
    async () => {
      if (!eventId) return null
      const [items, settings, courses, over] = await Promise.all([
        supabase.from('grade_items').select('id, course_id, name, kind, max_points, points_per_session, sort').eq('event_id', eventId).order('sort').order('name'),
        supabase.from('settings').select('sessions_per_course, courses_that_count').eq('event_id', eventId).maybeSingle(),
        supabase.from('courses').select('id, name, short_code').eq('event_id', eventId).eq('archived', false).order('name'),
        supabase.rpc('admin_scores_over_max'),
      ])
      return {
        items: must(items) as Item[],
        settings: must(settings) as { sessions_per_course: number; courses_that_count: number } | null,
        courses: must(courses) as { id: string; name: string; short_code: string }[],
        over: (over.data ?? []) as { course: string; student: string; item: string; points: number; max_points: number }[],
      }
    },
    [eventId],
  )

  const [editing, setEditing] = useState<Item | 'new' | null>(null)
  const [overrideFor, setOverrideFor] = useState<string | 'pick' | null>(null)
  const [origin, setOrigin] = useState<HTMLElement | null>(null)

  const shared = (data?.items ?? []).filter((i) => !i.course_id)
  const total = shared.reduce((t, i) => t + Number(i.max_points), 0)
  const att = shared.find((i) => i.kind === 'attendance')
  const overrides = (data?.courses ?? []).filter((c) => (data?.items ?? []).some((i) => i.course_id === c.id))

  // Autosave: item maximums, attendance points, sessions per course, courses that count
  const saveItem = useAutosave<Record<string, number>>(async (patch) => {
    for (const [id, max] of Object.entries(patch)) {
      const res = await supabase.from('grade_items').update({ max_points: max }).eq('id', id)
      if (res.error) return res
    }
    reload()
  })
  const saveSettings = useAutosave<{ sessions_per_course: number; courses_that_count: number }>(async (patch) => {
    const res = await supabase.from('settings').update(patch).eq('event_id', eventId!)
    if (!res.error) reload()
    return res
  })
  const savePps = useAutosave<{ pps: number }>(async ({ pps }) => {
    if (!att || pps == null) return
    const sessions = data?.settings?.sessions_per_course ?? 9
    const res = await supabase.from('grade_items').update({ points_per_session: pps, max_points: pps * sessions }).eq('event_id', eventId!).eq('kind', 'attendance')
    if (!res.error) reload()
    return res
  })
  const state = [saveItem.state, saveSettings.state, savePps.state].includes('error')
    ? 'error'
    : [saveItem.state, saveSettings.state, savePps.state].includes('saving')
      ? 'saving'
      : 'saved'

  function setLocalItem(id: string, max: number) {
    setData((d) => (d ? { ...d, items: d.items.map((i) => (i.id === id ? { ...i, max_points: max } : i)) } : d))
  }

  return (
    <>
      <AdminHead eyebrow="Shared by Every Course" title="Grade Items">
        <select aria-label="Camp year" className="input yearpick" value={eventId ?? ''} onChange={(e) => setEventId(e.target.value)}>
          {(events.data ?? []).map((e) => (
            <option key={e.id} value={e.id}>{e.year}</option>
          ))}
        </select>
      </AdminHead>
      {(error || events.error) && <LoadError message={(error || events.error)!} />}

      {data && data.over.length > 0 && (
        <div role="alert" className="warnbox">
          <strong>These scores are above their item's maximum. Ask the course's instructors to fix them:</strong>
          <ul>
            {data.over.map((o, i) => (
              <li key={i}>
                {o.course} · {o.student} · {o.item}: {num(o.points)} / {num(o.max_points)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Card
        className="acard"
        title="Grade items"
        actions={
          <Button variant="secondary" onClick={(e) => { setOrigin(e.currentTarget); setEditing('new') }}>
            + Add grade item
          </Button>
        }
      >
        {!data ? (
          <Skeleton height={180} />
        ) : (
          <TableWrap>
            <table className="atable" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Max Points</th>
                  <th>Filled in By</th>
                  <th />
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {shared.map((i) => (
                  <tr key={i.id}>
                    <td className="strong">{i.name}</td>
                    <td style={{ width: 140, padding: '6px 10px' }}>
                      <input
                        className="cellinput"
                        inputMode="numeric"
                        aria-label={`Max points for ${i.name}`}
                        value={num(Number(i.max_points))}
                        readOnly={i.kind === 'attendance'}
                        title={i.kind === 'attendance' ? 'Set by points per session × sessions' : undefined}
                        onChange={(e) => {
                          const v = Number(e.target.value.replace(/[^\d.]/g, ''))
                          if (Number.isNaN(v)) return
                          setLocalItem(i.id, v)
                          saveItem.change({ [i.id]: v })
                        }}
                      />
                    </td>
                    <td>{i.kind === 'attendance' ? <Pill tone="green">Check-ins</Pill> : <Pill>Instructors</Pill>}</td>
                    <td className="muted" style={{ fontSize: 13 }}>
                      {i.kind === 'attendance' && `${num(Number(i.points_per_session))} × ${data.settings?.sessions_per_course ?? 9} sessions`}
                    </td>
                    <td className="actions">
                      <Button variant="outline" size="sm" onClick={(e) => { setOrigin(e.currentTarget); setEditing(i) }}>Edit</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="num">{num(total)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </TableWrap>
        )}
        {data && (
          <div className="fieldrow" style={{ alignItems: 'flex-end' }}>
            <NumberField
              id="att-pts"
              label="Points per attended session"
              value={att ? Number(att.points_per_session) : 0}
              disabled={!att}
              onValue={(v) => savePps.change({ pps: v })}
            />
            <NumberField id="att-n" label="Sessions per course" value={data.settings?.sessions_per_course ?? 9} onValue={(v) => v >= 1 && saveSettings.change({ sessions_per_course: v })} />
          </div>
        )}
        <SavedStatus state={state} />
      </Card>

      <Card
        className="acard"
        title="Course Overrides"
        actions={
          <Button variant="secondary" onClick={(e) => { setOrigin(e.currentTarget); setOverrideFor('pick') }}>
            + Add override
          </Button>
        }
      >
        {overrides.map((c) => (
          <ListRow
            key={c.id}
            title={c.name}
            sub={(data?.items ?? [])
              .filter((i) => i.course_id === c.id)
              .map((i) => `${i.name} ${num(Number(i.max_points))}`)
              .join(' · ')}
          >
            <Button variant="outline" size="sm" onClick={(e) => { setOrigin(e.currentTarget); setOverrideFor(c.id) }}>Edit</Button>
          </ListRow>
        ))}
        {data && overrides.length === 0 && <span className="field__hint">No courses have their own grade items</span>}
      </Card>

      <Card className="acard" title="Scoring Rules">
        {data && (
          <div className="fieldrow">
            <NumberField id="sr-top" label="Courses that count" value={data.settings?.courses_that_count ?? 3} onValue={(v) => v >= 1 && v <= 10 && saveSettings.change({ courses_that_count: v })} />
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="rulerow">
            <span className="rulerow__k">2 courses</span>
            <span>3rd Course = Average of the 2</span>
          </div>
          <div className="rulerow">
            <span className="rulerow__k">1 course</span>
            <span>2nd = ×0.75, 3rd = ×0.50</span>
          </div>
        </div>
        <Note>Note: Extrapolated slots show as "Extrapolate" on the leaderboard</Note>
      </Card>

      {editing && eventId && (
        <EditItem
          item={editing === 'new' ? null : editing}
          eventId={eventId}
          courseId={null}
          sort={shared.length + 1}
          origin={origin}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); toast('All Changes Saved') }}
        />
      )}
      {overrideFor === 'pick' && data && (
        <PickCourse
          courses={data.courses.filter((c) => !overrides.some((o) => o.id === c.id))}
          origin={origin}
          onClose={() => setOverrideFor(null)}
          onPick={async (id) => {
            const res = await supabase.rpc('admin_set_course_override', { p_course: id, p_on: true })
            if (res.error) return toast('Something went wrong. Please try again.', 'error')
            await reload()
            setOverrideFor(id)
          }}
        />
      )}
      {overrideFor && overrideFor !== 'pick' && data && eventId && (
        <EditOverride
          course={data.courses.find((c) => c.id === overrideFor)!}
          items={data.items.filter((i) => i.course_id === overrideFor)}
          eventId={eventId}
          origin={origin}
          onClose={() => setOverrideFor(null)}
          onChanged={reload}
        />
      )}
    </>
  )
}

/** Number input that keeps what's typed and reports valid numbers. */
function NumberField({ id, label, value, onValue, disabled }: { id: string; label: string; value: number; onValue: (v: number) => void; disabled?: boolean }) {
  const [text, setText] = useState(num(value))
  useEffect(() => setText(num(value)), [value])
  return (
    <TextField
      id={id}
      label={label}
      inputMode="numeric"
      value={text}
      disabled={disabled}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d.]/g, '')
        setText(t)
        const v = Number(t)
        if (t !== '' && !Number.isNaN(v)) onValue(v)
      }}
    />
  )
}

function EditItem({
  item,
  eventId,
  courseId,
  sort,
  origin,
  onClose,
  onSaved,
}: {
  item: Item | null
  eventId: string
  courseId: string | null
  sort: number
  origin: HTMLElement | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(item?.name ?? '')
  const [max, setMax] = useState(item ? num(Number(item.max_points)) : '')
  const [err, setErr] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isAtt = item?.kind === 'attendance'

  async function save() {
    const m = Number(max)
    if (!name.trim()) return setErr('Item name is required')
    if (!isAtt && (max === '' || Number.isNaN(m) || m < 0)) return setErr('Max points must be a number')
    const row = isAtt ? { name: name.trim() } : { name: name.trim(), max_points: m }
    const res = item
      ? await supabase.from('grade_items').update(row).eq('id', item.id)
      : await supabase.from('grade_items').insert({ ...row, event_id: eventId, course_id: courseId, kind: 'manual', sort })
    if (res.error) return setErr('Something went wrong. Please try again.')
    onSaved()
  }
  async function remove() {
    const res = await supabase.from('grade_items').delete().eq('id', item!.id)
    if (res.error) return setErr('Something went wrong. Please try again.')
    onSaved()
  }

  return (
    <Dialog
      open
      origin={origin}
      onClose={onClose}
      title={confirmDelete ? `Delete ${item?.name}?` : item ? `Edit ${item.name}` : '+ Add grade item'}
      footer={
        confirmDelete ? (
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" onClick={remove}>Delete</Button>
          </>
        ) : (
          <>
            {item && !isAtt && <Button variant="danger" style={{ marginRight: 'auto' }} onClick={() => setConfirmDelete(true)}>Delete</Button>}
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </>
        )
      }
    >
      {confirmDelete ? (
        <p style={{ fontSize: 15, color: 'var(--text-muted)' }}>Any scores entered for this item will be deleted too. This can't be undone.</p>
      ) : (
        <div className="acard dlgform">
          <TextField label="Item" value={name} onChange={(e) => setName(e.target.value)} />
          {!isAtt && <TextField label="Max Points" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/[^\d.]/g, ''))} />}
          {isAtt && <span className="field__hint">Attendance points are set by points per attended session × sessions per course.</span>}
          {err && <div role="alert" className="auth__formerror">{err}</div>}
        </div>
      )}
    </Dialog>
  )
}

function PickCourse({ courses, origin, onClose, onPick }: { courses: { id: string; name: string }[]; origin: HTMLElement | null; onClose: () => void; onPick: (id: string) => void }) {
  const [id, setId] = useState(courses[0]?.id ?? '')
  return (
    <Dialog
      open
      origin={origin}
      onClose={onClose}
      title="+ Add override"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!id} onClick={() => onPick(id)}>Continue</Button>
        </>
      }
    >
      <div className="acard dlgform">
        <SelectField label="Course" value={id} onChange={(e) => setId(e.target.value)}>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
        <span className="field__hint">The course starts with a copy of the shared grade items, which you can then change.</span>
      </div>
    </Dialog>
  )
}

function EditOverride({
  course,
  items,
  eventId,
  origin,
  onClose,
  onChanged,
}: {
  course: { id: string; name: string }
  items: Item[]
  eventId: string
  origin: HTMLElement | null
  onClose: () => void
  onChanged: () => void
}) {
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newMax, setNewMax] = useState('')
  const save = useAutosave<Record<string, { name?: string; max_points?: number }>>(async (patch) => {
    for (const [id, row] of Object.entries(patch)) {
      if (!row) continue
      const res = await supabase.from('grade_items').update(row).eq('id', id)
      if (res.error) return res
    }
    onChanged()
  })
  const [local, setLocal] = useState(items)
  useEffect(() => setLocal(items), [items])

  async function add() {
    const m = Number(newMax)
    if (!newName.trim() || Number.isNaN(m)) return
    await supabase.from('grade_items').insert({ event_id: eventId, course_id: course.id, name: newName.trim(), kind: 'manual', max_points: m, sort: local.length + 1 })
    setNewName('')
    setNewMax('')
    setAdding(false)
    onChanged()
  }
  async function removeItem(id: string) {
    const res = await supabase.from('grade_items').delete().eq('id', id)
    if (res.error) return toast('Something went wrong. Please try again.', 'error')
    onChanged()
  }
  async function turnOff() {
    const res = await supabase.rpc('admin_set_course_override', { p_course: course.id, p_on: false })
    if (res.error) return toast(res.error.code === '23503' ? 'This course already has scores on its own grade items' : 'Something went wrong. Please try again.', 'error')
    onChanged()
    onClose()
  }

  return (
    <Dialog
      open
      origin={origin}
      onClose={onClose}
      title={`${course.name} Grade Items`}
      width={560}
      footer={
        <>
          <Button variant="outline" className="btn--danger-outline" style={{ marginRight: 'auto' }} onClick={turnOff}>Use shared items</Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <div className="acard dlgform">
        {local.map((i) => (
          <div key={i.id} className="ovrow">
            <input
              className="input"
              aria-label="Item"
              value={i.name}
              onChange={(e) => {
                setLocal((xs) => xs.map((x) => (x.id === i.id ? { ...x, name: e.target.value } : x)))
                if (e.target.value.trim()) save.change({ [i.id]: { name: e.target.value.trim(), max_points: Number(i.max_points) } })
              }}
            />
            <input
              className="input ovrow__max"
              aria-label={`Max points for ${i.name}`}
              inputMode="numeric"
              value={num(Number(i.max_points))}
              readOnly={i.kind === 'attendance'}
              onChange={(e) => {
                const v = Number(e.target.value.replace(/[^\d.]/g, ''))
                if (Number.isNaN(v)) return
                setLocal((xs) => xs.map((x) => (x.id === i.id ? { ...x, max_points: v } : x)))
                save.change({ [i.id]: { name: i.name.trim() || undefined, max_points: v } })
              }}
            />
            {i.kind !== 'attendance' ? (
              <button type="button" className="btn btn--sm btn--danger-outline" aria-label={`Remove ${i.name}`} onClick={() => removeItem(i.id)}>×</button>
            ) : (
              <span style={{ width: 34 }} />
            )}
          </div>
        ))}
        {adding ? (
          <div className="ovrow">
            <input className="input" aria-label="New item name" placeholder="Item" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input className="input ovrow__max" aria-label="New item max points" placeholder="Max" inputMode="numeric" value={newMax} onChange={(e) => setNewMax(e.target.value.replace(/[^\d.]/g, ''))} />
            <Button size="sm" onClick={add}>+ Add</Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}>+ Add grade item</Button>
        )}
        <SavedStatus state={save.state} />
      </div>
    </Dialog>
  )
}
