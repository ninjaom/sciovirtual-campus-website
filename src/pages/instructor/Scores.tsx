import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { must, useLoad } from '../../lib/useLoad'
import { num, when } from '../../lib/camp'
import { loadPeople } from '../../lib/people'
import { Card, Skeleton, TableWrap } from '../../components/ui'
import { useCourse } from './CourseLayout'
import { attendancePoints, gradeKey, loadCheckins, loadGradeItems, loadGrades, loadStudents, maxTotal, type GradeItem, type Student } from './data'

interface LogRow {
  id: number
  person_id: string
  grade_item_id: string
  old_points: number | null
  new_points: number | null
  edited_by: string | null
  edited_at: string
}

type CellState = 'ok' | 'bad'
const parse = (v: string) => (v.trim() === '' ? null : Number(v.trim()))
const isBad = (v: string, max: number) => {
  const n = parse(v)
  return n !== null && (Number.isNaN(n) || n < 0 || n > max)
}

export function Scores() {
  const { course, sessions } = useCourse()
  const { profile } = useAuth()

  const { data } = useLoad(async () => {
    const [items, students, grades, checkins] = await Promise.all([loadGradeItems(course), loadStudents(course), loadGrades(course), loadCheckins(sessions)])
    return { items, students, grades, checkins }
  }, [course.id, sessions.length])

  // Cell text as typed, and the value last saved for each cell.
  const [text, setText] = useState<Map<string, string>>(new Map())
  const saved = useRef<Map<string, number>>(new Map())
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [pending, setPending] = useState(0)
  const [lastBad, setLastBad] = useState(false)
  const [failed, setFailed] = useState(false)
  const focused = useRef<string | null>(null)

  useEffect(() => {
    if (!data) return
    saved.current = new Map(data.grades)
    setText(new Map([...data.grades].map(([k, v]) => [k, num(v)])))
  }, [data])

  const items = data?.items ?? []
  const manual = items.filter((i) => i.kind === 'manual')
  const att = items.find((i) => i.kind === 'attendance') ?? null
  const students = data?.students ?? []

  // ---------- Edit log ----------
  const log = useLoad(async () => {
    const [rows, count] = await Promise.all([
      supabase.from('grade_edits').select('id, person_id, grade_item_id, old_points, new_points, edited_by, edited_at').eq('course_id', course.id).order('edited_at', { ascending: false }).limit(100),
      supabase.from('grade_edits').select('id', { count: 'exact', head: true }).eq('course_id', course.id),
    ])
    const r = must(rows) as LogRow[]
    return { rows: r, count: count.count ?? r.length, editors: await loadPeople(r.map((x) => x.edited_by)) }
  }, [course.id])
  const logTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshLog = useCallback(() => {
    if (logTimer.current) clearTimeout(logTimer.current)
    logTimer.current = setTimeout(() => log.reload(), 800)
  }, [log])

  // ---------- Saving ----------
  const save = useCallback(
    async (student: Student, item: GradeItem, value: string) => {
      const key = gradeKey(student.id, item.id)
      const n = parse(value)
      if (n === saved.current.get(key) || (n === null && !saved.current.has(key))) return
      setPending((p) => p + 1)
      const res =
        n === null
          ? await supabase.from('grades').delete().eq('course_id', course.id).eq('person_id', student.id).eq('grade_item_id', item.id)
          : await supabase.from('grades').upsert({ course_id: course.id, person_id: student.id, grade_item_id: item.id, points: n })
      setPending((p) => p - 1)
      if (res.error) {
        setFailed(true)
        return
      }
      setFailed(false)
      if (n === null) saved.current.delete(key)
      else saved.current.set(key, n)
      refreshLog()
    },
    [course.id, refreshLog],
  )

  function change(student: Student, item: GradeItem, value: string) {
    const key = gradeKey(student.id, item.id)
    setText((t) => new Map(t).set(key, value))
    const bad = isBad(value, Number(item.max_points))
    setLastBad(bad)
    const old = timers.current.get(key)
    if (old) clearTimeout(old)
    if (bad) return
    timers.current.set(
      key,
      setTimeout(() => {
        timers.current.delete(key)
        void save(student, item, value)
      }, 450),
    )
  }

  // Save anything still waiting when leaving the page.
  useEffect(
    () => () => {
      for (const t of timers.current.values()) clearTimeout(t)
    },
    [],
  )

  // Pick up a co-instructor's changes every 30 seconds (cells being edited are left alone).
  useEffect(() => {
    if (!data) return
    const id = setInterval(async () => {
      if (pending > 0 || timers.current.size > 0) return
      const fresh = await loadGrades(course)
      saved.current = new Map(fresh)
      setText((t) => {
        const next = new Map(t)
        for (const k of new Set([...t.keys(), ...fresh.keys()])) {
          if (k === focused.current || isBadKey(k)) continue
          const v = fresh.get(k)
          next.set(k, v == null ? '' : num(v))
        }
        return next
      })
      log.reload()
    }, 30000)
    return () => clearInterval(id)
    function isBadKey(k: string) {
      const item = manual.find((i) => k.endsWith(':' + i.id))
      return !!item && isBad(text.get(k) ?? '', Number(item.max_points))
    }
  })

  // ---------- Keyboard and paste ----------
  const grid = useRef<HTMLTableSectionElement>(null)
  const focusCell = (r: number, c: number) => {
    const el = grid.current?.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c}"]`)
    if (el) {
      el.focus()
      el.select()
    }
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>, r: number, c: number) {
    const move: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (e.key === 'Enter') {
      e.preventDefault()
      focusCell(r + (e.shiftKey ? -1 : 1), c)
    } else if (move[e.key]) {
      const el = e.currentTarget
      const whole = el.selectionStart === 0 && el.selectionEnd === el.value.length
      // Left/right move between cells unless the caret is inside the number.
      if (e.key === 'ArrowLeft' && !whole && el.selectionStart !== 0) return
      if (e.key === 'ArrowRight' && !whole && el.selectionEnd !== el.value.length) return
      e.preventDefault()
      focusCell(r + move[e.key][0], c + move[e.key][1])
    }
  }
  function onPaste(e: ClipboardEvent<HTMLInputElement>, r: number, c: number) {
    const raw = e.clipboardData.getData('text/plain')
    if (!/[\t\n]/.test(raw.trim())) return // a single value pastes normally
    e.preventDefault()
    const lines = raw.replace(/\r/g, '').replace(/\n$/, '').split('\n')
    lines.forEach((line, i) => {
      const s = students[r + i]
      if (!s) return
      line.split('\t').forEach((cell, j) => {
        const item = manual[c + j]
        if (item) change(s, item, cell.trim())
      })
    })
  }

  // ---------- Totals and ranking ----------
  const rows = useMemo(
    () =>
      students.map((s) => {
        const attended = data?.checkins.get(s.id)?.size ?? 0
        const attPts = att ? attendancePoints(att, attended) : 0
        let total = attPts
        const shown = new Map<string, string>()
        for (const it of manual) {
          const v = text.get(gradeKey(s.id, it.id)) ?? ''
          const n = parse(v)
          const ok = n !== null && !isBad(v, Number(it.max_points))
          if (ok) total += n
          shown.set(it.id, ok ? num(n) : '—')
        }
        return { s, attPts, total, shown }
      }),
    [students, text, manual, att, data],
  )
  const ranked = useMemo(() => {
    const sorted = [...rows].sort((a, b) => b.total - a.total || a.s.last_name.localeCompare(b.s.last_name))
    return sorted.map((r) => ({ ...r, rank: sorted.findIndex((x) => x.total === r.total) + 1 }))
  }, [rows])

  const status = lastBad
    ? { text: 'Not saved: above the maximum', cls: 'is-bad' }
    : failed
      ? { text: 'Couldn’t save. Try again.', cls: 'is-bad' }
      : pending > 0 || timers.current.size > 0
        ? { text: 'Saving…', cls: 'is-saving' }
        : { text: 'All Changes Saved', cls: '' }

  const nameOf = new Map(students.map((s) => [s.id, `${s.first_name} ${s.last_name}`]))
  const itemName = new Map(items.map((i) => [i.id, i.name]))
  const total = maxTotal(items)

  return (
    <>
      <Card>
        <div className="secthead">
          <h2>Score Entry</h2>
          <span className={'gridstatus ' + status.cls} role="status">
            <span className="gridstatus__dot" />
            {status.text}
          </span>
        </div>
        <div className="gridnote">
          <span>Note: Use arrow keys, Tab and Enter to move between cells; paste a block directly from Sheets.</span>
          <div className="attlegend">
            <span><span className="keybox keybox--bad" />Above the maximum, not saved</span>
            <span><span className="keybox keybox--calc" />Calculated from check-ins</span>
          </div>
        </div>
        {!data ? (
          <Skeleton height={320} />
        ) : (
          <TableWrap>
            <table className="itable sgrid" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th style={{ width: 100 }}>Student ID</th>
                  <th>First Name</th>
                  <th>Last Name</th>
                  <th className="c">Grade Level</th>
                  {items.map((it) => (
                    <th key={it.id} className={'c' + (it.kind === 'attendance' ? ' sgrid__calcth' : '')}>
                      {it.name}
                      <br />
                      <span className="sgrid__max">/ {num(it.max_points)}</span>
                    </th>
                  ))}
                  <th className="c">
                    Total
                    <br />
                    <span className="sgrid__max">/ {total}</span>
                  </th>
                </tr>
              </thead>
              <tbody ref={grid}>
                {rows.map(({ s, attPts, total }, r) => (
                  <tr key={s.id}>
                    <td className="muted">{s.person_code}</td>
                    <td className="strong">{s.first_name}</td>
                    <td className="strong">{s.last_name}</td>
                    <td className="c muted">{s.grade ?? ''}</td>
                    {items.map((it) => {
                      if (it.kind === 'attendance')
                        return (
                          <td key={it.id} className="c sgrid__calc tnum">
                            {attPts}
                          </td>
                        )
                      const c = manual.indexOf(it)
                      const key = gradeKey(s.id, it.id)
                      const v = text.get(key) ?? ''
                      const state: CellState = isBad(v, Number(it.max_points)) ? 'bad' : 'ok'
                      return (
                        <td key={it.id} className="sgrid__cellwrap">
                          <input
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            className={'sgrid__cell' + (state === 'bad' ? ' is-bad' : '')}
                            aria-label={`${it.name} score for ${s.first_name} ${s.last_name}`}
                            aria-invalid={state === 'bad' || undefined}
                            data-r={r}
                            data-c={c}
                            value={v}
                            onChange={(e) => change(s, it, e.target.value)}
                            onFocus={(e) => {
                              focused.current = key
                              e.currentTarget.select()
                            }}
                            onBlur={() => (focused.current = null)}
                            onKeyDown={(e) => onKey(e, r, c)}
                            onPaste={(e) => onPaste(e, r, c)}
                          />
                        </td>
                      )
                    })}
                    <td className="c strong tnum">{total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {data && students.length === 0 && <div className="nomatch">No students in this course yet</div>}
      </Card>

      <div className="irow">
        <Card className="lbcard">
          <div className="secthead" style={{ alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h2>Class Leaderboard</h2>
              <span className="secthead__count">Rankings update automatically. Sorted by Total Points, highest to lowest.</span>
            </div>
            <span className="livepill">
              <span className="livepill__dot" />
              Live leaderboard — auto-updates as scores are entered
            </span>
          </div>
          {!data ? (
            <Skeleton height={240} />
          ) : (
            <TableWrap>
              <table className="lbtable" style={{ minWidth: 700 }}>
                <thead>
                  <tr>
                    <th className="c" style={{ width: 64 }}>Rank</th>
                    <th>Student ID</th>
                    <th>First Name</th>
                    <th>Last Name</th>
                    {items.map((it) => (
                      <th key={it.id} className="c">{it.name}</th>
                    ))}
                    <th className="c">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map(({ s, attPts, total, shown, rank }, i) => (
                    <tr key={s.id} className={i === 0 ? 'is-top' : undefined}>
                      <td className="c lbtable__rank">{rank}</td>
                      <td className="muted tnum">{s.person_code}</td>
                      <td className="strong">{s.first_name}</td>
                      <td className="strong">{s.last_name}</td>
                      {items.map((it) => (
                        <td key={it.id} className="c tnum">
                          {it.kind === 'attendance' ? attPts : shown.get(it.id)}
                        </td>
                      ))}
                      <td className="c tnum" style={{ fontWeight: 700, color: 'var(--text)' }}>{total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        <Card className="logcard">
          <div className="secthead" style={{ flexWrap: 'nowrap' }}>
            <h2>Edit Log</h2>
            <span className="secthead__count" style={{ fontSize: 12 }}>
              {log.data ? `${log.data.count} ${log.data.count === 1 ? 'change' : 'changes'}` : ''}
            </span>
          </div>
          <div className="loglist">
            {log.data?.rows.map((e) => (
              <div key={e.id} className="logrow">
                <div className="logrow__top">
                  <span className="logrow__who">{(e.edited_by && log.data!.editors.get(e.edited_by)?.name) || (e.edited_by === profile?.id ? `${profile.firstName} ${profile.lastName}` : 'Campus')}</span>
                  <span className="logrow__when">{when(e.edited_at)}</span>
                </div>
                <span className="logrow__what">
                  {nameOf.get(e.person_id) ?? 'Student'} · {itemName.get(e.grade_item_id) ?? 'Score'}: <s>{e.old_points == null ? '—' : num(e.old_points)}</s> →{' '}
                  <strong>{e.new_points == null ? '—' : num(e.new_points)}</strong>
                </span>
              </div>
            ))}
            {log.data && log.data.rows.length === 0 && <p className="inote" style={{ fontSize: 13, padding: '10px 0' }}>No changes yet</p>}
          </div>
        </Card>
      </div>
    </>
  )
}
