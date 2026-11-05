import { brand } from '../lib/brand.js'

// Terms of Use — plain language, honest about what Yonde is and is not.
// DRAFT until the same confirmations as the Privacy Policy (Doc 15).
const CONTACT = 'support@yonde.app'

function Section({ title, children }) {
  return (
    <section className="space-y-2">
      <h3 className="text-base font-bold text-white">{title}</h3>
      <div className="text-sm text-slate-300 leading-relaxed space-y-2">{children}</div>
    </section>
  )
}

export default function Terms({ setActive }) {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Terms Of Use</h2>
        <p className="text-sm text-slate-400 mt-1">{brand.name} — {brand.tagline}. Last updated 5 November 2026. <span className="text-amber-300">Draft — to be confirmed before public launch.</span></p>
      </div>

      <Section title="What Yonde is">
        <p>{brand.name} is a Japanese learning app. A small fleet of AI agents — a sensei who calls you, a fixer, a planner, a maker, a miner, and a coach — builds each day's practice around your level, your mistakes, and your real life in Japan, from your first words to N1 and the BJT (business Japanese test).</p>
      </Section>

      <Section title="What Yonde is not">
        <p><strong className="text-slate-100">Not a phone service.</strong> The Yobidashi is a practice call inside the app, with your AI sensei. It does not use your phone number, cannot call real phone numbers, and is never a real person calling you. <strong className="text-slate-100">Not an exam body.</strong> Scores shown in the app — diagnosis results, mock exams, BJT band estimates — are estimates to guide your study, labelled as estimates where you see them. Only the official exams give official scores. JLPT is administered by the Japan Foundation and JEES; the BJT is administered by the Japan Kanji Aptitude Testing Foundation. {brand.name} is not affiliated with either.</p>
      </Section>

      <Section title="Your promises — and ours">
        <p>When the app writes you a 60-day promise, it is computed from your own diagnosis by fixed rules, and it is re-issued honestly if your situation changes — a smaller promise kept beats a bigger one broken. The promise is a study plan with a target, not a guarantee of an exam result; no app can honestly guarantee that, and you should be suspicious of any that does.</p>
      </Section>

      <Section title="AI content">
        <p>Your fleet is artificial intelligence. AI can make mistakes — a wrong correction, an unnatural sentence. If you see AI content that looks wrong or offensive, use <em>Report This Reply</em> where it appears; reports are read and used to fix the fleet's material and filters. If a correction ever really matters — a document for your employer, an official form — have a human expert check it.</p>
      </Section>

      <Section title="Fair use">
        <p>Use {brand.name} to learn. Don't use it to abuse the service, to generate harmful content, or to misrepresent AI output as official documents or certified translations. Accounts that do may be closed, with their data handled as the Privacy Policy describes.</p>
      </Section>

      <Section title="Money">
        <p>{brand.name} is free today. If paid plans are introduced later, digital purchases will be sold through the app stores' own payment systems, with the price and what you get stated plainly before you subscribe — and nothing you already have will be taken away by a pricing change.</p>
      </Section>

      <Section title="Your data">
        <p>Your data is governed by the Privacy Policy: it lives on your device, it is never sold, and you can export or delete it in the app at any time.</p>
      </Section>

      <Section title="Changes and contact">
        <p>If these terms change in a way that matters, the app will say so before the change applies to you. Questions: <span className="text-slate-100">{CONTACT}</span> <span className="text-amber-300">(address to be confirmed before public launch)</span>.</p>
      </Section>

      <div className="flex flex-wrap gap-2 pt-2">
        <button onClick={() => setActive?.('privacy')} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium">Privacy Policy</button>
        <button onClick={() => setActive?.('dashboard')} className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold">Back To Today</button>
      </div>
    </div>
  )
}
