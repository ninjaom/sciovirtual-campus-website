import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { must, useLoad } from '../../lib/useLoad'
import { useCurrentEvent } from '../../lib/useEvent'
import { useAutosave } from '../../lib/useAutosave'
import { Button, Card, Pill, SavedStatus, SearchInput, Skeleton, Switch, TableWrap, Tabs, TextField } from '../../components/ui'
import { Dialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import { AdminHead, Chip, LoadError, Note } from './AdminBits'
import { ImportDialog } from './ImportDialog'

interface CourseRow {
  id: string
  short_code: string
  name: string
  time_slot: string | null
  zoom_join_url: string | null
  archived: boolean
  course_staff: { person_id: string }[]
  enrollments: { count: number }[]
  course_zoom_hosts: { host_email: string | null; host_password: string | null } | null
  grade_items: { id: string }[]
}
interface Instructor {
  id: string
  first_name: string
  last_name: string
  person_code: string
}

export function Courses() {
  const toast = useToast()
  const ev = useCurrentEvent()
  const eventId = ev.data?.event?.id ?? null
  const [tab, setTab] = useState<'act' | 'arc'>('act')
  const [selId, setSelId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [origin, setOrigin] = useState<HTMLElement | null>(null)

  const { data, error, reload, setData } = useLoad(
    async () => {
      if (!eventId) return null
      const [courses, instructors] = await Promise.all([
        supabase
          .from('courses')
          .select('id, short_code, name, time_slot, zoom_join_url, archived, course_staff(person_id), enrollments(count), course_zoom_hosts(host_email, host_password), grade_items(id)')
          .eq('event_id', eventId)
          .order('sort')
          .order('name'),
        supabase.from('people').select('id, first_name, last_name, person_code').eq('role', 'instructor').order('first_name'),
      ])
      return { courses: must(courses) as unknown as CourseRow[], instructors: must(instructors) as Instructor[] }
    },
    [eventId],
  )

  const list = (data?.courses ?? []).filter((c) => c.archived === (tab === 'arc'))
  const sel = list.find((c) => c.id === selId) ?? list[0] ?? null
  const insName = new Map((data?.instructors ?? []).map((i) => [i.id, `${i.first_name} ${i.last_name}`]))

  function patchLocal(id: string, patch: Partial<CourseRow>) {
    setData((d) => (d ? { ...d, courses: d.courses.map((c) => (c.id === id ? { ...c, ...patch } : c)) } : d))
  }

  return (
    <>
      <AdminHead eyebrow={ev.data?.event ? `${ev.data.event.year} camp` : undefined} title="Courses">
        <Button variant="secondary" onClick={(e) => { setOrigin(e.currentTarget); setImporting(true) }}>Import CSV</Button>
        <Button onClick={(e) => { setOrigin(e.currentTarget); setAdding(true) }}>+ Add Course</Button>
      </AdminHead>
      {error && <LoadError message={error} />}
      <Tabs label="Course status" value={tab} onChange={(t) => { setTab(t); setSelId(null) }} options={[{ value: 'act', label: 'Active' }, { value: 'arc', label: 'Archived' }]} />

      <div className="arow courses">
        <Card className="acard courses__list">
          {!data ? (
            <Skeleton height={160} />
          ) : (
            <TableWrap>
              <table className="atable" style={{ minWidth: 620 }}>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Course</th>
                    <th>Time</th>
                    <th className="num">Instructors</th>
                    <th className="num">Students</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => (
                    <tr
                      key={c.id}
                      className={'clickable' + (sel?.id === c.id ? ' is-picked' : '')}
                      onClick={() => setSelId(c.id)}
                      tabIndex={0}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSelId(c.id)}
                      aria-selected={sel?.id === c.id}
                    >
                      <td className="ink">{c.short_code}</td>
                      <td className="strong">{c.name}</td>
                      <td className="muted">{c.time_slot}</td>
                      <td className="num">{c.course_staff.length}</td>
                      <td className="num">{c.enrollments[0]?.count ?? 0}</td>
                    </tr>
                  ))}
                  {list.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 20 }}>
                        {tab === 'act' ? '[No courses yet]' : '[No archived courses]'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </TableWrap>
          )}
          <Note>Note: courses with scores or attendance can be archived, not deleted</Note>
        </Card>

        {sel && data && (
          <CourseDetails
            key={sel.id}
            course={sel}
            instructors={data.instructors}
            insName={insName}
            origin={origin}
            setOrigin={setOrigin}
            onLocal={(p) => patchLocal(sel.id, p)}
            onReload={reload}
            onDeleted={() => { setSelId(null); reload(); toast('Deleted') }}
          />
        )}
      </div>

      {adding && eventId && (
        <AddCourse eventId={eventId} origin={origin} onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); setTab('act'); setSelId(id); reload(); toast('Added') }} />
      )}
      {importing && eventId && <ImportDialog initial="courses" kinds={['courses']} eventId={eventId} origin={origin} onClose={() => setImporting(false)} onDone={reload} />}
    </>
  )
}

