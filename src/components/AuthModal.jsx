import { useState } from 'react'
import { useAuth } from '../hooks/useAuth.js'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { brand } from '../lib/brand.js'
import Mascot from './Mascot.jsx'

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
          <h2 className="text-2xl font-bold text-white mb-2">Sign-in is not available right now</h2>
          <p className="text-slate-400 mb-6">Please try again in a little while. Your progress on this device is safe.</p>
          <button onClick={() => window.location.reload()} className="px-5 py-2.5 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white font-medium">Reload</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bun-900/95 p-6">
      <div className="w-full max-w-md rounded-3xl glass p-8 card-glow">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4"><Mascot agent="koe" size={56} mood="happy" showName={false} /></div>
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#FF8A75]">{brand.name} · {brand.tagline}</p>
          <h2 className="text-2xl font-bold text-white mt-1">{mode === 'signin' ? 'Welcome Back' : 'Create Your Account'}</h2>
          <p className="text-slate-400 text-sm mt-1">Your progress stays private to your account.</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-xl bg-bun-900 border border-bun-600/40 px-3 py-2.5 text-slate-100 placeholder-slate-500 focus:border-[#FF6B57] focus:outline-none"
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
                className="w-full rounded-xl bg-bun-900 border border-bun-600/40 px-3 py-2.5 text-slate-100 placeholder-slate-500 focus:border-[#FF6B57] focus:outline-none"
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
            className="w-full py-2.5 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white font-medium transition flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            {mode === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-slate-400">
          {mode === 'signin' ? 'New here?' : 'Already have an account?'}{' '}
          <button
            onClick={() => { setMode((m) => (m === 'signin' ? 'signup' : 'signin')); setError(''); setMessage('') }}
            className="text-[#FF8A75] hover:text-[#FFA08D] font-medium"
          >
            {mode === 'signin' ? 'Sign Up' : 'Sign In'}
          </button>
        </div>
      </div>
    </div>
  )
}
