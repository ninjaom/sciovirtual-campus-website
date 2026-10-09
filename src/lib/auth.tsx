import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { avatarLink } from './avatars'
import type { CourseRef, Profile, Role } from './types'

interface AuthState {
  loading: boolean
  session: Session | null
  profile: Profile | null
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data: person, error } = await supabase
    .from('people')
    .select('id, person_code, first_name, last_name, role, username, avatar_path')
    .eq('auth_user_id', userId)
    .maybeSingle()
  if (error || !person) return null

  let courses: CourseRef[] = []
  if (person.role === 'admin') {
    const { data } = await supabase.from('courses').select('id, short_code, name').eq('archived', false).order('name')
    courses = (data ?? []).map((c) => ({ id: c.id, code: c.short_code, name: c.name }))
  } else {
    const table = person.role === 'instructor' ? 'course_staff' : 'enrollments'
    const { data } = await supabase
      .from(table)
      .select('course:courses(id, short_code, name)')
      .eq('person_id', person.id)
    courses = (data ?? [])
      .map((r) => r.course as unknown as { id: string; short_code: string; name: string } | null)
      .filter((c): c is { id: string; short_code: string; name: string } => !!c)
      .map((c) => ({ id: c.id, code: c.short_code, name: c.name }))
  }

  // Photos live in a private bucket; signed links expire after an hour.
  const avatarUrl = await avatarLink(person.avatar_path)

  return {
    id: person.id,
    personCode: person.person_code,
    firstName: person.first_name,
    lastName: person.last_name,
    role: person.role as Role,
    username: person.username,
    avatarUrl,
    courses,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)

  const load = useCallback(async (s: Session | null) => {
    setSession(s)
    setProfile(s ? await loadProfile(s.user.id) : null)
    setLoading(false)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => load(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // Defer so Supabase finishes its own work before we query.
      setTimeout(() => load(s), 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [load])

  const value: AuthState = {
    loading,
    session,
    profile,
    refresh: async () => load((await supabase.auth.getSession()).data.session),
    signOut: async () => {
      await supabase.auth.signOut()
    },
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

