import { useState } from 'react'
import { useAuth } from '../hooks/useAuth.js'
import { Eye, EyeOff, Loader2, X } from 'lucide-react'
import { brand } from '../lib/brand.js'
import { DIAG_BUILD, bridgeTelegramSession, getTelegramInitData } from '../lib/telegramAuth.js'
import { supabase } from '../lib/supabaseClient.js'
import { useLanguage } from '../hooks/useLanguage.js'
import Mascot from './Mascot.jsx'

// Two doors, one component (Doc 12 audit #1):
//   variant 'gate'    — the signed-out wall on first load. Adds
//                       [Continue As Guest]: into the app on the local
//                       guest path, no account, choice remembered.
//   variant 'overlay' — opened deliberately from inside the app (a
//                       guest tapping Create Your Account). Dismissible;
//                       on sign-in the AuthContext effect adopts the
//                       guest's work into the account (anonMerge +
//                       stateSync), exactly as from the gate.
export default function AuthModal({ variant = 'gate', initialMode = 'signin', onClose } = {}) {
  const { signUp, signIn, resetPassword, continueAsGuest, isSupabaseConfigured, telegramBridgeStatus } = useAuth()
  const { t } = useLanguage()
  const [mode, setMode] = useState(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  // Sign In With Telegram (Landry's design, 2026-11-07): inside a
  // Telegram launch, one tap runs the bridge on demand — signing in
  // the linked account, or creating the account + link on first
  // use. The automatic bootstrap bridge stays; the button is the
  // deliberate, retryable form of the same act.
  const [tgBusy, setTgBusy] = useState(false)
  const [tgError, setTgError] = useState('')
  const inTelegram = getTelegramInitData().length > 0
  const signInWithTelegram = async () => {
    setTgBusy(true)
    setTgError('')
    try {
      const status = await bridgeTelegramSession({ client: supabase, force: true })
      if (status !== 'bridged' && status !== 'already') setTgError(status)
      // On success the session lands via onAuthStateChange and the
      // gate lifts on its own — nothing else to do here.
    } catch {
      setTgError('failed')
    } finally {
      setTgBusy(false)
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const { error: err } = mode === 'signin' ? await signIn(email, password) : await signUp(email, password)
      if (err) throw err
      if (mode === 'signup') {
        setMessage(t('auth.signupSuccess'))
      }
    } catch (err) {
      setError(err.message || t('auth.fallbackError'))
    } finally {
      setLoading(false)
    }
  }

  const forgotPassword = async () => {
    setError('')
    setMessage('')
    if (!email.trim()) {
      setError(t('auth.resetNeedsEmail'))
      return
    }
    setResetting(true)
    try {
      const { error: err } = await resetPassword(email.trim())
      if (err) throw err
      // Honest copy: sent either way — never confirms the account exists.
      setMessage(t('auth.resetSent'))
    } catch (err) {
      setError(err.message || t('auth.fallbackError'))
    } finally {
      setResetting(false)
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-bun-900 p-6">
        <div className="w-full max-w-md rounded-3xl glass p-8 text-center">
          <h2 className="text-2xl font-bold text-white mb-2">{t('auth.unavailableTitle')}</h2>
          <p className="text-slate-400 mb-6">{t('auth.unavailableBody')}</p>
          <button onClick={() => window.location.reload()} className="px-5 py-2.5 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white font-medium">{t('auth.reload')}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bun-900/95 p-6">
      <div className="relative w-full max-w-md rounded-3xl glass p-8 card-glow">
        {variant === 'overlay' && onClose && (
          <button onClick={onClose} aria-label={t('shell.menu.close')} className="absolute right-4 top-4 p-2 rounded-lg bg-bun-700 text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        )}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4"><Mascot agent="koe" size={56} mood="happy" showName={false} /></div>
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#FF8A75]">{brand.name} · {brand.tagline}</p>
          <h2 className="text-2xl font-bold text-white mt-1">{mode === 'signin' ? t('auth.welcomeBack') : t('auth.createAccountTitle')}</h2>
          <p className="text-slate-400 text-sm mt-1">{t('auth.privacyNote')}</p>
        </div>

        {telegramBridgeStatus === 'not-linked' && (
          <p className="mb-5 rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-sm text-sky-200">
            {t('auth.telegramNotLinked')}
          </p>
        )}

        {/* TEMPORARY DIAGNOSTICS (2026-11-07): inside Telegram's
            webview only, one small line naming the bridge status,
            whether Telegram's signed launch identity was present,
            and the diag build tag — so a screenshot identifies the
            failing branch without any network. Remove with the
            telegram_auth_diag investigation. */}
        {typeof window !== 'undefined' &&
          (window.Telegram?.WebApp || (window.location?.hash ?? '').includes('tgWebApp')) && (
          <p className="mb-5 text-center text-xs text-slate-500">
            Telegram bridge: {telegramBridgeStatus} · launch identity:{' '}
            {getTelegramInitData() ? `present (${getTelegramInitData().length})` : 'missing'} · {DIAG_BUILD}
          </p>
        )}

        {inTelegram && (
          <div className="mb-5">
            <button
              type="button"
              onClick={signInWithTelegram}
              disabled={tgBusy}
              className="w-full rounded-xl bg-[#229ED9] px-4 py-3 font-semibold text-white transition hover:bg-[#1b8ac2] disabled:opacity-60"
            >
              {tgBusy ? t('auth.telegramWorking') : t('auth.telegramButton')}
            </button>
            {tgError && (
              <p className="mt-2 text-sm text-rose-300">{t('auth.telegramFailed', { status: tgError })}</p>
            )}
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('auth.email')}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-xl bg-bun-900 border border-bun-600/40 px-3 py-2.5 text-slate-100 placeholder-slate-500 focus:border-[#FF6B57] focus:outline-none"
              placeholder={t('auth.emailPlaceholder')}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('auth.password')}</label>
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
            {mode === 'signin' ? t('auth.signIn') : t('auth.createAccount')}
          </button>
        </form>

        {mode === 'signin' && (
          <div className="mt-3 text-center">
            <button onClick={forgotPassword} disabled={resetting} className="text-sm text-slate-400 hover:text-slate-200 font-medium disabled:opacity-60">
              {resetting ? '…' : t('auth.forgotPassword')}
            </button>
          </div>
        )}

        <div className="mt-6 text-center text-sm text-slate-400">
          {mode === 'signin' ? t('auth.newHere') : t('auth.haveAccount')}{' '}
          <button
            onClick={() => { setMode((m) => (m === 'signin' ? 'signup' : 'signin')); setError(''); setMessage('') }}
            className="text-[#FF8A75] hover:text-[#FFA08D] font-medium"
          >
            {mode === 'signin' ? t('auth.signUp') : t('auth.signIn')}
          </button>
        </div>

        {variant === 'gate' && (
          <div className="mt-8 border-t border-bun-600/30 pt-6 text-center">
            <button
              onClick={continueAsGuest}
              className="w-full py-2.5 rounded-xl bg-bun-700/70 hover:bg-bun-700 border border-bun-600/40 text-slate-200 font-medium transition"
            >
              {t('auth.continueAsGuest')}
            </button>
            <p className="text-xs text-slate-500 mt-2">{t('auth.guestHint')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
