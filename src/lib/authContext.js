import { createContext } from 'react'

export const AuthContext = createContext({
  session: null,
  user: null,
  loading: true,
  isSupabaseConfigured: false,
  signUp: async () => ({}),
  signIn: async () => ({}),
  signOut: async () => {},
})
