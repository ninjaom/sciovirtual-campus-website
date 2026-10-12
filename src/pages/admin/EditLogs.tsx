import { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { must, useLoad } from '../../lib/useLoad'
import { useCurrentEvent } from '../../lib/useEvent'
import { when } from '../../lib/camp'
import { downloadFile, toCsv } from '../../lib/csv'
import { Button, Card, Pill, SearchInput, Skeleton, TableWrap, type PillTone } from '../../components/ui'
import { AdminHead, LoadError, Note } from './AdminBits'
import './phase6.css'

type Kind = 'scores' | 'points' | 'attendance' | 'accounts' | 'leaderboard'
const KINDS: Record<Kind, { label: string; tone: PillTone }> = {
  scores: { label: 'Scores', tone: 'blue' },
  points: { label: 'Points', tone: 'amber' },
  attendance: { label: 'Attendance', tone: 'green' },
  accounts: { label: 'Accounts', tone: 'grey' },
  leaderboard: { label: 'Leaderboard', tone: 'red' },
}
const LIMIT = 500

interface Row {
  key: string
  at: string
  who: string
  kind: Kind
  where: string
  what: string
  old: string | null
  next: string | null
}

const fmt = (v: string | number | null | undefined) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && String(v).trim() !== '' ? n.toLocaleString('en-US') : String(v)
}

