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
  /** Ask Supabase to email a recovery link. Resolves either way: whether an
      account exists for the address is not ours to disclose. */
  requestPasswordReset: (email: string) => Promise<void>
  /** Set a new password for whoever the current session belongs to. */
  setPassword: (password: string) => Promise<void>
  /** True from the moment someone arrives on a recovery link until they have
      chosen a new password. The app must not be shown while this is true. */
  recovering: boolean
}

const AuthContext = createContext<AuthContextValue>(null!)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [recovering, setRecovering] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      // A recovery link signs the person in before anything else happens — the
      // Supabase client reads the token straight out of the URL. Without
      // noticing this event the app would simply open, leaving someone who came
      // to change their password looking at their dashboard with no idea what
      // became of the link they clicked.
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      if (event === 'SIGNED_OUT') setRecovering(false)
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

  const requestPasswordReset = async (email: string) => {
    // Same redirect rule as signing up: the link has to come back to whichever
    // origin asked for it, and that origin must be in Supabase's allow-list.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })
    // Supabase answers the same whether or not the address is registered, which
    // is what stops this being a way to find out who has an account. Only a
    // genuine failure — the mail server being down, or the rate limit — throws.
    if (error) throw error
  }

  const setPassword = async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw error
    setRecovering(false)
  }

  return (
    <AuthContext.Provider value={{
      session, loading, signIn, signUp, signOut,
      requestPasswordReset, setPassword, recovering,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
