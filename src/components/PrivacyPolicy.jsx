import { brand } from '../lib/brand.js'

// Privacy Policy — drafted from Doc 10 (Security & Privacy) facts,
// extended 2026-11-22 with the Heard Words listening facts verified
// in src/lib/useAutoListen.js and src/lib/heardMatch.js (issue #14).
// (Doc 15 §1: Apple 5.1.1(i) requires this policy linked in store
// metadata AND easily accessible in-app — this page is the in-app half).
const CONTACT = 'yonde@bleepx.dev'

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
        <p className="text-sm text-slate-400 mt-1">{brand.name} — {brand.tagline}. Last updated 22 November 2026.</p>
      </div>

      <Section title="The short version">
        <p>{brand.name} learns how you learn. Almost everything it knows about you lives <strong className="text-slate-100">on your own device</strong>. We do not sell your data, we do not show you ads, and we do not keep recordings of your voice. You can see everything your fleet knows about you, export it, or delete it — inside the app, whenever you want. And if you use Heard Words listening, it keeps the words it recognises, never the conversations: no recording or transcript of anyone's speech is kept, as the listening section below explains.</p>
      </Section>

      <Section title="What lives on your device">
        <p>Your Learner Twin (your levels by section, your error patterns, how you like to learn), your review queue, your problem profile, your diagnosis results and history, your Yobidashi call settings and call history, Saki's plans, Michi's letters, and your answers to “did that feel like studying?” — all of this is stored in this app on this device. Open <em>My Twin</em> to inspect it in plain language.</p>
      </Section>

      <Section title="What an account adds">
        <p>If you create an account, your email address and your learning progress are stored with our hosting provider (Supabase) so they can follow you across devices. Every server table is protected so that your account can only ever read its own rows. If you never create an account, nothing in this section applies to you.</p>
      </Section>

      <Section title="Your voice">
        <p>When you speak in a scene or a Yobidashi call, your browser's speech recognition turns your voice into text. That text — your version of the sentence — is what gets corrected, and it is kept on your device as part of your learning record. <strong className="text-slate-100">We do not record or store audio of your voice.</strong> Depending on your browser, its speech service may process audio on the browser maker's servers; your browser's own privacy policy covers that part.</p>
      </Section>

      <Section title="Automatic listening — Heard Words">
        <p>Heard Words is an optional listening mode. You start it yourself, its state is shown on screen while it runs, it works only while the app is in front of you, and you can stop it at any moment. A session also stops by itself after four hours.</p>
        <p>On most devices, listening works like this: the app sends short clips of sound, about fifteen seconds each, to our server, where a transcription service (Groq) turns them into text and the text is matched against a general Japanese dictionary. <strong className="text-slate-100">The clip and its transcript are deleted the moment the matching finishes.</strong></p>
        <p>Where that recorder is not available, your browser's own speech recognition turns the sound into text and the matching happens on your device instead. The recognised text is dropped the moment it is matched, and only word counts ever leave your device.</p>
        <p>In the Telegram bot, listening works the same way: a stretch of sound you send is matched, the voice message is deleted from the chat, and the transcript is discarded.</p>
        <p><strong className="text-slate-100">What is kept:</strong> the dictionary words that were matched, how many times each one was heard, and the day. No audio. No transcript. No record of who was speaking. Anything that is not a general dictionary word — a name, a number, a company — cannot be kept at all, because the matcher does not know it. That is not a setting you have to trust us to keep; it is how the matcher is built.</p>
        <p>When listening starts, stops, or runs into a problem, the app also sends a small technical note about the event (for example, that the microphone was refused). These notes carry flags and counts only, never sound and never words, and they exist so that failures can be found and fixed.</p>
        <p>{brand.name} keeps no recording of the people around you, and nothing they said can be reconstructed from word counts. You are still the one listening in that room, so use the mode where listening is welcome — the Terms carry a short section on listening responsibly.</p>
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
        <p><strong className="text-slate-100">See it:</strong> My Twin shows everything the app has learned about you, and you can correct it. <strong className="text-slate-100">Export it:</strong> one tap downloads all of your data on this device as a file. <strong className="text-slate-100">Delete it:</strong> <em>Delete My Account And Data</em> (in My Twin) exports first if you want, then wipes everything on this device and deletes your server account. Deleting only the fleet's memory (your Twin) is also offered, if you want a fresh start without losing your account. If anything here is ever unclear, ask us — that is what the contact below is for.</p>
      </Section>

      <Section title="Children">
        <p>{brand.name} is built for adults living, working, or preparing to live in Japan. It is not designed for children.</p>
      </Section>

      <Section title="Changes and contact">
        <p>If this policy changes in a way that matters, the app will say so plainly, in the app, before the change applies to you. Questions, corrections, or a deletion request you would rather make by email: <span className="text-slate-100">{CONTACT}</span>.</p>
      </Section>

      <div className="flex flex-wrap gap-2 pt-2">
        <button onClick={() => setActive?.('terms')} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium">Terms Of Use</button>
        <button onClick={() => setActive?.('twin')} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium">My Twin — See, Export Or Delete Your Data</button>
        <button onClick={() => setActive?.('dashboard')} className="px-4 py-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-semibold">Back To Today</button>
      </div>
    </div>
  )
}
