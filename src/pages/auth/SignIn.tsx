import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { supabase } from '../../lib/supabase'
import { internalEmail, normalizeId } from '../../../server/shared'
import { Button, ButtonLink, TextField } from '../../components/ui'
import { AuthIntro, AuthLayout } from './AuthLayout'

export function SignIn() {
  const [id, setId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!id.trim() || !password) return setError("That ID or password isn't right")
    setBusy(true)
    const { error: err } = await supabase.auth.signInWithPassword({ email: internalEmail(normalizeId(id)), password })
    setBusy(false)
    // On success the auth listener redirects to Home.
    if (err) setError(err.status === 429 ? 'Too many tries. Please wait a few minutes and try again.' : "That ID or password isn't right")
  }

  return (
    <AuthLayout showSiteLink>
      <form onSubmit={submit} noValidate style={{ display: 'contents' }}>
        <AuthIntro title="Welcome!">Please input your student ID and password to enter.</AuthIntro>
        <TextField label="ID" value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" autoCapitalize="characters" spellCheck={false} />
        <div className="field">
          <div className="auth__labelrow">
            <label htmlFor="signin-pass" className="field__label">
              Password
            </label>
            <Link to="/forgot-password" className="auth__small">
              Forgot password?
            </Link>
          </div>
          <input
            id="signin-pass"
            type="password"
            className={'input' + (error ? ' is-invalid' : '')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'signin-err' : undefined}
          />
          {error && (
            <span id="signin-err" role="alert" className="field__error">
              {error}
            </span>
          )}
        </div>
        <Button type="submit" size="lg" disabled={busy}>
          Log In
        </Button>
        <div className="auth__divider" />
        <ButtonLink to="/sign-up" variant="secondary" className="auth__center">
          First Time - Sign Up Here
        </ButtonLink>
      </form>
    </AuthLayout>
  )
}
