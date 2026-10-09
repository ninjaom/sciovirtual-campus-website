import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { csvObjects, downloadFile, toCsv } from '../../lib/csv'
import { Button, Pill, TableWrap, Tabs } from '../../components/ui'
import { Dialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'

export type ImportKind = 'students' | 'instructors' | 'teams' | 'courses'

const LABEL: Record<ImportKind, string> = { students: 'Students', instructors: 'Instructors', teams: 'Teams', courses: 'Courses' }

/** Template columns (and one example row) for each kind of import. */
const TEMPLATES: Record<ImportKind, string[][]> = {
  students: [
    ['Student ID', 'First Name', 'Last Name', 'Grade Level', 'School', 'City', 'State', 'Student Email', 'Parent Email', 'Team', 'Courses'],
    ['27AA0001', 'First', 'Last', '7', 'School Name', 'Austin', 'TX', 'student@example.com', 'parent@example.com', 'Team A', 'COA; COB'],
  ],
  instructors: [
    ['Instructor ID', 'First Name', 'Last Name', 'Email', 'Courses'],
    ['', 'First', 'Last', 'instructor@example.com', 'COA'],
  ],
  teams: [
    ['Team #', 'Team Name', 'Counselor(s)'],
    ['1', 'Team A', 'Counselor A / Counselor B'],
  ],
  courses: [
    ['Code', 'Course Name', 'Time Slot', 'Days', 'Zoom Link', 'Zoom Host Email', 'Zoom Host Password'],
    ['COA', 'Course A', '1–2 PM ET', 'Mon, Wed, Fri', 'https://zoom.us/j/0000000000', 'host@example.com', 'password'],
  ],
}

interface Row {
  line: number
  values: Record<string, string>
  problem?: string
  isNew?: boolean
}

const pick = (r: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) if (r[k] !== undefined && r[k] !== '') return r[k]
  return ''
}
const splitCodes = (s: string) =>
  s
    .split(/[;,/]/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean)
const chunks = <T,>(xs: T[], n = 200) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