function CourseDetails({
  course,
  instructors,
  insName,
  origin,
  setOrigin,
  onLocal,
  onReload,
  onDeleted,
}: {
  course: CourseRow
  instructors: Instructor[]
  insName: Map<string, string>
  origin: HTMLElement | null
  setOrigin: (el: HTMLElement) => void
  onLocal: (p: Partial<CourseRow>) => void
  onReload: () => void
  onDeleted: () => void
}) {
  const toast = useToast()
  const [f, setF] = useState({
    name: course.name,
    short_code: course.short_code,
    time_slot: course.time_slot ?? '',
    zoom_join_url: course.zoom_join_url ?? '',
    host_email: course.course_zoom_hosts?.host_email ?? '',
    host_password: course.course_zoom_hosts?.host_password ?? '',
  })
  const [codeErr, setCodeErr] = useState<string | null>(null)
  const [showPw, setShowPw] = useState(false)
  const [picking, setPicking] = useState(false)
  const [custom, setCustom] = useState(course.grade_items.length > 0)
  useEffect(() => setCustom(course.grade_items.length > 0), [course.grade_items.length])

  const saveCourse = useAutosave<{ name: string; short_code: string; time_slot: string | null; zoom_join_url: string | null }>(async (patch) => {
    const res = await supabase.from('courses').update(patch).eq('id', course.id)
    if (res.error?.code === '23505') setCodeErr('Another course already uses that code')
    else if (!res.error) {
      setCodeErr(null)
      onLocal(patch as Partial<CourseRow>)
    }
    return res
  })
  const saveHost = useAutosave<{ host_email: string | null; host_password: string | null }>((patch) =>
    supabase.from('course_zoom_hosts').upsert({ course_id: course.id, ...patch }),
  )
  const state = saveCourse.state === 'error' || saveHost.state === 'error' ? 'error' : saveCourse.state === 'saving' || saveHost.state === 'saving' ? 'saving' : 'saved'

  function edit(k: keyof typeof f, v: string) {
    setF((x) => ({ ...x, [k]: v }))
    if (k === 'host_email' || k === 'host_password') saveHost.change({ [k]: v.trim() || null })
    else if (k === 'name' || k === 'short_code') {
      if (v.trim()) saveCourse.change({ [k]: k === 'short_code' ? v.trim().toUpperCase() : v.trim() })
    } else saveCourse.change({ [k]: v.trim() || null })
  }

  async function removeInstructor(pid: string) {
    const res = await supabase.from('course_staff').delete().eq('course_id', course.id).eq('person_id', pid)
    if (res.error) return toast('Something went wrong. Please try again.', 'error')
    onLocal({ course_staff: course.course_staff.filter((s) => s.person_id !== pid) })
  }
  async function addInstructor(pid: string) {
    const res = await supabase.from('course_staff').insert({ course_id: course.id, person_id: pid })
    if (res.error) return toast('Something went wrong. Please try again.', 'error')
    onLocal({ course_staff: [...course.course_staff, { person_id: pid }] })
  }
  async function toggleCustom(on: boolean) {
    setCustom(on)
    const res = await supabase.rpc('admin_set_course_override', { p_course: course.id, p_on: on })
    if (res.error) {
      setCustom(!on)
      return toast(res.error.code === '23503' ? 'This course already has scores on its own grade items' : 'Something went wrong. Please try again.', 'error')
    }
    toast(on ? 'This course now has its own grade items (edit them in Grade Items)' : 'This course uses the shared grade items again')
    onReload()
  }
  async function setArchived(archived: boolean) {
    const res = await supabase.from('courses').update({ archived }).eq('id', course.id)
    if (res.error) return toast('Something went wrong. Please try again.', 'error')
    toast(archived ? 'Archived' : 'Restored')
    onReload()
  }
  async function remove() {
    const res = await supabase.from('courses').delete().eq('id', course.id)
    if (res.error) return toast(res.error.code === '23503' ? 'This course has students or scores, so it can only be archived' : 'Something went wrong. Please try again.', 'error')
    onDeleted()
  }

  const students = course.enrollments[0]?.count ?? 0

  return (
    <Card
      className="acard courses__detail"
      title={f.name || course.name}
      actions={<Pill tone={course.archived ? 'grey' : 'green'}>{course.archived ? 'Archived' : 'Active'}</Pill>}
    >
      <TextField label="Course name" value={f.name} onChange={(e) => edit('name', e.target.value)} />
      <div className="fieldrow tight">
        <TextField label="Code" value={f.short_code} onChange={(e) => edit('short_code', e.target.value.toUpperCase())} error={codeErr ?? undefined} fieldStyle={{ flex: '1 1 90px' }} />
        <TextField label="Time slot" value={f.time_slot} onChange={(e) => edit('time_slot', e.target.value)} fieldStyle={{ flex: '1 1 150px' }} />
      </div>
      <TextField label="Zoom link" value={f.zoom_join_url} onChange={(e) => edit('zoom_join_url', e.target.value)} />
      <div className="fieldrow">
        <TextField label="Zoom host email" value={f.host_email} onChange={(e) => edit('host_email', e.target.value)} autoComplete="off" fieldStyle={{ flex: '1 1 180px' }} />
        <div className="field" style={{ flex: '1 1 120px' }}>
          <label htmlFor="c-hostpw" className="field__label">Zoom host password</label>
          <div className="pwrow">
            <input
              id="c-hostpw"
              className="input"
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              value={f.host_password}
              onChange={(e) => edit('host_password', e.target.value)}
            />
            <button type="button" className="pwrow__eye" aria-label={showPw ? 'Hide password' : 'Show password'} onClick={() => setShowPw((s) => !s)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
                <circle cx="12" cy="12" r="3" />
                {showPw && <path d="M3 3l18 18" />}
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div className="field">
        <span className="field__label">Instructors</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {course.course_staff.map((s) => (
            <Chip key={s.person_id} onRemove={() => removeInstructor(s.person_id)} removeLabel={`Remove ${insName.get(s.person_id)}`}>
              {insName.get(s.person_id) ?? '—'}
            </Chip>
          ))}
          <Button variant="outline" size="sm" onClick={(e) => { setOrigin(e.currentTarget); setPicking(true) }}>+ Add</Button>
        </div>
      </div>
      <div className="switchrow">
        <span>Use custom grade items for this course</span>
        <Switch checked={custom} onChange={toggleCustom} label="Custom grade items" />
      </div>
      <div className="detailfoot">
        {course.archived ? (
          <span style={{ display: 'flex', gap: 8 }}>
            <Button variant="outline" size="sm" onClick={() => setArchived(false)}>Restore Course</Button>
          </span>
        ) : students === 0 ? (
          <span style={{ display: 'flex', gap: 8 }}>
            <Button variant="outline" size="sm" className="btn--danger-outline" onClick={() => setArchived(true)}>Archive Course</Button>
            <Button variant="outline" size="sm" className="btn--danger-outline" onClick={remove}>Delete</Button>
          </span>
        ) : (
          <Button variant="outline" size="sm" className="btn--danger-outline" onClick={() => setArchived(true)}>Archive Course</Button>
        )}
        <SavedStatus state={state} />
      </div>

      {picking && (
        <PickInstructor
          instructors={instructors.filter((i) => !course.course_staff.some((s) => s.person_id === i.id))}
          origin={origin}
          onClose={() => setPicking(false)}
          onPick={(id) => { setPicking(false); addInstructor(id) }}
        />
      )}
    </Card>
  )
}

function PickInstructor({ instructors, origin, onClose, onPick }: { instructors: Instructor[]; origin: HTMLElement | null; onClose: () => void; onPick: (id: string) => void }) {
  const [q, setQ] = useState('')
  const n = q.trim().toLowerCase()
  const list = instructors.filter((i) => !n || `${i.first_name} ${i.last_name} ${i.person_code}`.toLowerCase().includes(n))
  return (
    <Dialog open origin={origin} onClose={onClose} title="+ Add Instructor" width={460} footer={<Button variant="secondary" onClick={onClose}>Cancel</Button>}>
      <SearchInput placeholder="Search by ID or name" aria-label="Search instructors" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%' }} autoFocus />
      <div className="memberlist">
        {list.map((i) => (
          <button key={i.id} type="button" className="lrow pickrow" onClick={() => onPick(i.id)}>
            <span className="lrow__text">
              <span className="lrow__title">{i.first_name} {i.last_name}</span>
              <span className="lrow__sub">{i.person_code}</span>
            </span>
            <span aria-hidden="true">+</span>
          </button>
        ))}
        {list.length === 0 && <span className="field__hint">[No instructors found. Add them in Accounts.]</span>}
      </div>
    </Dialog>
  )
}

function AddCourse({ eventId, origin, onClose, onSaved }: { eventId: string; origin: HTMLElement | null; onClose: () => void; onSaved: (id: string) => void }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [time, setTime] = useState('')
  const [err, setErr] = useState<string | null>(null)
  async function save() {
    if (!name.trim() || !code.trim()) return setErr('Course name and code are required')
    const res = await supabase.from('courses').insert({ event_id: eventId, name: name.trim(), short_code: code.trim().toUpperCase(), time_slot: time.trim() || null }).select('id').single()
    if (res.error) return setErr(res.error.code === '23505' ? 'Another course already uses that code' : 'Something went wrong. Please try again.')
    onSaved(res.data.id)
  }
  return (
    <Dialog
      open
      origin={origin}
      onClose={onClose}
      title="+ Add Course"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>+ Add Course</Button>
        </>
      }
    >
      <div className="acard dlgform">
        <TextField label="Course name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="fieldrow">
          <TextField label="Code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="COA" />
          <TextField label="Time slot" value={time} onChange={(e) => setTime(e.target.value)} placeholder="1–2 PM ET" />
        </div>
        {err && <div role="alert" className="auth__formerror">{err}</div>}
      </div>
    </Dialog>
  )
}
