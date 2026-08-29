import { useState } from 'react'
import { useAuth } from '../hooks/useAuth.js'
import { Eye, EyeOff, Loader2 } from 'lucide-react'

export default function AuthModal() {
  const { signUp, signIn, isSupabaseConfigured } = useAuth()
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const { error: err } = mode === 'signin' ? await signIn(email, password) : await signUp(email, password)
      if (err) throw err
      if (mode === 'signup') {
        setMessage('Check your email to confirm your account, then sign in.')
      }
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-bun-900 p-6">
        <div className="w-full max-w-md rounded-3xl glass p-8 text-center">
          <h2 className="text-2xl font-bold text-white mb-2">Supabase not connected</h2>
          <p className="text-slate-400 mb-6">Add your Supabase URL and anon key to <code>.env</code> to enable sign-in.</p>
          <button onClick={() => window.location.reload()} className="px-5 py-2.5 rounded-xl bg-violet-600 text-white font-medium">Reload after configuring</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bun-900/95 p-6">
      <div className="w-full max-w-md rounded-3xl glass p-8 card-glow">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-xl mx-auto mb-4">🦝</div>
          <h2 className="text-2xl font-bold text-white">{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h2>
          <p className="text-slate-400 text-sm mt-1">Your N2 progress stays private to your account.</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-xl bg-bun-900 border border-bun-600/40 px-3 py-2.5 text-slate-100 placeholder-slate-500 focus:border-violet-500 focus:outline-none"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
            <div className="relative">
              <input
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full rounded-xl bg-bun-900 border border-bun-600/40 px-3 py-2.5 text-slate-100 placeholder-slate-500 focus:border-violet-500 focus:outline-none"
                placeholder="••••••••"
              />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{error}</p>}
          {message && <p className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">{message}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium transition flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-slate-400">
          {mode === 'signin' ? 'New here?' : 'Already have an account?'}{' '}
          <button
            onClick={() => { setMode((m) => (m === 'signin' ? 'signup' : 'signin')); setError(''); setMessage('') }}
            className="text-violet-300 hover:text-violet-200 font-medium"
          >
            {mode === 'signin' ? 'Sign up' : 'Sign in'}
          </button>
        </div>
      </div>
    </div>
  )
}