export function ImportDialog({
  initial,
  kinds,
  eventId,
  origin,
  onClose,
  onDone,
}: {
  initial: ImportKind
  kinds: ImportKind[]
  eventId: string
  origin: HTMLElement | null
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const [kind, setKind] = useState<ImportKind>(initial)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])

  async function readFile(file: File) {
    setFileName(file.name)
    setWarnings([])
    const { rows: objs } = csvObjects(await file.text())
    const people = (await supabase.from('people').select('person_code, role')).data ?? []
    const byCode = new Map(people.map((p) => [String(p.person_code).toUpperCase(), p.role as string]))
    const courses = (await supabase.from('courses').select('short_code').eq('event_id', eventId)).data ?? []
    const courseCodes = new Set(courses.map((c) => String(c.short_code).toUpperCase()))
    const teams = (await supabase.from('teams').select('name').eq('event_id', eventId)).data ?? []
    const teamNames = new Set(teams.map((t) => t.name.toLowerCase()))

    const out: Row[] = objs.map((v, i) => {
      const row: Row = { line: i + 2, values: v }
      if (kind === 'students') {
        const id = pick(v, 'studentid', 'id').toUpperCase()
        if (!/^\d{2}[A-Z]{2}\d{4}$/.test(id)) row.problem = 'Student ID should look like 27AA0001'
        else if (!pick(v, 'firstname') || !pick(v, 'lastname')) row.problem = 'Missing first or last name'
        else if (byCode.has(id) && byCode.get(id) !== 'student') row.problem = 'That ID belongs to an instructor or admin'
        else {
          row.isNew = !byCode.has(id)
          const missing = splitCodes(pick(v, 'courses', 'course')).filter((c) => !courseCodes.has(c))
          if (missing.length) row.problem = `Unknown course code: ${missing.join(', ')}`
        }
      } else if (kind === 'instructors') {
        const id = pick(v, 'instructorid', 'id').toUpperCase()
        const codes = splitCodes(pick(v, 'courses', 'course'))
        if (!pick(v, 'firstname') || !pick(v, 'lastname')) row.problem = 'Missing first or last name'
        else if (!codes.length) row.problem = 'Missing course code'
        else if (codes.some((c) => !courseCodes.has(c))) row.problem = `Unknown course code: ${codes.filter((c) => !courseCodes.has(c)).join(', ')}`
        else if (id && byCode.has(id) && byCode.get(id) !== 'instructor') row.problem = 'That ID belongs to a student or admin'
        else row.isNew = !id || !byCode.has(id)
      } else if (kind === 'teams') {
        const name = pick(v, 'teamname', 'name', 'team')
        if (!name) row.problem = 'Missing team name'
        else row.isNew = !teamNames.has(name.toLowerCase())
      } else {
        const code = pick(v, 'code', 'shortcode', 'coursecode').toUpperCase()
        if (!code || !pick(v, 'coursename', 'name', 'course')) row.problem = 'Missing code or course name'
        else row.isNew = !courseCodes.has(code)
      }
      return row
    })
    setRows(out)
  }

  async function run() {
    if (!rows) return
    const good = rows.filter((r) => !r.problem)
    if (!good.length) return
    setBusy(true)
    const warn: string[] = []
    try {
      if (kind === 'teams') {
        for (const part of chunks(good)) {
          const { error } = await supabase.from('teams').upsert(
            part.map((r) => ({
              event_id: eventId,
              number: Number(pick(r.values, 'team', 'teamnumber', 'number')) || null,
              name: pick(r.values, 'teamname', 'name', 'team'),
              counselors: pick(r.values, 'counselors', 'counselor') || null,
            })),
            { onConflict: 'event_id,name' },
          )
          if (error) throw error
        }
      } else if (kind === 'courses') {
        for (const r of good) {
          const v = r.values
          const code = pick(v, 'code', 'shortcode', 'coursecode').toUpperCase()
          const { data, error } = await supabase
            .from('courses')
            .upsert(
              {
                event_id: eventId,
                short_code: code,
                name: pick(v, 'coursename', 'name', 'course'),
                time_slot: pick(v, 'timeslot', 'time') || null,
                days: pick(v, 'days') || null,
                zoom_join_url: pick(v, 'zoomlink', 'zoom') || null,
              },
              { onConflict: 'event_id,short_code' },
            )
            .select('id')
            .single()
          if (error) throw error
          const host = pick(v, 'zoomhostemail'), pw = pick(v, 'zoomhostpassword')
          if (host || pw) await supabase.from('course_zoom_hosts').upsert({ course_id: data.id, host_email: host || null, host_password: pw || null })
        }
      } else {
        const courses = (await supabase.from('courses').select('id, short_code').eq('event_id', eventId)).data ?? []
        const courseId = new Map(courses.map((c) => [String(c.short_code).toUpperCase(), c.id as string]))

        if (kind === 'students') {
          const saved: { id: string; person_code: string }[] = []
          for (const part of chunks(good)) {
            const { data, error } = await supabase
              .from('people')
              .upsert(
                part.map((r) => {
                  const v = r.values
                  return {
                    person_code: pick(v, 'studentid', 'id').toUpperCase(),
                    role: 'student',
                    first_name: pick(v, 'firstname'),
                    last_name: pick(v, 'lastname'),
                    grade: Number(pick(v, 'gradelevel', 'grade')) || null,
                    school: pick(v, 'school') || null,
                    city: pick(v, 'city') || null,
                    state: pick(v, 'state') || null,
                    student_email: pick(v, 'studentemail') || null,
                    parent_email: pick(v, 'parentemail') || null,
                  }
                }),
                { onConflict: 'person_code' },
              )
              .select('id, person_code')
            if (error) throw error
            saved.push(...(data ?? []))
          }
          const pid = new Map(saved.map((p) => [String(p.person_code).toUpperCase(), p.id]))

          // Teams (created if new)
          const teamRows = (await supabase.from('teams').select('id, name').eq('event_id', eventId)).data ?? []
          const teamId = new Map(teamRows.map((t) => [t.name.toLowerCase(), t.id as string]))
          const wanted = [...new Set(good.map((r) => pick(r.values, 'team')).filter(Boolean))]
          for (const name of wanted.filter((n) => !teamId.has(n.toLowerCase()))) {
            const { data } = await supabase.from('teams').insert({ event_id: eventId, name }).select('id').single()
            if (data) teamId.set(name.toLowerCase(), data.id)
          }
          const withTeam = good.filter((r) => pick(r.values, 'team'))
          for (const part of chunks(withTeam)) {
            const ids = part.map((r) => pid.get(pick(r.values, 'studentid', 'id').toUpperCase())!).filter(Boolean)
            await supabase.from('team_members').delete().eq('event_id', eventId).in('person_id', ids)
            const { error } = await supabase.from('team_members').insert(
              part.map((r) => ({ team_id: teamId.get(pick(r.values, 'team').toLowerCase()), person_id: pid.get(pick(r.values, 'studentid', 'id').toUpperCase()), event_id: eventId })),
            )
            if (error) throw error
          }
          // Courses
          const enroll = good.flatMap((r) =>
            splitCodes(pick(r.values, 'courses', 'course')).map((c) => ({ course_id: courseId.get(c)!, person_id: pid.get(pick(r.values, 'studentid', 'id').toUpperCase())! })),
          )
          for (const part of chunks(enroll.filter((e) => e.course_id && e.person_id), 500)) {
            const { error } = await supabase.from('enrollments').upsert(part, { onConflict: 'course_id,person_id', ignoreDuplicates: true })
            if (error) throw error
          }
        } else {
          // Instructors, one at a time so new IDs never collide.
          for (const r of good) {
            const v = r.values
            const codes = splitCodes(pick(v, 'courses', 'course'))
            let id = pick(v, 'instructorid', 'id').toUpperCase()
            if (!id) {
              const gen = await supabase.rpc('next_person_code', { p_prefix: codes[0], p_first: pick(v, 'firstname'), p_last: pick(v, 'lastname') })
              if (gen.error) throw gen.error
              id = gen.data as string
            }
            const { data, error } = await supabase
              .from('people')
              .upsert({ person_code: id, role: 'instructor', first_name: pick(v, 'firstname'), last_name: pick(v, 'lastname'), email: pick(v, 'email') || null }, { onConflict: 'person_code' })
              .select('id')
              .single()
            if (error) throw error
            const staff = codes.map((c) => ({ course_id: courseId.get(c)!, person_id: data.id }))
            await supabase.from('course_staff').upsert(staff, { onConflict: 'course_id,person_id', ignoreDuplicates: true })
          }
        }
      }
      toast(`Imported ${good.length} ${LABEL[kind].toLowerCase()}`)
      setWarnings(warn)
      onDone()
      onClose()
    } catch (e) {
      toast('Import stopped: ' + (e instanceof Error ? e.message : 'something went wrong'), 'error')
      onDone()
    } finally {
      setBusy(false)
    }
  }

  const good = rows?.filter((r) => !r.problem) ?? []
  const bad = rows?.filter((r) => r.problem) ?? []

  return (
    <Dialog
      open
      origin={origin}
      onClose={onClose}
      title="Import CSV"
      width={720}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={run} disabled={busy || !good.length}>
            {busy ? 'Importing…' : rows ? `Import ${good.length} ${LABEL[kind]}` : 'Import'}
          </Button>
        </>
      }
    >
      <div className="acard dlgform">
        {kinds.length > 1 && (
          <Tabs fill label="What to import" value={kind} onChange={(k) => { setKind(k); setRows(null); setFileName('') }} options={kinds.map((k) => ({ value: k, label: LABEL[k] }))} />
        )}
        <p className="field__hint">
          Use a CSV file with these columns: {TEMPLATES[kind][0].join(', ')}.{' '}
          <button type="button" className="linkbtn" onClick={() => downloadFile(`${kind}-template.csv`, toCsv(TEMPLATES[kind]))}>
            Download template
          </button>
        </p>
        {kind === 'students' && <p className="field__hint">Rows with an existing Student ID update that student. Courses are added, never removed.</p>}
        {kind === 'instructors' && <p className="field__hint">Leave Instructor ID blank to create one automatically from the first course code.</p>}
        <label className="filepick">
          <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
          <span className="btn btn--outline btn--md">Choose File</span>
          <span className="field__hint">{fileName || 'No file chosen'}</span>
        </label>

        {rows && (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Pill tone="green">{good.filter((r) => r.isNew).length} new</Pill>
              <Pill tone="blue">{good.filter((r) => !r.isNew).length} updated</Pill>
              {bad.length > 0 && <Pill tone="red">{bad.length} with problems (skipped)</Pill>}
            </div>
            <TableWrap maxHeight={300} sticky>
              <table className="atable">
                <thead>
                  <tr>
                    <th>Row</th>
                    {TEMPLATES[kind][0].slice(0, 4).map((h) => <th key={h}>{h}</th>)}
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {[...bad, ...good].slice(0, 200).map((r) => (
                    <tr key={r.line}>
                      <td className="muted">{r.line}</td>
                      {Object.values(r.values).slice(0, 4).map((x, i) => <td key={i}>{x}</td>)}
                      <td className="wrap">{r.problem ? <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{r.problem}</span> : r.isNew ? 'New' : 'Update'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </>
        )}
        {warnings.map((w) => <p key={w} className="field__hint">{w}</p>)}
      </div>
    </Dialog>
  )
}
