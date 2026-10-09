import { useRef, useState, type DragEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { forgetAvatar, photoExt, shrinkPhoto } from '../../lib/avatars'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { must, useLoad } from '../../lib/useLoad'
import { EMAIL_RE, internalEmail, MIN_PASSWORD } from '../../../server/shared'
import { Banner, Button, Skeleton, TextField } from '../../components/ui'
import { Dialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import './account.css'

const ID_LABEL = { student: 'Student ID', instructor: 'Instructor ID', admin: 'Admin ID' } as const

function PersonGlyph({ color }: { color: string }) {
  return (
    <svg width="58" height="58" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  )
}

export function Account() {
  const { profile, refresh } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const p = profile!
  const [origin, setOrigin] = useState<HTMLElement | null>(null)
  const [dialog, setDialog] = useState<'photo' | 'password' | 'email' | null>(null)

  const { data, reload } = useLoad(async () => {
    const [me, courses, team] = await Promise.all([
      supabase.from('people').select('recovery_email, avatar_path').eq('id', p.id).single(),
      p.courses.length ? supabase.from('courses').select('name, time_slot').in('id', p.courses.map((c) => c.id)).order('name') : Promise.resolve({ data: [], error: null }),
      p.role === 'student' ? supabase.from('team_members').select('team:teams(name)').eq('person_id', p.id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ])
    return {
      me: must(me) as { recovery_email: string | null; avatar_path: string | null },
      courses: must(courses) as { name: string; time_slot: string | null }[],
      team: ((team.data as { team: { name: string } | null } | null)?.team?.name ?? null) as string | null,
    }
  }, [p.id])

  async function removePhoto() {
    const old = data?.me.avatar_path
    const res = await supabase.from('people').update({ avatar_path: null }).eq('id', p.id)
    if (res.error) return toast('Something went wrong. Please try again.', 'error')
    if (old) {
      await supabase.storage.from('avatars').remove([old])
      forgetAvatar(old)
    }
    await refresh()
    reload()
  }

  const open = (d: 'photo' | 'password' | 'email') => (e: { currentTarget: HTMLElement }) => {
    setOrigin(e.currentTarget)
    setDialog(d)
  }
  const isStudent = p.role === 'student'
  const courseLine =
    p.role === 'instructor'
      ? (data?.courses ?? []).map((c) => [c.name, c.time_slot].filter(Boolean).join(' · ')).join(', ')
      : (data?.courses ?? []).map((c) => c.name).join(' · ')

  return (
    <>
      <Banner title="Your Account" plain narrow />
      <main className="acct-page">
        <section className="acct-photo">
          <span className={'acct-photo__circle' + (p.role === 'student' ? '' : ' is-staff')}>
            {p.avatarUrl ? <img src={p.avatarUrl} alt="Your photo" /> : <PersonGlyph color={p.role === 'student' ? '#5166D6' : '#17695A'} />}
          </span>
          <div className="acct-photo__name">
            <span className="acct-photo__full">
              {p.firstName} {p.lastName}
            </span>
            <span className="acct-photo__sub">{isStudent ? p.username : p.role === 'instructor' ? p.courses.map((c) => c.name).join(', ') : 'Admin'}</span>
          </div>
          <button type="button" className="acct-photo__btn" onClick={open('photo')}>
            {p.avatarUrl ? 'Change photo' : 'Upload Photo'}
          </button>
          {p.avatarUrl && (
            <button type="button" className="acct-photo__remove" onClick={removePhoto}>
              Remove photo
            </button>
          )}
          {isStudent && <span className="acct-note">Note: your photo shows next to your username on the leaderboard</span>}
        </section>

        <div className="acct-main">
          <section className="acct-card">
            <h2>Account Details</h2>
            <div className="acct-row">
              <span className="acct-row__label">{ID_LABEL[p.role]}</span>
              <span className="acct-row__val tnum">{p.personCode}</span>
            </div>
            {isStudent && (
              <div className="acct-row">
                <span className="acct-row__label">Username</span>
                <span className="acct-row__val">{p.username}</span>
              </div>
            )}
            <div className="acct-row">
              <span className="acct-row__label">First Name</span>
              <span className="acct-row__val">{p.firstName}</span>
            </div>
            <div className="acct-row">
              <span className="acct-row__label">Last Name</span>
              <span className="acct-row__val">{p.lastName}</span>
            </div>
            {isStudent && (
              <div className="acct-row">
                <span className="acct-row__label">Team</span>
                {data ? data.team ? <span className="acct-team">{data.team}</span> : <span className="acct-row__val">—</span> : <Skeleton width={70} />}
              </div>
            )}
            {p.role !== 'admin' && (
              <div className="acct-row">
                <span className="acct-row__label">{isStudent ? 'Course List' : 'Course'}</span>
                <span className="acct-row__val">{data ? courseLine || '—' : <Skeleton width={140} />}</span>
              </div>
            )}
          </section>

          <section className="acct-card">
            <h2>Sign-In &amp; Security</h2>
            <div className="acct-row">
              <div className="acct-row__stack">
                <span className="acct-row__label">Password</span>
                <span className="acct-row__val" style={{ letterSpacing: '0.2em' }}>••••••••</span>
              </div>
              <button type="button" className="acct-btn" onClick={open('password')}>Change Password</button>
            </div>
            <div className="acct-row">
              <div className="acct-row__stack">
                <span className="acct-row__label">Recovery/Backup Email</span>
                <span className="acct-row__val">{data ? data.me.recovery_email ?? '—' : <Skeleton width={160} />}</span>
              </div>
              <button type="button" className="acct-btn" onClick={open('email')}>Change Email</button>
            </div>
          </section>

          <Button variant="outline" className="acct-logout" onClick={() => navigate('/sign-out')}>
            Log Out
          </Button>
        </div>
      </main>

      {dialog === 'photo' && (
        <PhotoDialog
          origin={origin}
          oldPath={data?.me.avatar_path ?? null}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null)
            await refresh()
            reload()
            toast('All Changes Saved')
          }}
        />
      )}
      {dialog === 'password' && <PasswordDialog origin={origin} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); toast('Password changed') }} />}
      {dialog === 'email' && (
        <EmailDialog
          origin={origin}
          current={data?.me.recovery_email ?? ''}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            reload()
            toast('All Changes Saved')
          }}
        />
      )}
    </>
  )
}

