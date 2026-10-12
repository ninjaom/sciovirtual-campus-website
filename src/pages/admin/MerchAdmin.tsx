import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { must, useLoad } from '../../lib/useLoad'
import { useCurrentEvent } from '../../lib/useEvent'
import { useAutosave } from '../../lib/useAutosave'
import { signFiles } from '../../lib/files'
import { photoExt, shrinkImage } from '../../lib/avatars'
import { Button, ButtonLink, Card, SavedStatus, Skeleton, Switch, TableWrap, Tabs, TextField } from '../../components/ui'
import { Dialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import { AdminHead, LoadError, Note } from './AdminBits'
import './phase6.css'

interface Item {
  id: string
  name: string
  credit_cost: number
  image_path: string | null
  visible: boolean
  sort: number
}
type Links = { merch_student_form_url: string | null; merch_instructor_form_url: string | null; merch_recommendation_form_url: string | null }

/** Admin › Merchandise (AdminMerch mockup board). */
export function MerchAdmin() {
  const toast = useToast()
  const ev = useCurrentEvent()
  const eventId = ev.data?.event?.id ?? null
  const s = ev.data?.settings ?? null
  const [origin, setOrigin] = useState<HTMLElement | null>(null)
  const [editing, setEditing] = useState<Item | 'new' | null>(null)
  const [ready, setReady] = useState<boolean | null>(null)

  const { data, error, reload, setData } = useLoad(async () => {
    if (!eventId) return null
    const items = must(await supabase.from('merch_items').select('id, name, credit_cost, image_path, visible, sort').eq('event_id', eventId).order('sort').order('credit_cost')) as Item[]
    return { items, urls: await signFiles('merch', items.map((i) => i.image_path)) }
  }, [eventId])

  const isReady = ready ?? !!s?.merch_ready
  async function setStatus(v: 'ready' | 'soon') {
    if (!eventId) return
    setReady(v === 'ready')
    const res = await supabase.from('settings').update({ merch_ready: v === 'ready' }).eq('event_id', eventId)
    if (res.error) {
      setReady(null)
      return toast('Something went wrong. Please try again.', 'error')
    }
    toast('All Changes Saved')
  }

  async function toggleShown(it: Item, on: boolean) {
    setData((d) => (d ? { ...d, items: d.items.map((x) => (x.id === it.id ? { ...x, visible: on } : x)) } : d))
    const res = await supabase.from('merch_items').update({ visible: on }).eq('id', it.id)
    if (res.error) {
      toast('Something went wrong. Please try again.', 'error')
      reload()
    }
  }

  return (
    <>
      <AdminHead title="Merchandise">
        <ButtonLink to="/merchandise" variant="secondary">Preview Page</ButtonLink>
      </AdminHead>
      {error && <LoadError message={error} />}

      <Card title="Page Status">
        {!s ? (
          <Skeleton height={44} />
        ) : (
          <Tabs<'ready' | 'soon'>
            label="Merchandise page status"
            value={isReady ? 'ready' : 'soon'}
            onChange={setStatus}
            options={[
              { value: 'ready', label: 'Catalog' },
              { value: 'soon', label: 'Coming Soon' },
            ]}
          />
        )}
      </Card>

      {s && eventId && <FormLinks eventId={eventId} initial={s} />}

      <Card
        title="Catalog Items"
        actions={<Button variant="secondary" onClick={(e) => { setOrigin(e.currentTarget); setEditing('new') }}>+ Add Item</Button>}
      >
        {!data ? (
          <Skeleton height={180} />
        ) : (
          <TableWrap>
            <table className="atable">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Points</th>
                  <th>Shown</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it) => (
                  <tr key={it.id}>
                    <td>
                      <span className="p6item">
                        <span className="p6thumb">{it.image_path && data.urls.get(it.image_path) ? <img src={data.urls.get(it.image_path)} alt="" /> : null}</span>
                        <strong>{it.name}</strong>
                      </span>
                    </td>
                    <td className="num">{it.credit_cost.toLocaleString('en-US')}</td>
                    <td>
                      <Switch checked={it.visible} label={`Show ${it.name}`} onChange={(v) => toggleShown(it, v)} />
                    </td>
                    <td className="actions">
                      <Button variant="outline" size="sm" onClick={(e) => { setOrigin(e.currentTarget); setEditing(it) }}>Edit</Button>
                    </td>
                  </tr>
                ))}
                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p6empty">No items yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Note>Note: points are hidden on the instructor page</Note>
      </Card>

      {editing && eventId && (
        <ItemDialog
          item={editing === 'new' ? null : editing}
          url={editing !== 'new' && editing.image_path ? data?.urls.get(editing.image_path) ?? null : null}
          eventId={eventId}
          sort={(data?.items.length ?? 0) + 1}
          origin={origin}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); reload(); toast(msg) }}
        />
      )}
    </>
  )
}

