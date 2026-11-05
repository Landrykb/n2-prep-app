import { brand } from '../lib/brand.js'

// Privacy Policy — drafted from Doc 10 (Security & Privacy) facts only.
// DRAFT until Landry confirms the contact email and the hosted URL
// (Doc 15 §1: Apple 5.1.1(i) requires this policy linked in store metadata
// AND easily accessible in-app — this page is the in-app half).
const CONTACT = 'support@yonde.app'

function Section({ title, children }) {
  return (
    <section className="space-y-2">
      <h3 className="text-base font-bold text-white">{title}</h3>
      <div className="text-sm text-slate-300 leading-relaxed space-y-2">{children}</div>
    </section>
  )
}

export default function PrivacyPolicy({ setActive }) {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Privacy Policy</h2>
        <p className="text-sm text-slate-400 mt-1">{brand.name} — {brand.tagline}. Last updated 5 November 2026. <span className="text-amber-300">Draft: the contact address below is to be confirmed before public launch.</span></p>
      </div>

      <Section title="The short version">
        <p>{brand.name} learns how you learn. Almost everything it knows about you lives <strong className="text-slate-100">on your own device</strong>. We do not sell your data, we do not show you ads, and we do not keep recordings of your voice. You can see everything your fleet knows about you, export it, or delete it — inside the app, whenever you want.</p>
      </Section>

      <Section title="What lives on your device">
        <p>Your Learner Twin (your levels by section, your error patterns, how you like to learn), your review queue, your problem profile, your diagnosis results and history, your Yobidashi call settings and call history, Saki's plans, Michi's letters, and your answers to “did that feel like studying?” — all of this is stored in this app on this device. Open <em>Your Fleet</em> to inspect it in plain language.</p>
      </Section>

      <Section title="What an account adds">
        <p>If you create an account, your email address and your learning progress are stored with our hosting provider (Supabase) so they can follow you across devices. Every server table is protected so that your account can only ever read its own rows. If you never create an account, nothing in this section applies to you.</p>
      </Section>

      <Section title="Your voice">
        <p>When you speak in a scene or a Yobidashi call, your browser's speech recognition turns your voice into text. That text — your version of the sentence — is what gets corrected, and it is kept on your device as part of your learning record. <strong className="text-slate-100">We do not record or store audio of your voice.</strong> Depending on your browser, its speech service may process audio on the browser maker's servers; your browser's own privacy policy covers that part.</p>
      </Section>

      <Section title="Documents you paste (Mine Your Japanese)">
        <p>Text you paste — a letter from school, an email from work — is processed <strong className="text-slate-100">on this device</strong> to make practice cards for you. The original text is not kept after your cards are made, and it is never shared with other users, not even as an “anonymous example”. Your documents can contain the most private details in the app, and they are treated that way.</p>
      </Section>

      <Section title="Artificial intelligence — what is shared, and when">
        <p>Your practice partners (Koe, Nao, Saki, Tsuku, Hori, Michi) are AI. When you use the AI Tutor, your question and the learning context needed to answer it are sent through our servers to AI model providers (via OpenRouter) to generate the reply. When AI planning features are switched on, what is sent is a short <em>summary</em> of your Twin — never your raw history, and never a document you pasted, except the document you ask the Miner to work on, for that one request. We state this plainly because you deserve to know before it happens, and the stores require us to ask — features that send your data to AI say so at the moment you first use them.</p>
      </Section>

      <Section title="Notifications">
        <p>If you turn on Yobidashi calls or reminders, a push subscription (a technical address for your browser or device) is stored so the summons can reach you. It is used for your calls and reminders, and for nothing else — never for advertising.</p>
      </Section>

      <Section title="What we never do">
        <p>We never sell your data. We never share your Twin, your documents, or your sentences with other users. We never use your data to train shared models — patterns across many learners may be counted in anonymised totals (for example, “many learners at your stage miss the same listening pattern”) only when at least 10 learners are in the count, with no names, no text, and no examples.</p>
      </Section>

      <Section title="Your rights — see it, export it, delete it">
        <p><strong className="text-slate-100">See it:</strong> Your Fleet shows everything the app has learned about you, and you can correct it. <strong className="text-slate-100">Export it:</strong> one tap downloads all of your data on this device as a file. <strong className="text-slate-100">Delete it:</strong> <em>Delete My Account And Data</em> (in Your Fleet) exports first if you want, then wipes everything on this device and deletes your server account. Deleting only the fleet's memory (your Twin) is also offered, if you want a fresh start without losing your account. If anything here is ever unclear, ask us — that is what the contact below is for.</p>
      </Section>

      <Section title="Children">
        <p>{brand.name} is built for adults living, working, or preparing to live in Japan. It is not designed for children.</p>
      </Section>

      <Section title="Changes and contact">
        <p>If this policy changes in a way that matters, the app will say so plainly, in the app, before the change applies to you. Questions, corrections, or a deletion request you would rather make by email: <span className="text-slate-100">{CONTACT}</span> <span className="text-amber-300">(address to be confirmed before public launch)</span>.</p>
      </Section>

      <div className="flex flex-wrap gap-2 pt-2">
        <button onClick={() => setActive?.('terms')} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium">Terms Of Use</button>
        <button onClick={() => setActive?.('twin')} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium">Your Fleet — See, Export Or Delete Your Data</button>
        <button onClick={() => setActive?.('dashboard')} className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold">Back To Today</button>
      </div>
    </div>
  )
}
