import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { supabase } from '../../lib/supabase'
import { MIN_PASSWORD } from '../../../server/shared'
import { Button, ButtonLink, TextField } from '../../components/ui'
import { AuthIntro, AuthLayout } from './AuthLayout'

/** Opened from the reset email; the link signs the person in for this step. */
export function ResetPassword() {
  const navigate = useNavigate()
  const [ready, setReady] = useState<'checking' | 'ok' | 'expired'>('checking')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [errors, setErrors] = useState<{ pw?: string; pw2?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // Supabase reads the link's token from the address bar.
    const t = setTimeout(async () => {
      const { data } = await supabase.auth.getSession()
      setReady(data.session ? 'ok' : 'expired')
    }, 400)
    return () => clearTimeout(t)
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const errs: typeof errors = {}
    if (pw.length < MIN_PASSWORD) errs.pw = `Password must be at least ${MIN_PASSWORD} characters`
    if (pw !== pw2) errs.pw2 = "Doesn't Match!"
    setErrors(errs)
    if (errs.pw || errs.pw2) return
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return setErrors({ form: 'Something went wrong. Please try again.' })
    navigate('/home', { replace: true })
  }

  if (ready === 'checking') return <AuthLayout><div aria-busy="true" style={{ minHeight: 120 }} /></AuthLayout>

  if (ready === 'expired') {
    return (
      <AuthLayout>
        <AuthIntro title="That link has expired">Reset links only work once, for 1 hour. You can ask for a new one.</AuthIntro>
        <ButtonLink to="/forgot-password" size="lg">
          Send a New Link
        </ButtonLink>
        <div className="auth__divider" />
        <ButtonLink to="/" variant="secondary" className="auth__center">
          Back to Log In
        </ButtonLink>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <form onSubmit={submit} noValidate style={{ display: 'contents' }}>
        <AuthIntro title="Reset Password">Choose a new password for your account.</AuthIntro>
        <TextField label="New Password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} error={errors.pw} />
        <TextField label="Confirm Password" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} error={errors.pw2} />
        {errors.form && <div role="alert" className="auth__formerror">{errors.form}</div>}
        <Button type="submit" size="lg" disabled={busy}>
          Save New Password
        </Button>
      </form>
    </AuthLayout>
  )
}
