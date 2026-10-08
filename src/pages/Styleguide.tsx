import { useState } from 'react'
import { Banner, Button, Card, EmptyState, Pill, SavedStatus, SearchInput, SelectField, Skeleton, Switch, TableWrap, Tabs, TextField } from '../components/ui'
import { Dialog } from '../components/Dialog'
import { useToast } from '../components/Toast'

/**
 * Test-site-only page showing every shared component, to compare against the
 * mockups. Not reachable on campus.sciovirtual.org. Text here is sample text.
 */
export function Styleguide() {
  const [tab, setTab] = useState<'a' | 'b' | 'c'>('a')
  const [on, setOn] = useState(true)
  const [dlg, setDlg] = useState(false)
  const [del, setDel] = useState(false)
  const [origin, setOrigin] = useState<HTMLElement | null>(null)
  const toast = useToast()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <Banner eyebrow="Styleguide (test site only)" title="Components" />
      <main className="page">
        <Card title="Buttons">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline" size="sm">Small outline</Button>
            <Button variant="accent">Teal accent</Button>
            <Button variant="danger">Delete</Button>
            <Button disabled>Disabled</Button>
            <Button size="lg">Large</Button>
          </div>
        </Card>

        <Card title="Fields">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            <TextField label="ID" defaultValue="27AA0001" />
            <TextField label="Username" defaultValue="username_01" error="That username is already taken" />
            <TextField label="Recovery/Backup Email" type="email" hint="Note: this email is only used for password resets, nothing else" />
            <SelectField label="Team">
              <option>Team A</option>
              <option>Team B</option>
            </SelectField>
          </div>
          <SearchInput placeholder="Search students" aria-label="Search" />
        </Card>

        <Card title="Tabs, switch, pills, saved status">
          <Tabs label="Example" value={tab} onChange={setTab} options={[{ value: 'a', label: 'Individual' }, { value: 'b', label: 'Teams' }, { value: 'c', label: 'Courses' }]} />
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <Switch checked={on} onChange={setOn} label="Shown" />
            <Pill tone="green">Signed up</Pill>
            <Pill tone="amber">Setup code: K7Q2-9MXD</Pill>
            <Pill tone="grey">Not started</Pill>
            <Pill>Pinned</Pill>
            <Pill tone="solid">You</Pill>
            <SavedStatus />
          </div>
        </Card>

        <Card title="Pop-ups and feedback">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button onClick={(e) => { setOrigin(e.currentTarget); setDlg(true) }}>Add Event</Button>
            <Button variant="danger" onClick={(e) => { setOrigin(e.currentTarget); setDel(true) }}>Delete</Button>
            <Button variant="secondary" onClick={() => toast('All changes saved')}>Success toast</Button>
            <Button variant="outline" onClick={() => toast('Something went wrong', 'error')}>Error toast</Button>
          </div>
        </Card>

        <Card title="Table (pinned header and first column)">
          <TableWrap sticky maxHeight={260}>
            <table style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th className="col-pin" style={{ left: 0 }}>Player</th>
                  {Array.from({ length: 8 }, (_, i) => <th key={i}>Event {i + 1}</th>)}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 12 }, (_, r) => (
                  <tr key={r}>
                    <td className="col-pin" style={{ left: 0, fontWeight: 600 }}>username_{String(r + 1).padStart(2, '0')}</td>
                    {Array.from({ length: 8 }, (_, i) => <td key={i}>{(r * 37 + i * 11) % 500}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
          <EmptyState title="No announcements yet" body="Your instructors will post here" />
          <Card title="Loading">
            {[180, 150, 200, 160].map((w, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <Skeleton width={28} height={28} round />
                <Skeleton width={w} />
              </div>
            ))}
          </Card>
        </div>
      </main>

      <Dialog
        open={dlg}
        origin={origin}
        onClose={() => setDlg(false)}
        title="Add Event"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDlg(false)}>Cancel</Button>
            <Button onClick={() => { setDlg(false); toast('Added') }}>+ Add Event</Button>
          </>
        }
      >
        <TextField label="Event" defaultValue="Event 7" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <TextField label="Individual max" defaultValue="500" />
          <TextField label="Team Max" defaultValue="2,000" />
        </div>
      </Dialog>
      <Dialog
        open={del}
        origin={origin}
        onClose={() => setDel(false)}
        title="Delete Event 3?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDel(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => setDel(false)}>Delete</Button>
          </>
        }
      >
        <p style={{ color: 'var(--text-muted)' }}>This can't be undone.</p>
      </Dialog>
    </div>
  )
}