/** Admin › Edit Logs (AdminLogs mockup board): every change, newest first. */
export function EditLogs() {
  const ev = useCurrentEvent()
  const eventId = ev.data?.event?.id ?? null
  const [kind, setKind] = useState<Kind | 'all'>('all')
  const [courseId, setCourseId] = useState('all')
  const [personId, setPersonId] = useState('all')
  const [q, setQ] = useState('')

  // Lists for the filters
  const lists = useLoad(async () => {
    if (!eventId) return null
    const [courses, staff] = await Promise.all([
      supabase.from('courses').select('id, name').eq('event_id', eventId).order('sort').order('name'),
      supabase.from('people').select('id, first_name, last_name, role').in('role', ['admin', 'instructor']).order('role').order('first_name').order('last_name'),
    ])
    return {
      courses: must(courses) as { id: string; name: string }[],
      staff: must(staff) as { id: string; first_name: string; last_name: string; role: string }[],
    }
  }, [eventId])

  const { data, error } = useLoad(async () => {
    if (!eventId || !lists.data) return null
    const wantScores = kind === 'all' || kind === 'scores'
    const wantLog = kind !== 'scores'
    let scores = supabase
      .from('grade_edits')
      .select('id, course_id, person_id, grade_item_id, old_points, new_points, edited_by, edited_at')
      .order('edited_at', { ascending: false })
      .limit(LIMIT)
    scores = courseId !== 'all' ? scores.eq('course_id', courseId) : scores.in('course_id', lists.data.courses.map((c) => c.id))
    if (personId !== 'all') scores = scores.eq('edited_by', personId)
    let log = supabase
      .from('activity_log')
      .select('id, at, actor_id, kind, course_id, target, field, old_value, new_value')
      .eq('event_id', eventId)
      .not('kind', 'is', null)
      .order('at', { ascending: false })
      .limit(LIMIT)
    if (kind !== 'all' && kind !== 'scores') log = log.eq('kind', kind)
    if (courseId !== 'all') log = log.eq('course_id', courseId)
    if (personId !== 'all') log = log.eq('actor_id', personId)

    const [sc, lg, items] = await Promise.all([
      wantScores ? scores : Promise.resolve({ data: [], error: null }),
      wantLog ? log : Promise.resolve({ data: [], error: null }),
      supabase.from('grade_items').select('id, name').eq('event_id', eventId),
    ])
    const scoreRows = must(sc) as { id: number; course_id: string; person_id: string; grade_item_id: string; old_points: number | null; new_points: number | null; edited_by: string | null; edited_at: string }[]
    const logRows = must(lg) as { id: number; at: string; actor_id: string | null; kind: Kind; course_id: string | null; target: string | null; field: string | null; old_value: string | null; new_value: string | null }[]

    // Names: staff from the filter list; students for score rows
    const names = new Map(lists.data.staff.map((p) => [p.id, `${p.first_name} ${p.last_name}`]))
    const studentIds = [...new Set(scoreRows.map((r) => r.person_id))].filter((id) => !names.has(id))
    for (let i = 0; i < studentIds.length; i += 150) {
      const page = must(await supabase.from('people').select('id, first_name, last_name').in('id', studentIds.slice(i, i + 150))) as { id: string; first_name: string; last_name: string }[]
      for (const p of page) names.set(p.id, `${p.first_name} ${p.last_name}`)
    }
    const courseName = new Map(lists.data.courses.map((c) => [c.id, c.name]))
    const itemName = new Map((must(items) as { id: string; name: string }[]).map((i) => [i.id, i.name]))
    const unknown = '—'

    const rows: Row[] = [
      ...scoreRows.map((r) => ({
        key: 's' + r.id,
        at: r.edited_at,
        who: r.edited_by ? names.get(r.edited_by) ?? unknown : unknown,
        kind: 'scores' as const,
        where: `${courseName.get(r.course_id) ?? unknown} · ${names.get(r.person_id) ?? unknown}`,
        what: itemName.get(r.grade_item_id) ?? unknown,
        old: fmt(r.old_points),
        next: fmt(r.new_points),
      })),
      ...logRows.map((r) => ({
        key: 'a' + r.id,
        at: r.at,
        who: r.actor_id ? names.get(r.actor_id) ?? unknown : unknown,
        kind: r.kind,
        where: r.target ?? unknown,
        what: r.field ?? unknown,
        old: fmt(r.old_value),
        next: fmt(r.new_value),
      })),
    ].sort((a, b) => b.at.localeCompare(a.at))
    return rows.slice(0, LIMIT)
  }, [eventId, lists.data, kind, courseId, personId])

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return data ?? []
    return (data ?? []).filter((r) => r.where.toLowerCase().includes(term) || r.what.toLowerCase().includes(term))
  }, [data, q])

  function exportCsv() {
    const header = ['When', 'Who', 'Type', 'Where', 'What', 'Old', 'New']
    const body = shown.map((r) => [when(r.at), r.who, KINDS[r.kind].label, r.where, r.what, r.old ?? '', r.next ?? ''])
    downloadFile(`edit-logs-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([header, ...body]))
  }

  return (
    <>
      <AdminHead title="Edit Logs">
        <Button variant="secondary" onClick={exportCsv} disabled={!shown.length}>Export CSV</Button>
      </AdminHead>
      {(error || lists.error) && <LoadError message={(error || lists.error) as string} />}

      <Card>
        <div className="p6filters">
          <select className="p6select p6select--soft" aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value as Kind | 'all')}>
            <option value="all">All types</option>
            {(Object.keys(KINDS) as Kind[]).map((k) => <option key={k} value={k}>{KINDS[k].label}</option>)}
          </select>
          <select className="p6select p6select--soft" aria-label="Course" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            <option value="all">All courses</option>
            {lists.data?.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="p6select p6select--soft" aria-label="Person" value={personId} onChange={(e) => setPersonId(e.target.value)}>
            <option value="all">Everyone</option>
            {lists.data?.staff.map((p) => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
          </select>
          <SearchInput aria-label="Search logs" placeholder="Search by student" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {!data ? (
          <Skeleton height={300} />
        ) : (
          <TableWrap sticky maxHeight={720}>
            <table className="atable p6log">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Type</th>
                  <th>Where</th>
                  <th>What</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.key}>
                    <td className="p6nowrap p6muted">{when(r.at)}</td>
                    <td className="p6nowrap p6who">{r.who}</td>
                    <td><Pill tone={KINDS[r.kind].tone}>{KINDS[r.kind].label}</Pill></td>
                    <td>{r.where}</td>
                    <td>{r.what}</td>
                    <td className="p6nowrap">
                      {r.old != null ? <s className="p6old">{r.old}</s> : <span className="p6old">—</span>} → <strong>{r.next ?? '—'}</strong>
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p6empty">No changes match these filters</td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableWrap>
        )}
        {data && data.length >= LIMIT && <Note>Showing the latest {LIMIT} changes; use the filters to narrow it down</Note>}
      </Card>
    </>
  )
}
