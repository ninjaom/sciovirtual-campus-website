import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { must, useLoad } from '../../lib/useLoad'
import { useCurrentEvent } from '../../lib/useEvent'
import { when } from '../../lib/camp'
import { loadPeople } from '../../lib/people'
import { safeName } from '../../lib/files'
import { Button, Card, Skeleton, TextAreaField, TextField } from '../../components/ui'
import { Dialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import { AddLink, AttachmentList, XGlyph } from '../instructor/Announcements'
import { campFileLinks, type Update } from '../instructor/InstructorHome'
import { Ava, FileIcon, LinkIcon, type Attachment } from '../instructor/bits'
import { AdminHead, LoadError, Note } from './AdminBits'
import '../instructor/instructor.css'
import './phase6.css'

const BUCKET = 'camp-files'
const MAX_FILE = 10 * 1024 * 1024

/** Admin › Camp Announcements (AdminUpdates mockup board). */
export function CampAnnouncements() {
  const { profile } = useAuth()
  const toast = useToast()
  const ev = useCurrentEvent()
  const eventId = ev.data?.event?.id ?? null

  const { data, error, reload, setData } = useLoad(async () => {
    if (!eventId) return null
    const rows = must(
      await supabase
        .from('camp_updates')
        .select('id, author_id, title, body, attachments, pinned, created_at')
        .eq('event_id', eventId)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false }),
    ) as Update[]
    return { posts: rows, people: await loadPeople(rows.map((r) => r.author_id)), urls: await campFileLinks(rows) }
  }, [eventId])

  // ---------- New update ----------
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [pin, setPin] = useState(false)
  const [links, setLinks] = useState<{ url: string; label: string }[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [posting, setPosting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [origin, setOrigin] = useState<HTMLElement | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  function pickFiles(list: FileList | null) {
    const picked = [...(list ?? [])]
    if (picked.some((f) => f.size > MAX_FILE)) toast('Files can be up to 10 MB', 'error')
    setFiles((f) => [...f, ...picked.filter((x) => x.size <= MAX_FILE)])
    if (fileInput.current) fileInput.current.value = ''
  }

  async function post() {
    if (!eventId || !profile) return
    if (!title.trim()) return setErr('Enter a title')
    setErr(null)
    setPosting(true)
    const attachments: Attachment[] = links.map((l) => ({ type: 'link', url: l.url, label: l.label || undefined }))
    for (const f of files) {
      const path = `${eventId}/${crypto.randomUUID()}/${safeName(f.name)}`
      const up = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined })
      if (up.error) {
        setPosting(false)
        return toast(up.error.message.includes('mime') ? 'That file type can’t be attached' : 'Couldn’t upload ' + f.name, 'error')
      }
      attachments.push({ type: 'file', path, name: f.name, size: f.size })
    }
    const res = await supabase
      .from('camp_updates')
      .insert({ event_id: eventId, author_id: profile.id, title: title.trim(), body: body.trim(), attachments, pinned: pin })
    setPosting(false)
    if (res.error) return toast('Something went wrong. Please try again.', 'error')
    setTitle('')
    setBody('')
    setPin(false)
    setLinks([])
    setFiles([])
    toast('Posted')
    reload()
  }

  // ---------- Pin, edit, delete ----------
  const [editing, setEditing] = useState<Update | null>(null)
  const [deleting, setDeleting] = useState<Update | null>(null)

  async function togglePin(u: Update) {
    const res = await supabase.from('camp_updates').update({ pinned: !u.pinned }).eq('id', u.id)
    if (res.error) return toast('Something went wrong. Please try again.', 'error')
    toast(u.pinned ? 'Unpinned' : 'Pinned')
    reload()
  }
  async function confirmDelete() {
    if (!deleting) return
    const paths = deleting.attachments.filter((a) => a.type === 'file').map((a) => (a as { path: string }).path)
    const res = await supabase.from('camp_updates').delete().eq('id', deleting.id)
    if (res.error) return toast('Something went wrong. Please try again.', 'error')
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths)
    setDeleting(null)
    toast('Deleted')
    reload()
  }

  return (
    <>
      <AdminHead title="Camp Announcements" />
      {error && <LoadError message={error} />}

      <Card title="New Camp Update">
        <div className="dlgform p6form">
          <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Update title" error={err ?? undefined} />
          <TextAreaField label="Message" rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Camp update text" />
        </div>
        {(links.length > 0 || files.length > 0) && (
          <div className="composer__chips">
            {links.map((l, i) => (
              <span key={'l' + i} className="filechip">
                <LinkIcon />
                {l.label || l.url}
                <button type="button" className="chipx" aria-label="Remove link" onClick={() => setLinks((x) => x.filter((_, j) => j !== i))}>
                  <XGlyph />
                </button>
              </span>
            ))}
            {files.map((f, i) => (
              <span key={'f' + i} className="filechip">
                <FileIcon />
                {f.name}
                <button type="button" className="chipx" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>
                  <XGlyph />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="p6bar">
          <div className="p6bar__tools">
            <Button variant="secondary" size="sm" className="p6tool" onClick={() => fileInput.current?.click()}>
              Attach File
            </Button>
            <Button variant="secondary" size="sm" className="p6tool" onClick={(e) => { setOrigin(e.currentTarget); setLinkOpen(true) }}>
              Add Link
            </Button>
            <input ref={fileInput} type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.ppt,.pptx,.doc,.docx" onChange={(e) => pickFiles(e.target.files)} />
            <label className="p6check">
              <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} />
              <span>Pin To Top?</span>
            </label>
          </div>
          <Button onClick={post} disabled={posting} className="p6post">
            {posting ? 'Posting…' : 'Post'}
          </Button>
        </div>
        <Note>REMEMBER: Announcements show on every student's and instructor's Home page</Note>
      </Card>

      {!data && !error && <Skeleton height={160} />}
      {data?.posts.map((u) => {
        const author = u.author_id ? data.people.get(u.author_id) : null
        return (
          <article key={u.id} className={'update p6update' + (u.pinned ? ' is-pinned' : '')}>
            <div className="update__head">
              <div className="update__who">
                <Ava person={author} fallback="DR" />
                <div className="update__meta">
                  <span className="p6update__name">
                    <span className="update__name">{author?.name ?? 'Director'}</span>
                    {u.pinned && <span className="pinned">Pinned</span>}
                  </span>
                  <span className="update__when">{when(u.created_at)}</span>
                </div>
              </div>
              <div className="p6actions">
                <Button variant="outline" size="sm" onClick={() => togglePin(u)}>{u.pinned ? 'Unpin' : 'Pin'}</Button>
                <Button variant="outline" size="sm" onClick={(e) => { setOrigin(e.currentTarget); setEditing(u) }}>Edit</Button>
                <Button variant="outline" size="sm" className="btn--danger-outline" onClick={(e) => { setOrigin(e.currentTarget); setDeleting(u) }}>Delete</Button>
              </div>
            </div>
            <h3>{u.title}</h3>
            {u.body && <p className="update__body">{u.body}</p>}
            {u.attachments.length > 0 && (
              <div className="composer__chips">
                <AttachmentList items={u.attachments} urls={data.urls} />
              </div>
            )}
          </article>
        )
      })}
      {data && data.posts.length === 0 && (
        <Card>
          <p className="inote" style={{ fontSize: 14 }}>No Camp Updates yet</p>
        </Card>
      )}

      {linkOpen && <AddLink origin={origin} onClose={() => setLinkOpen(false)} onAdd={(l) => { setLinks((x) => [...x, l]); setLinkOpen(false) }} />}
      {editing && (
        <EditUpdate
          update={editing}
          origin={origin}
          onClose={() => setEditing(null)}
          onSaved={(t, b) => {
            setData((d) => (d ? { ...d, posts: d.posts.map((p) => (p.id === editing.id ? { ...p, title: t, body: b } : p)) } : d))
            setEditing(null)
            toast('All Changes Saved')
          }}
        />
      )}
      {deleting && (
        <Dialog
          open
          origin={origin}
          onClose={() => setDeleting(null)}
          title="Delete this Camp Update?"
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="danger" onClick={confirmDelete}>Delete</Button>
            </>
          }
        >
          <p style={{ fontSize: 15, color: 'var(--text-muted)' }}>This can't be undone.</p>
        </Dialog>
      )}
    </>
  )
}

function EditUpdate({ update, origin, onClose, onSaved }: { update: Update; origin: HTMLElement | null; onClose: () => void; onSaved: (title: string, body: string) => void }) {
  const [title, setTitle] = useState(update.title)
  const [body, setBody] = useState(update.body)
  const [err, setErr] = useState<string | null>(null)
  async function save() {
    if (!title.trim()) return setErr('Enter a title')
    const res = await supabase.from('camp_updates').update({ title: title.trim(), body: body.trim() }).eq('id', update.id)
    if (res.error) return setErr('Something went wrong. Please try again.')
    onSaved(title.trim(), body.trim())
  }
  return (
    <Dialog
      open
      origin={origin}
      onClose={onClose}
      title="Edit Camp Update"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </>
      }
    >
      <div className="dlgform p6form">
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} error={err ?? undefined} />
        <TextAreaField label="Message" rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
    </Dialog>
  )
}
