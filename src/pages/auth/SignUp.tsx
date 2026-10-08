import { useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { supabase } from '../../lib/supabase'
import { postApi } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { EMAIL_RE, internalEmail, MIN_PASSWORD, normalizeId, USERNAME_RE, type CheckCodeResult, type SignUpError } from '../../../server/shared'
import { Button, TextField } from '../../components/ui'
import { AuthIntro, AuthLayout } from './AuthLayout'

type Errors = Partial<Record<'code' | 'username' | 'password' | 'password2' | 'email' | 'form', string>>

const MESSAGES: Record<SignUpError, { field: keyof Errors; text: string }> = {
  invalid_code: { field: 'code', text: "That setup code isn't valid" },
  rate_limited: { field: 'code', text: 'Too many tries. Please wait 15 minutes and try again.' },
  username_taken: { field: 'username', text: 'That username is already taken' },
  username_format: { field: 'username', text: 'Use 3–24 letters, numbers, underscores or periods' },
  password_short: { field: 'password', text: `Password must be at least ${MIN_PASSWORD} characters` },
  email_format: { field: 'email', text: 'Please enter a valid email' },
  server: { field: 'form', text: 'Something went wrong. Please try again.' },
}

export function SignUp() {
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const [id, setId] = useState('')
  const [code, setCode] = useState('')
  const [username, setUsername] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [email, setEmail] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [check, setCheck] = useState<CheckCodeResult | null>(null)
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Until the code is checked, show every section (as in the mockup).
  const isReset = check?.ok && check.kind === 'reset'
  const showUsername = !isReset && (!check?.ok || check.role === 'student')
  const showNewAccountBits = !isReset

  async function checkCode() {
    if (!id.trim() || !code.trim()) return
    const res = await postApi<CheckCodeResult>('check-code', { id, code })
    setCheck(res)
    setErrors((e) => ({ ...e, code: res.ok ? undefined : MESSAGES[res.error ?? 'invalid_code'].text }))
  }

  function pickPhoto(f: File | null) {
    if (preview) URL.revokeObjectURL(preview)
    setPhoto(f)
    setPreview(f ? URL.createObjectURL(f) : null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const errs: Errors = {}
    if (!id.trim() || !code.trim()) errs.code = "That setup code isn't valid"
    if (showUsername && !USERNAME_RE.test(username.trim())) errs.username = MESSAGES.username_format.text
    if (pw.length < MIN_PASSWORD) errs.password = MESSAGES.password_short.text
    if (pw !== pw2) errs.password2 = "Doesn't Match!"
    if (showNewAccountBits && !EMAIL_RE.test(email.trim())) errs.email = MESSAGES.email_format.text
    setErrors(errs)
    if (Object.values(errs).some(Boolean)) return

    setBusy(true)
    const res = await postApi<{ ok: boolean; error?: SignUpError }>('sign-up', {
      id,
      code,
      password: pw,
      username: username.trim(),
      recoveryEmail: email.trim(),
    })
    if (!res.ok) {
      const m = MESSAGES[res.error ?? 'server']
      setErrors({ [m.field]: m.text })
      setBusy(false)
      return
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email: internalEmail(normalizeId(id)), password: pw })
    if (error || !data.user) {
      setBusy(false)
      navigate('/', { replace: true })
      return
    }

    // Optional photo, uploaded once signed in.
    if (photo && showNewAccountBits) {
      const ext = (photo.name.split('.').pop() ?? 'jpg').toLowerCase()
      const path = `${data.user.id}/avatar-${Date.now()}.${ext}`
      const up = await supabase.storage.from('avatars').upload(path, photo, { upsert: true, contentType: photo.type })
      if (!up.error) await supabase.from('people').update({ avatar_path: path }).eq('auth_user_id', data.user.id)
    }
    await refresh()
    navigate('/home', { replace: true })
  }

  return (
    <AuthLayout wide>
      <form onSubmit={submit} noValidate style={{ display: 'contents' }}>
        <div className="su__steps" aria-hidden="true">
          <span className="su__dot is-on">1</span>
          <span className="su__line is-on" />
          <span className="su__dot">2</span>
        </div>
        <AuthIntro title="Sign Up!">
          Please input the relevant information accurately - the password is original to this site only, and the ID is the one given through email.
        </AuthIntro>

        <section className="su__section">
          <p className="su__eyebrow">BASIC INFORMATION</p>
          <div className="su__row">
            <TextField label="ID" value={id} onChange={(e) => setId(e.target.value)} onBlur={checkCode} autoCapitalize="characters" spellCheck={false} />
            <TextField
              label="Setup Code"
              className="su__code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onBlur={checkCode}
              autoCapitalize="characters"
              autoComplete="one-time-code"
              spellCheck={false}
              error={errors.code}
            />
          </div>
        </section>

        {showUsername && (
          <section className="su__section">
            <p className="su__eyebrow">USERNAME</p>
            <TextField
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              spellCheck={false}
              error={errors.username}
              hint="Please use the same username you chose in the GTKY form. It can't be changed later!"
            />
          </section>
        )}

        <section className="su__section su__section--last">
          <p className="su__eyebrow">PASSCODE SETUP</p>
          <div className="su__row">
            <TextField label="New Password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} error={errors.password} />
            <TextField label="Confirm Password" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} error={errors.password2} />
          </div>
          {showNewAccountBits && (
            <TextField
              label="Recovery/Backup Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={errors.email}
              hint="Note: this email is only used for password resets, nothing else"
            />
          )}
        </section>

        {showNewAccountBits && (
          <section className="su__section su__section--top">
            <p className="su__eyebrow">
              Profile picture&nbsp;<small>(optional)</small>
            </p>
            <div className="su__photo">
              <span className="su__photoCircle">
                {preview ? (
                  <img src={preview} alt="Your photo" />
                ) : (
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
                  </svg>
                )}
              </span>
              <div className="su__photoSide">
                <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                  Upload Photo
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  hidden
                  onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)}
                />
                <span className="field__hint">Note: you can add or change this later in your account</span>
              </div>
            </div>
          </section>
        )}

        {errors.form && (
          <div role="alert" className="auth__formerror">
            {errors.form}
          </div>
        )}
        <Button type="submit" size="lg" disabled={busy}>
          Finish Sign-Up
        </Button>
      </form>
    </AuthLayout>
  )
}
