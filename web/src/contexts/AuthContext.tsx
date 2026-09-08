import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface AuthContextValue {
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  /** Resolves true when the account is live immediately, false when Supabase
      is waiting on a confirmation email. */
  signUp: (email: string, password: string) => Promise<boolean>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>(null!)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  const signUp = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Where the confirmation link sends them back to. Without this Supabase
        // falls back to the project's single "Site URL", so a link mailed to a
        // real owner would land wherever that happened to be set — localhost,
        // during development. Sending the current origin means the deployed app
        // and a dev server each get their own visitors back, with no dashboard
        // change between them. The origin must be in Supabase's Redirect URLs
        // allow-list or the link is refused.
        emailRedirectTo: window.location.origin,
      },
    })
    if (error) throw error
    // A session here means the project confirms signups itself and the account
    // is already usable. No session means an email is on its way, and telling
    // the owner to go and read it is the only correct thing to say.
    return data.session !== null
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