function PhotoDialog({ origin, oldPath, onClose, onSaved }: { origin: HTMLElement | null; oldPath: string | null; onClose: () => void; onSaved: () => void }) {
  const { session } = useAuth()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  function pick(f: File | null | undefined) {
    setErr(null)
    if (!f) return
    if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type)) return setErr('Use a JPG, PNG, WebP or GIF image')
    if (f.size > 15 * 1024 * 1024) return setErr('Photos can be up to 15 MB')
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }
  function drop(e: DragEvent) {
    e.preventDefault()
    setOver(false)
    pick(e.dataTransfer.files?.[0])
  }
  async function save() {
    if (!file || !session) return
    setBusy(true)
    let small: Blob
    try {
      small = await shrinkPhoto(file)
    } catch {
      setBusy(false)
      return setErr('Couldn’t upload that photo. Please try again.')
    }
    const path = `${session.user.id}/avatar-${Date.now()}.${photoExt(small)}`
    const up = await supabase.storage.from('avatars').upload(path, small, { contentType: small.type, cacheControl: '31536000' })
    if (up.error) {
      setBusy(false)
      return setErr('Couldn’t upload that photo. Please try again.')
    }
    const res = await supabase.from('people').update({ avatar_path: path }).eq('auth_user_id', session.user.id)
    if (res.error) {
      setBusy(false)
      return setErr('Something went wrong. Please try again.')
    }
    if (oldPath) {
      await supabase.storage.from('avatars').remove([oldPath])
      forgetAvatar(oldPath)
    }
    onSaved()
  }

  return (
    <Dialog
      open
      origin={origin}
      onClose={onClose}
      title="Upload Photo"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!file || busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <div
        className={'dropzone' + (over ? ' is-over' : '')}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        {preview ? <img src={preview} alt="New photo" className="dropzone__img" /> : <span className="dropzone__text">Drag a photo here</span>}
        <Button variant="outline" onClick={() => input.current?.click()}>Choose File</Button>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      {err && <p role="alert" className="field__error" style={{ marginTop: 10 }}>{err}</p>}
    </Dialog>
  )
}

function PasswordDialog({ origin, onClose, onSaved }: { origin: HTMLElement | null; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth()
  const [cur, setCur] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [errs, setErrs] = useState<{ cur?: string; pw?: string; pw2?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    const next: typeof errs = {}
    if (!cur) next.cur = 'Enter your current password'
    if (pw.length < MIN_PASSWORD) next.pw = `Password must be at least ${MIN_PASSWORD} characters`
    if (pw !== pw2) next.pw2 = "Doesn't Match!"
    setErrs(next)
    if (Object.keys(next).length || !profile) return
    setBusy(true)
    // Check the current password first.
    const check = await supabase.auth.signInWithPassword({ email: internalEmail(profile.personCode), password: cur })
    if (check.error) {
      setBusy(false)
      return setErrs({ cur: 'That password isn’t right' })
    }
    const res = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (res.error) return setErrs({ form: 'Something went wrong. Please try again.' })
    onSaved()
  }

  return (
    <Dialog
      open
      origin={origin}
      onClose={onClose}
      title="Change Password"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => submit()} disabled={busy}>Change Password</Button>
        </>
      }
    >
      <form onSubmit={submit} className="dlgform" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <TextField label="Current Password" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} error={errs.cur} />
        <TextField label="New Password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} error={errs.pw} />
        <TextField label="Confirm Password" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} error={errs.pw2} />
        {errs.form && <p role="alert" className="field__error">{errs.form}</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

function EmailDialog({ origin, current, onClose, onSaved }: { origin: HTMLElement | null; current: string; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth()
  const [email, setEmail] = useState(current)
  const [err, setErr] = useState<string | null>(null)
  async function submit(e?: FormEvent) {
    e?.preventDefault()
    if (!EMAIL_RE.test(email.trim())) return setErr('Please enter a valid email')
    const res = await supabase.from('people').update({ recovery_email: email.trim() }).eq('id', profile!.id)
    if (res.error) return setErr('Something went wrong. Please try again.')
    onSaved()
  }
  return (
    <Dialog
      open
      origin={origin}
      onClose={onClose}
      title="Change Email"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => submit()}>Save</Button>
        </>
      }
    >
      <form onSubmit={submit} className="dlgform">
        <TextField label="Recovery/Backup Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={err ?? undefined} hint="Password reset links are sent here" />
      </form>
    </Dialog>
  )
}
