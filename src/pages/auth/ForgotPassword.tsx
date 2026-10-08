import { useState, type FormEvent } from 'react'
import { postApi } from '../../lib/api'
import { Button, ButtonLink, TextField } from '../../components/ui'
import { AuthIntro, AuthLayout } from './AuthLayout'

export function ForgotPassword() {
  const [id, setId] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!id.trim()) return
    setBusy(true)
    await postApi('forgot-password', { id })
    setBusy(false)
    setSent(true)
  }

  if (sent) {
    return (
      <AuthLayout>
        <AuthIntro title="Check your email!">
          If that ID has a recovery email, a reset link is on its way. It expires in 1 hour.
        </AuthIntro>
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
          No email? Check your spam folder, or ask a director for a new setup code.
        </p>
        <ButtonLink to="/" variant="secondary" className="auth__center">
          Back to Log In
        </ButtonLink>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <form onSubmit={submit} noValidate style={{ display: 'contents' }}>
        <AuthIntro title="Forgot Password?">
          Enter your ID and we'll send a reset link to your recovery email.
        </AuthIntro>
        <TextField label="ID" value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" autoCapitalize="characters" spellCheck={false} />
        <Button type="submit" size="lg" disabled={busy || !id.trim()}>
          Send Reset Link
        </Button>
        <div className="auth__divider" />
        <ButtonLink to="/" variant="secondary" className="auth__center">
          Back to Log In
        </ButtonLink>
      </form>
    </AuthLayout>
  )
}
