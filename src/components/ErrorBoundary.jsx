import { Component } from 'react'
import Mascot from './Mascot.jsx'
import { appendErrorLog } from '../lib/errorLog.js'
import { t as translate } from '../lib/i18n.js'
import { loadLanguage } from '../lib/learnerState.js'

// Crash boundary (P1-8). Before this, a render error anywhere in the
// shell unmounted the whole app to a blank dark screen — for a learner
// mid-session that reads as "the app ate my progress", the exact fear
// the comeback design exists to kill.
//
// The fallback says the true thing: the queue, diagnosis, promise and
// metrics live in local storage (and the account, when signed in), so a
// crashed screen has not lost them. The error is kept in a small local
// log (jpn:errorLog:v1, capped) the learner can share from the Fleet
// page; nothing is sent anywhere automatically.

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    appendErrorLog({
      at: new Date().toISOString(),
      message: String(error?.message || error || 'unknown error'),
      stack: String(error?.stack || '').slice(0, 1200),
      componentStack: String(info?.componentStack || '').slice(0, 800),
    })
  }

  render() {
    if (!this.state.error) return this.props.children
    // A class component has no hooks: resolve copy with the pure
    // translator in the language stored on this device (the crash may
    // have taken the provider down with the tree).
    const t = (key) => translate(loadLanguage()?.lang || 'en', key)
    return (
      <div className="min-h-screen bg-bun-900 text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-3xl glass p-8 card-glow text-center space-y-4">
          <div className="flex justify-center gap-2">
            <Mascot agent="koe" size={44} showName={false} />
            <Mascot agent="michi" size={44} showName={false} />
            <Mascot agent="nao" size={44} showName={false} />
          </div>
          <h1 className="text-xl font-bold text-white">{t('shell.error.title')}</h1>
          <p className="text-sm text-slate-300">
            {t('shell.error.bodyA')}<span className="text-white font-semibold">{t('shell.error.bodySafe')}</span>{t('shell.error.bodyB')}
          </p>
          <p className="text-xs text-slate-500">{t('shell.error.note')}</p>
          <div className="flex justify-center gap-3 pt-2">
            <button onClick={() => window.location.reload()} className="px-5 py-2.5 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-semibold">{t('shell.error.reload')}</button>
            <button onClick={() => this.setState({ error: null })} className="px-5 py-2.5 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-200 text-sm font-medium">{t('shell.error.retry')}</button>
          </div>
        </div>
      </div>
    )
  }
}
