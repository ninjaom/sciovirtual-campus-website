import { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { must, useLoad } from '../../lib/useLoad'
import { useCurrentEvent } from '../../lib/useEvent'
import { useAutosave } from '../../lib/useAutosave'
import { downloadFile, toCsv } from '../../lib/csv'
import { Button, Card, Pill, SavedStatus, SearchInput, SelectField, Skeleton, TableWrap, Tabs, TextField } from '../../components/ui'
import { Dialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import { AdminHead, LoadError, Note } from './AdminBits'
import { ImportDialog, type ImportKind } from './ImportDialog'

type Tab = 'stu' | 'ins' | 'adm' | 'team'

interface Person {
  id: string
  person_code: string
  role: 'student' | 'instructor' | 'admin'
  first_name: string
  last_name: string
  username: string | null
  auth_user_id: string | null
  email: string | null
  grade: number | null
  school: string | null
  city: string | null
  state: string | null
  student_email: string | null
  parent_email: string | null
  team_members: { team_id: string }[]
  course_staff: { course_id: string }[]
  setup_codes: { code: string; used_at: string | null }[]
}
interface Team {
  id: string
  number: number | null
  name: string
  counselors: string | null
}
interface Course {
  id: string
  short_code: string
  name: string
}

const PERSON_COLS =
  'id, person_code, role, first_name, last_name, username, auth_user_id, email, grade, school, city, state, student_email, parent_email, team_members(team_id), course_staff(course_id), setup_codes!setup_codes_person_id_fkey(code, used_at)'

function openCode(p: Person): string | null {
  return p.setup_codes.find((c) => !c.used_at)?.code ?? null
}

function status(p: Person): { text: string; tone: 'green' | 'amber' | 'grey' } {
  if (p.auth_user_id) return { text: 'Signed up', tone: 'green' }
  const code = openCode(p)
  return code ? { text: `Setup code: ${code}`, tone: 'amber' } : { text: 'Not started', tone: 'grey' }
}

const NOTES: Record<Tab, string> = {
  stu: 'Note: student info comes from the registration import; usernames are set by students at sign-up',
  ins: 'Note: an instructor can be linked to more than one course',
  adm: 'Note: all admins have full access',
  team: 'Note: team assignments come from the team roster import',
}
const TITLES: Record<Tab, string> = { stu: 'Students', ins: 'Instructors', adm: 'Admins', team: 'Teams' }

export function Accounts() {
  const toast = useToast()
  const ev = useCurrentEvent()
  const eventId = ev.data?.event?.id ?? null
  const [tab, setTab] = useState<Tab>('stu')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Person | null>(null)
  const [resetting, setResetting] = useState<Person | null>(null)
  const [adding, setAdding] = useState(false)
  const [teamEdit, setTeamEdit] = useState<Team | 'new' | null>(null)
  const [members, setMembers] = useState<Team | null>(null)
  const [importing, setImporting] = useState(false)
  const [origin, setOrigin] = useState<HTMLElement | null>(null)

  const { data, error, reload } = useLoad(async () => {
    const [people, teams, courses] = await Promise.all([
      supabase.from('people').select(PERSON_COLS).order('person_code'),
      supabase.from('teams').select('id, number, name, counselors').order('number', { nullsFirst: false }).order('name'),
      supabase.from('courses').select('id, short_code, name').eq('archived', false).order('name'),
    ])
    return { people: must(people) as unknown as Person[], teams: must(teams) as Team[], courses: must(courses) as Course[] }
  })

  const teamName = useMemo(() => new Map((data?.teams ?? []).map((t) => [t.id, t.name])), [data])
  const courseName = useMemo(() => new Map((data?.courses ?? []).map((c) => [c.id, c.name])), [data])

  const role = tab === 'stu' ? 'student' : tab === 'ins' ? 'instructor' : tab === 'adm' ? 'admin' : null
  const needle = q.trim().toLowerCase()
  const list = (data?.people ?? []).filter(
    (p) => p.role === role && (!needle || `${p.person_code} ${p.first_name} ${p.last_name} ${p.username ?? ''}`.toLowerCase().includes(needle)),
  )
  const teams = (data?.teams ?? []).filter((t) => !needle || `${t.number ?? ''} ${t.name} ${t.counselors ?? ''}`.toLowerCase().includes(needle))
  const memberCount = (teamId: string) => (data?.people ?? []).filter((p) => p.team_members.some((m) => m.team_id === teamId)).length

  async function newCode(p: Person) {
    const { data: code, error: err } = await supabase.rpc('admin_new_setup_code', { p_person: p.id })
    if (err) return toast('Something went wrong. Please try again.', 'error')
    toast(`New setup code: ${code}`)
    reload()
  }

  function downloadCodes() {
    const rows = list.filter((p) => !p.auth_user_id && openCode(p))
    const header = ['ID', 'First Name', 'Last Name', ...(role === 'student' ? ['Parent Email'] : ['Email']), 'Setup Code']
    const body = rows.map((p) => [p.person_code, p.first_name, p.last_name, role === 'student' ? p.parent_email : p.email, openCode(p)])
    downloadFile(`setup-codes-${TITLES[tab].toLowerCase()}.csv`, toCsv([header, ...body]))
  }

  const cols =
    tab === 'stu'
      ? ['Student ID', 'First Name', 'Last Name', 'Username', 'Team', 'Status']
      : tab === 'ins'
        ? ['Instructor ID', 'First Name', 'Last Name', 'Course', 'Email', 'Status']
        : ['Admin ID', 'First Name', 'Last Name', 'Email', 'Status']

  return (
    <>
      <AdminHead title="Accounts">
        <Button variant="secondary" onClick={(e) => { setOrigin(e.currentTarget); setImporting(true) }}>
          Import CSV
        </Button>
        <Button onClick={(e) => { setOrigin(e.currentTarget); if (tab === 'team') setTeamEdit('new'); else setAdding(true) }}>
          {tab === 'team' ? '+ Add Team' : '+ Add Account'}
        </Button>
      </AdminHead>
      {error && <LoadError message={error} />}

      <Tabs
        label="Account type"
        value={tab}
        onChange={(t) => { setTab(t); setQ('') }}
        options={[
          { value: 'stu', label: 'Students' },
          { value: 'ins', label: 'Instructors' },
          { value: 'adm', label: 'Admins' },
          { value: 'team', label: 'Teams' },
        ]}
      />

      <Card
        className="acard"
        title={TITLES[tab]}
        actions={
          <>
            <SearchInput aria-label="Search accounts" placeholder="Search by ID or name" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
            {(tab === 'stu' || tab === 'ins') && (
              <Button variant="outline" size="sm" onClick={downloadCodes}>
                Download Setup Codes
              </Button>
            )}
          </>
        }
      >
        {tab === 'adm' && ev.data?.settings && <AdminPrefix eventId={ev.data.settings.event_id} initial={ev.data.settings.admin_id_prefix} />}

        {!data ? (
          <TableSkeleton />
        ) : tab === 'team' ? (
          <TableWrap>
            <table className="atable" style={{ minWidth: 700 }}>
              <thead>
                <tr>
                  <th>Team #</th>
                  <th>Team name</th>
                  <th>Counselor(s)</th>
                  <th className="num">Members</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {teams.map((t) => (
                  <tr key={t.id}>
                    <td>{t.number != null ? `Team ${t.number}` : '—'}</td>
                    <td className="strong">{t.name}</td>
                    <td>{t.counselors}</td>
                    <td className="num">{memberCount(t.id)}</td>
                    <td className="actions">
                      <Button variant="outline" size="sm" onClick={(e) => { setOrigin(e.currentTarget); setMembers(t) }}>Members</Button>
                      <Button variant="outline" size="sm" onClick={(e) => { setOrigin(e.currentTarget); setTeamEdit(t) }}>Edit</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <TableWrap>
            <table className="atable" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  {cols.map((c) => <th key={c}>{c}</th>)}
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => {
                  const st = status(p)
                  return (
                    <tr key={p.id}>
                      <td>{p.person_code}</td>
                      <td>{p.first_name}</td>
                      <td>{p.last_name}</td>
                      {tab === 'stu' && <td>{p.username ?? '—'}</td>}
                      {tab === 'stu' && <td>{p.team_members.map((m) => teamName.get(m.team_id)).filter(Boolean).join(', ') || '—'}</td>}
                      {tab === 'ins' && <td className="wrap">{p.course_staff.map((c) => courseName.get(c.course_id)).filter(Boolean).join(', ') || '—'}</td>}
                      {tab !== 'stu' && <td>{p.email ?? '—'}</td>}
                      <td><Pill tone={st.tone}>{st.text}</Pill></td>
                      <td className="actions">
                        {p.auth_user_id ? (
                          <Button variant="outline" size="sm" onClick={(e) => { setOrigin(e.currentTarget); setResetting(p) }}>Reset password</Button>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => newCode(p)}>New setup code</Button>
                        )}
                        <Button variant="outline" size="sm" onClick={(e) => { setOrigin(e.currentTarget); setEditing(p) }}>Edit</Button>
                      </td>
                    </tr>
                  )
                })}
                {list.length === 0 && (
                  <tr>
                    <td colSpan={cols.length + 1} className="muted" style={{ textAlign: 'center', padding: 20 }}>
                      {needle ? '[No accounts match your search]' : '[No accounts yet]'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Note>{NOTES[tab]}</Note>
      </Card>

      {/* Reset password */}
      <Dialog
        open={!!resetting}
        origin={origin}
        onClose={() => setResetting(null)}
        title={`Reset password for ${resetting?.username ?? `${resetting?.first_name} ${resetting?.last_name}`}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetting(null)}>Cancel</Button>
            <Button onClick={async () => { const p = resetting!; setResetting(null); await newCode(p) }}>Reset password</Button>
          </>
        }
      >
        <p style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--text-muted)' }}>
          A new, unique set-up code will be created - that's what they'll use to set a new password.
        </p>
      </Dialog>

      {editing && data && (
        <EditPerson person={editing} teams={data.teams} courses={data.courses} eventId={eventId} origin={origin} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); toast('All changes saved') }} />
      )}
      {adding && data && (
        <AddPerson
          initialRole={role ?? 'student'}
          teams={data.teams}
          courses={data.courses}
          eventId={eventId}
          adminPrefix={ev.data?.settings?.admin_id_prefix ?? 'ADM'}
          origin={origin}
          onClose={() => setAdding(false)}
          onSaved={(code) => { setAdding(false); reload(); toast(`Added. Setup code: ${code}`) }}
        />
      )}
      {teamEdit && eventId && (
        <EditTeam team={teamEdit === 'new' ? null : teamEdit} eventId={eventId} origin={origin} onClose={() => setTeamEdit(null)} onSaved={() => { setTeamEdit(null); reload(); toast('All changes saved') }} />
      )}
      {members && data && eventId && (
        <TeamMembers team={members} people={data.people} eventId={eventId} origin={origin} onClose={() => setMembers(null)} onChanged={reload} />
      )}
      {importing && eventId && (
        <ImportDialog
          initial={(tab === 'ins' ? 'instructors' : tab === 'team' ? 'teams' : 'students') as ImportKind}
          kinds={['students', 'instructors', 'teams']}
          eventId={eventId}
          origin={origin}
          onClose={() => setImporting(false)}
          onDone={() => reload()}
        />
      )}
    </>
  )
}

function TableSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0' }}>
      {[200, 160, 220, 180, 150].map((w, i) => (
        <Skeleton key={i} width={w} height={16} />
      ))}
    </div>
  )
}

function AdminPrefix({ eventId, initial }: { eventId: string; initial: string }) {
  const [value, setValue] = useState(initial)
  const save = useAutosave<{ admin_id_prefix: string }>((patch) => supabase.from('settings').update(patch).eq('event_id', eventId))
  return (
    <div className="prefixbox">
      <TextField
        id="adm-prefix"
        label="Admin ID prefix"
        value={value}
        hint="e.g. ADM27AB01"
        onChange={(e) => {
          const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
          setValue(v)
          if (v) save.change({ admin_id_prefix: v })
        }}
      />
      <SavedStatus state={save.state} />
    </div>
  )
}

/* ---------------- Edit a person ---------------- */

function EditPerson({
  person,
  teams,
  courses,
  eventId,
  origin,
  onClose,
  onSaved,
}: {
  person: Person
  teams: Team[]
  courses: Course[]
  eventId: string | null
  origin: HTMLElement | null
  onClose: () => void
  onSaved: () => void
}) {
  const [f, setF] = useState({
    first_name: person.first_name,
    last_name: person.last_name,
    username: person.username ?? '',
    email: person.email ?? '',
    grade: person.grade?.toString() ?? '',
    school: person.school ?? '',
    city: person.city ?? '',
    state: person.state ?? '',
    student_email: person.student_email ?? '',
    parent_email: person.parent_email ?? '',
  })
  const [team, setTeam] = useState(person.team_members[0]?.team_id ?? '')
  const [staffOf, setStaffOf] = useState<string[]>(person.course_staff.map((c) => c.course_id))
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const isStu = person.role === 'student'

  async function save() {
    if (!f.first_name.trim() || !f.last_name.trim()) return setErr('First and last name are required')
    setBusy(true)
    setErr(null)
    const patch: Record<string, unknown> = { first_name: f.first_name.trim(), last_name: f.last_name.trim() }
    if (isStu) {
      Object.assign(patch, {
        username: f.username.trim() || null,
        grade: f.grade ? Number(f.grade) : null,
        school: f.school.trim() || null,
        city: f.city.trim() || null,
        state: f.state.trim() || null,
        student_email: f.student_email.trim() || null,
        parent_email: f.parent_email.trim() || null,
      })
    } else patch.email = f.email.trim() || null
    const { error } = await supabase.from('people').update(patch).eq('id', person.id)
    if (error) {
      setBusy(false)
      return setErr(error.code === '23505' ? 'That username is already taken' : error.code === '23514' ? 'Use 3–24 letters, numbers, underscores or periods' : 'Something went wrong. Please try again.')
    }
    if (isStu && eventId) {
      const current = person.team_members[0]?.team_id ?? ''
      if (team !== current) {
        await supabase.from('team_members').delete().eq('person_id', person.id).eq('event_id', eventId)
        if (team) await supabase.from('team_members').insert({ team_id: team, person_id: person.id, event_id: eventId })
      }
    }
    if (person.role === 'instructor') {
      const before = person.course_staff.map((c) => c.course_id)
      const add = staffOf.filter((c) => !before.includes(c))
      const remove = before.filter((c) => !staffOf.includes(c))
      if (add.length) await supabase.from('course_staff').insert(add.map((course_id) => ({ course_id, person_id: person.id })))
      if (remove.length) await supabase.from('course_staff').delete().eq('person_id', person.id).in('course_id', remove)
    }
    onSaved()
  }

  return (
    <Dialog
      open
      origin={origin}
      onClose={onClose}
      title={`Edit ${person.first_name} ${person.last_name}`}
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>Save</Button>
        </>
      }
    >
      <div className="acard dlgform">
        <div className="fieldrow">
          <TextField label="First Name" value={f.first_name} onChange={set('first_name')} />
          <TextField label="Last Name" value={f.last_name} onChange={set('last_name')} />
        </div>
        {isStu ? (
          <>
            <TextField label="Username" value={f.username} onChange={set('username')} spellCheck={false} />
            <SelectField label="Team" value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">—</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </SelectField>
            <div className="fieldrow">
              <TextField label="Grade Level" inputMode="numeric" value={f.grade} onChange={set('grade')} />
              <TextField label="School" value={f.school} onChange={set('school')} />
            </div>
            <div className="fieldrow">
              <TextField label="City" value={f.city} onChange={set('city')} />
              <TextField label="State" value={f.state} onChange={set('state')} />
            </div>
            <TextField label="Student Email" type="email" value={f.student_email} onChange={set('student_email')} />
            <TextField label="Parent Email" type="email" value={f.parent_email} onChange={set('parent_email')} />
          </>
        ) : (
          <TextField label="Email" type="email" value={f.email} onChange={set('email')} />
        )}
        {person.role === 'instructor' && (
          <CoursePicker courses={courses} value={staffOf} onChange={setStaffOf} />
        )}
        {err && <div role="alert" className="auth__formerror">{err}</div>}
      </div>
    </Dialog>
  )
}

function CoursePicker({ courses, value, onChange }: { courses: Course[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset className="coursepick">
      <legend className="field__label">Course</legend>
      <div className="coursepick__list">
        {courses.map((c) => (
          <label key={c.id} className="coursepick__item">
            <input type="checkbox" checked={value.includes(c.id)} onChange={(e) => onChange(e.target.checked ? [...value, c.id] : value.filter((x) => x !== c.id))} />
            {c.name}
          </label>
        ))}
        {courses.length === 0 && <span className="field__hint">[Add courses first]</span>}
      </div>
    </fieldset>
  )
}

/* ---------------- Add a person ---------------- */

function AddPerson({
  initialRole,
  teams,
  courses,
  eventId,
  adminPrefix,
  origin,
  onClose,
  onSaved,
}: {
  initialRole: 'student' | 'instructor' | 'admin'
  teams: Team[]
  courses: Course[]
  eventId: string | null
  adminPrefix: string
  origin: HTMLElement | null
  onClose: () => void
  onSaved: (code: string) => void
}) {
  const [role, setRole] = useState(initialRole)
  const [id, setId] = useState('')
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [email, setEmail] = useState('')
  const [team, setTeam] = useState('')
  const [staffOf, setStaffOf] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    setErr(null)
    if (!first.trim() || !last.trim()) return setErr('First and last name are required')
    if (role === 'student' && !/^\d{2}[A-Z]{2}\d{4}$/i.test(id.trim())) return setErr('Student IDs look like 27AA0001')
    if (role === 'instructor' && staffOf.length === 0) return setErr('Pick at least one course')
    setBusy(true)
    let code = id.trim().toUpperCase()
    if (role !== 'student') {
      const prefix = role === 'admin' ? adminPrefix : courses.find((c) => c.id === staffOf[0])!.short_code
      const r = await supabase.rpc('next_person_code', { p_prefix: prefix, p_first: first, p_last: last })
      if (r.error) {
        setBusy(false)
        return setErr('Something went wrong. Please try again.')
      }
      code = r.data as string
    }
    const ins = await supabase
      .from('people')
      .insert({ person_code: code, role, first_name: first.trim(), last_name: last.trim(), email: role === 'student' ? null : email.trim() || null })
      .select('id')
      .single()
    if (ins.error) {
      setBusy(false)
      return setErr(ins.error.code === '23505' ? 'That ID is already in use' : 'Something went wrong. Please try again.')
    }
    const pid = ins.data.id
    if (role === 'student' && team && eventId) await supabase.from('team_members').insert({ team_id: team, person_id: pid, event_id: eventId })
    if (role === 'instructor') await supabase.from('course_staff').insert(staffOf.map((course_id) => ({ course_id, person_id: pid })))
    const sc = await supabase.from('setup_codes').select('code').eq('person_id', pid).is('used_at', null).maybeSingle()
    onSaved(sc.data?.code ?? '')
  }

  return (
    <Dialog
      open
      origin={origin}
      onClose={onClose}
      title="Add Account"
      width={480}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>+ Add Account</Button>
        </>
      }
    >
      <div className="acard dlgform">
        <Tabs
          fill
          label="Account type"
          value={role}
          onChange={(r) => { setRole(r); setErr(null) }}
          options={[
            { value: 'student', label: 'Students' },
            { value: 'instructor', label: 'Instructors' },
            { value: 'admin', label: 'Admins' },
          ]}
        />
        {role === 'student' && <TextField label="Student ID" value={id} onChange={(e) => setId(e.target.value.toUpperCase())} placeholder="27AA0001" spellCheck={false} />}
        <div className="fieldrow">
          <TextField label="First Name" value={first} onChange={(e) => setFirst(e.target.value)} />
          <TextField label="Last Name" value={last} onChange={(e) => setLast(e.target.value)} />
        </div>
        {role === 'student' ? (
          <SelectField label="Team" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">—</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </SelectField>
        ) : (
          <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        )}
        {role === 'instructor' && <CoursePicker courses={courses} value={staffOf} onChange={setStaffOf} />}
        {role !== 'student' && <span className="field__hint">The ID is created automatically (e.g. {role === 'admin' ? `${adminPrefix}27AB01` : 'COA27AB01'}).</span>}
        {err && <div role="alert" className="auth__formerror">{err}</div>}
      </div>
    </Dialog>
  )
}

/* ---------------- Teams ---------------- */

function EditTeam({ team, eventId, origin, onClose, onSaved }: { team: Team | null; eventId: string; origin: HTMLElement | null; onClose: () => void; onSaved: () => void }) {
  const [num, setNum] = useState(team?.number?.toString() ?? '')
  const [name, setName] = useState(team?.name ?? '')
  const [counselors, setCounselors] = useState(team?.counselors ?? '')
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    if (!name.trim()) return setErr('Team name is required')
    const row = { event_id: eventId, number: num ? Number(num) : null, name: name.trim(), counselors: counselors.trim() || null }
    const res = team ? await supabase.from('teams').update(row).eq('id', team.id) : await supabase.from('teams').insert(row)
    if (res.error) return setErr(res.error.code === '23505' ? 'There is already a team with that name' : 'Something went wrong. Please try again.')
    onSaved()
  }
  async function remove() {
    if (!team) return
    const res = await supabase.from('teams').delete().eq('id', team.id)
    if (res.error) return setErr('Something went wrong. Please try again.')
    onSaved()
  }

  return (
    <Dialog
      open
      origin={origin}
      onClose={onClose}
      title={team ? `Edit ${team.name}` : '+ Add Team'}
      footer={
        <>
          {team && <Button variant="danger" onClick={remove} style={{ marginRight: 'auto' }}>Delete</Button>}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </>
      }
    >
      <div className="acard dlgform">
        <div className="fieldrow">
          <TextField label="Team #" inputMode="numeric" value={num} onChange={(e) => setNum(e.target.value.replace(/\D/g, ''))} />
          <TextField label="Team name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <TextField label="Counselor(s)" value={counselors} onChange={(e) => setCounselors(e.target.value)} hint="e.g. Counselor A / Counselor B" />
        {err && <div role="alert" className="auth__formerror">{err}</div>}
      </div>
    </Dialog>
  )
}

function TeamMembers({
  team,
  people,
  eventId,
  origin,
  onClose,
  onChanged,
}: {
  team: Team
  people: Person[]
  eventId: string
  origin: HTMLElement | null
  onClose: () => void
  onChanged: () => void
}) {
  const [add, setAdd] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const members = people.filter((p) => p.team_members.some((m) => m.team_id === team.id))

  async function addMember() {
    setErr(null)
    const p = people.find((x) => x.role === 'student' && x.person_code.toUpperCase() === add.trim().toUpperCase())
    if (!p) return setErr('No student with that ID')
    await supabase.from('team_members').delete().eq('person_id', p.id).eq('event_id', eventId)
    const res = await supabase.from('team_members').insert({ team_id: team.id, person_id: p.id, event_id: eventId })
    if (res.error) return setErr('Something went wrong. Please try again.')
    setAdd('')
    onChanged()
  }
  async function remove(p: Person) {
    await supabase.from('team_members').delete().eq('person_id', p.id).eq('team_id', team.id)
    onChanged()
  }

  return (
    <Dialog open origin={origin} onClose={onClose} title={`${team.name} Members`} width={520} footer={<Button onClick={onClose}>Done</Button>}>
      <div className="acard dlgform">
        <div className="memberadd">
          <TextField label="Add by Student ID" value={add} onChange={(e) => setAdd(e.target.value)} placeholder="27AA0001" error={err ?? undefined} />
          <Button variant="secondary" onClick={addMember}>+ Add</Button>
        </div>
        <div className="memberlist">
          {members.map((p) => (
            <div key={p.id} className="lrow">
              <div className="lrow__text">
                <span className="lrow__title">{p.first_name} {p.last_name}</span>
                <span className="lrow__sub">{p.person_code}{p.username ? ` · ${p.username}` : ''}</span>
              </div>
              <button type="button" className="btn btn--sm btn--danger-outline" aria-label={`Remove ${p.first_name} ${p.last_name}`} onClick={() => remove(p)}>×</button>
            </div>
          ))}
          {members.length === 0 && <span className="field__hint">[No members yet]</span>}
        </div>
      </div>
    </Dialog>
  )
}
