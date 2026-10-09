import { useState } from 'react'
import { useLoad } from '../../lib/useLoad'
import { Card, SearchInput, Skeleton, TableWrap } from '../../components/ui'
import { useCourse } from './CourseLayout'
import { loadStudents } from './data'

export function Roster() {
  const { course } = useCourse()
  const [q, setQ] = useState('')
  const { data } = useLoad(() => loadStudents(course), [course.id])

  const needle = q.trim().toLowerCase()
  const rows = (data ?? []).filter(
    (r) =>
      !needle ||
      [r.person_code, r.first_name, r.last_name, r.school, r.student_email, r.parent_email].join(' ').toLowerCase().includes(needle),
  )

  return (
    <Card>
      <div className="secthead">
        <div className="secthead__title">
          <h2>Student Roster</h2>
          <span className="secthead__count">{data ? `${data.length} ${data.length === 1 ? 'student' : 'students'}` : ''}</span>
        </div>
        <SearchInput aria-label="Search students" placeholder="Search students" value={q} onChange={(e) => setQ(e.target.value)} className="input input--search isearch" />
      </div>
      {!data ? (
        <Skeleton height={300} />
      ) : (
        <TableWrap>
          <table className="itable" style={{ minWidth: 1180 }}>
            <thead>
              <tr>
                <th style={{ width: 100 }}>Student ID</th>
                <th>First Name</th>
                <th>Last Name</th>
                <th className="c">Grade Level</th>
                <th>School</th>
                <th>City</th>
                <th className="c">State</th>
                <th>Student Email</th>
                <th>Parent Email</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="muted">{r.person_code}</td>
                  <td className="strong">{r.first_name}</td>
                  <td className="strong">{r.last_name}</td>
                  <td className="c muted">{r.grade ?? ''}</td>
                  <td>{r.school}</td>
                  <td>{r.city}</td>
                  <td className="c">{r.state}</td>
                  <td>{r.student_email && <a href={`mailto:${r.student_email}`}>{r.student_email}</a>}</td>
                  <td>{r.parent_email && <a href={`mailto:${r.parent_email}`}>{r.parent_email}</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {data && rows.length === 0 && <div className="nomatch">{data.length ? 'No students match your search' : 'No students in this course yet'}</div>}
      <span className="inote">Note: Roster changes will be updated on the backend and show up automatically</span>
    </Card>
  )
}