function FormLinks({ eventId, initial }: { eventId: string; initial: Links }) {
  const [f, setF] = useState({
    merch_student_form_url: initial.merch_student_form_url ?? '',
    merch_instructor_form_url: initial.merch_instructor_form_url ?? '',
    merch_recommendation_form_url: initial.merch_recommendation_form_url ?? '',
  })
  const save = useAutosave<Links>((patch) => supabase.from('settings').update(patch).eq('event_id', eventId))
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setF((x) => ({ ...x, [k]: e.target.value }))
    save.change({ [k]: e.target.value.trim() || null })
  }
  return (
    <Card title="Form Links">
      <div className="fieldrow">
        <TextField label="Student claim form" value={f.merch_student_form_url} onChange={set('merch_student_form_url')} placeholder="https://forms.gle/…" fieldStyle={{ flex: '1 1 220px' }} />
        <TextField label="Instructor claim form" value={f.merch_instructor_form_url} onChange={set('merch_instructor_form_url')} placeholder="https://forms.gle/…" fieldStyle={{ flex: '1 1 220px' }} />
        <TextField label="Merch Recommendation Form" value={f.merch_recommendation_form_url} onChange={set('merch_recommendation_form_url')} placeholder="https://forms.gle/…" fieldStyle={{ flex: '1 1 220px' }} />
      </div>
      <SavedStatus state={save.state} />
    </Card>
  )
}

function ItemDialog({
  item,
  url,
  eventId,
  sort,
  origin,
  onClose,
  onSaved,
}: {
  item: Item | null
  url: string | null
  eventId: string
  sort: number
  origin: HTMLElement | null
  onClose: () => void
  onSaved: (msg: string) => void
}) {
  const [name, setName] = useState(item?.name ?? '')
  const [cost, setCost] = useState(item ? String(item.credit_cost) : '')
  const [shown, setShown] = useState(item?.visible ?? true)
  const [pic, setPic] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(url)
  const [removePic, setRemovePic] = useState(false)
  const [errs, setErrs] = useState<{ name?: string; cost?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function pick(f: File | null | undefined) {
    if (!f) return
    if (!/^image\//.test(f.type)) return setErrs({ form: 'Use a JPG, PNG or WebP picture' })
    if (f.size > 15 * 1024 * 1024) return setErrs({ form: 'Pictures can be up to 15 MB' })
    setErrs({})
    setPic(f)
    setRemovePic(false)
    setPreview(URL.createObjectURL(f))
  }

  async function save() {
    const next: typeof errs = {}
    if (!name.trim()) next.name = 'Enter a name'
    const n = Number(cost)
    if (cost.trim() === '' || !Number.isInteger(n) || n < 0) next.cost = 'Enter a whole number, 0 or more'
    setErrs(next)
    if (Object.keys(next).length) return
    setBusy(true)
    let image_path = removePic ? null : item?.image_path ?? null
    if (pic) {
      try {
        const small = await shrinkImage(pic)
        const path = `${eventId}/${crypto.randomUUID()}.${photoExt(small)}`
        const up = await supabase.storage.from('merch').upload(path, small, { contentType: small.type, cacheControl: '31536000' })
        if (up.error) throw up.error
        image_path = path
      } catch {
        setBusy(false)
        return setErrs({ form: 'Couldn’t upload that picture. Please try again.' })
      }
    }
    const row = { name: name.trim(), credit_cost: n, visible: shown, image_path }
    const res = item ? await supabase.from('merch_items').update(row).eq('id', item.id) : await supabase.from('merch_items').insert({ ...row, event_id: eventId, sort })
    setBusy(false)
    if (res.error) return setErrs({ form: 'Something went wrong. Please try again.' })
    if (item?.image_path && item.image_path !== image_path) await supabase.storage.from('merch').remove([item.image_path])
    onSaved(item ? 'All Changes Saved' : 'Added')
  }

  async function remove() {
    if (!item) return
    const res = await supabase.from('merch_items').delete().eq('id', item.id)
    if (res.error) return setErrs({ form: 'Something went wrong. Please try again.' })
    if (item.image_path) await supabase.storage.from('merch').remove([item.image_path])
    onSaved('Deleted')
  }

  if (confirm && item)
    return (
      <Dialog
        open
        origin={origin}
        onClose={() => setConfirm(false)}
        title={`Delete ${item.name}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="danger" onClick={remove}>Delete</Button>
          </>
        }
      >
        <p style={{ fontSize: 15, color: 'var(--text-muted)' }}>This can't be undone.</p>
      </Dialog>
    )

  return (
    <Dialog
      open
      origin={origin}
      onClose={onClose}
      title={item ? `Edit ${item.name}` : '+ Add Item'}
      footer={
        <>
          {item && (
            <Button variant="outline" className="btn--danger-outline" style={{ marginRight: 'auto' }} onClick={() => setConfirm(true)}>
              Delete
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : item ? 'Save' : '+ Add Item'}</Button>
        </>
      }
    >
      <div className="dlgform p6form">
        <div className="p6pic">
          <span className="p6pic__img">{preview && !removePic ? <img src={preview} alt="" /> : null}</span>
          <div className="p6pic__btns">
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>{preview && !removePic ? 'Change Picture' : 'Add Picture'}</Button>
            {preview && !removePic && (
              <Button variant="outline" size="sm" onClick={() => { setRemovePic(true); setPic(null) }}>Remove Picture</Button>
            )}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => pick(e.target.files?.[0])} />
          </div>
        </div>
        <TextField label="Item" value={name} onChange={(e) => setName(e.target.value)} error={errs.name} autoFocus={!item} />
        <TextField label="Points" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} error={errs.cost} />
        <div className="switchrow">
          <span className="field__label">Shown?</span>
          <Switch checked={shown} onChange={setShown} label="Shown?" />
        </div>
        {errs.form && <p role="alert" className="field__error">{errs.form}</p>}
      </div>
    </Dialog>
  )
}
