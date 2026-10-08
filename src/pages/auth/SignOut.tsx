import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../../lib/auth'

/** Visiting /sign-out signs out and returns to the sign-in page. */
export function SignOut() {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  useEffect(() => {
    signOut().then(() => navigate('/', { replace: true }))
  }, [signOut, navigate])
  return null
}
