import { useLoad } from '../../lib/useLoad'
import { sessionState, shortDate } from '../../lib/camp'
import { Card, Skeleton, TableWrap } from '../../components/ui'
import { useCourse } from './CourseLayout'
import { attendancePoints, loadCheckins, loadGradeItems, loadStudents } from './data'

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5L19 7" />
    </svg>
  )
}

export function Attendance() {
  const { course, sessions } = useCourse()
  const { data } = useLoad(async () => {
    const [items, students, checkins] = await Promise.all([loadGradeItems(course), loadStudents(course), loadCheckins(sessions)])
    return { att: items.find((i) => i.kind === 'attendance') ?? null, students, checkins }
  }, [course.id, sessions.length])

  const states = sessions.map((s) => sessionState(s.date))
  const doneCount = states.filter((s) => s !== 'upcoming').length

  return (
    <>
      <Card>
        <div className="secthead" style={{ alignItems: 'baseline' }}>
          <h2>Session codes</h2>
          <span className="secthead__count">Make sure to share this at the end of class each day!</span>
        </div>
        <div className="scodes">
          {sessions.map((s, i) => (
            <div key={s.id} className={'scode scode--' + states[i]}>
              <span className="scode__label">
                S{s.number}
                {s.date ? ` · ${shortDate(s.date)}` : ''}
              </span>
              <span className="scode__code">{s.code ?? '—'}</span>
              {states[i] === 'today' && <span className="scode__today">Today</span>}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="secthead">
          <h2>Attendance tracker</h2>
          <div className="attlegend">
            <span><span className="attcell attcell--yes attcell--sm"><Check /></span>Checked in</span>
            <span><span className="attcell attcell--no attcell--sm" />Missed</span>
            <span><span className="attcell attcell--future attcell--sm" />Upcoming</span>
          </div>
        </div>
        {!data ? (
          <Skeleton height={300} />
        ) : (
          <TableWrap>
            <table className="itable atttable" style={{ minWidth: 980 }}>
              <thead>
                <tr>
                  <th style={{ width: 100 }}>Student ID</th>
                  <th>First Name</th>
                  <th>Last Name</th>
                  {sessions.map((s, i) => (
                    <th key={s.id} className={'c attth attth--' + states[i]}>
                      S{s.number}
                      {s.date && (
                        <>
                          <br />
                          <span className="attth__date">{shortDate(s.date)}</span>
                        </>
                      )}
                    </th>
                  ))}
                  <th className="c attth--sum">Attended</th>
                  <th className="c attth--sum">Att Pts</th>
                </tr>
              </thead>
              <tbody>
                {data.students.map((p) => {
                  const mine = data.checkins.get(p.id)
                  const attended = mine?.size ?? 0
                  return (
                    <tr key={p.id}>
                      <td className="muted">{p.person_code}</td>
                      <td className="strong">{p.first_name}</td>
                      <td className="strong">{p.last_name}</td>
                      {sessions.map((s, i) => {
                        const yes = !!mine?.has(s.id)
                        const kind = yes ? 'yes' : states[i] === 'past' ? 'no' : 'future'
                        return (
                          <td key={s.id} className="c attcol">
                            <span className={'attcell attcell--' + kind} aria-label={yes ? 'Checked in' : kind === 'no' ? 'Missed' : 'Upcoming'} role="img">
                              {yes && <Check />}
                            </span>
                          </td>
                        )
                      })}
                      <td className="c strong tnum">
                        {attended} / {doneCount}
                      </td>
                      <td className="c tnum" style={{ fontWeight: 700, color: 'var(--text)' }}>
                        {data.att ? attendancePoints(data.att, attended) : attended}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        <span className="inote">Note: Missed attendance logs are fixed by directors</span>
      </Card>
    </>
  )
}
