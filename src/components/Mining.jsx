import { useEffect, useMemo, useState} from 'react'
import { Pickaxe, Plus, CheckCircle2} from 'lucide-react'
import { loadDictionary, localDictionary} from '../lib/dictionary.js'
import { addToQueue, loadQueue} from '../lib/queue.js'

// Sentence mining from YOUR life: paste a real email, school letter, meeting
// agenda or notice. The app finds dictionary words inside it and builds i+1
// cards — one sentence, one target word — into the ONE review queue.
// Text never leaves the browser.
export function splitSentences(text) {
return (text || '')
.split(/(?<=[。！？!?])|\n+/)
.map((s) => s.trim())
.filter((s) => s.length >= 4)
}

export function mineText(dict, text, { maxPerSentence = 1} = {}) {
const sentences = splitSentences(text)
const cards = []
for (const sentence of sentences) {
// Longest-first dictionary matching, same index the dictionary view uses.
const found = []
for (const entry of dict.byLength) {
if (entry.word.length < 2) continue
if (found.length >= maxPerSentence) break
if (sentence.includes(entry.word) &&!found.some((f) => f.word === entry.word)) found.push(entry)
}
for (const entry of found) {
cards.push({
sentence,
word: entry.word,
reading: entry.reading || '',
meaning: entry.meaning || '',
level: entry.level || '',
front: sentence.replace(entry.word, ``),
back: `${entry.word}${entry.reading? `（${entry.reading}）`: ''} — ${entry.meaning} · in your sentence: ${sentence}`,
})
}
}
return cards
}

const SAMPLE = '来週の月曜日までに、昨年度の課税証明書と在留カードのコピーを市役所に提出してください。なお、窓口の受付時間は午前8時半から午後5時までとなっております。ご不明な点がございましたら、担当までお問い合わせください。'

export default function Mining() {
const [dict, setDict] = useState(localDictionary)
const [text, setText] = useState('')
const [cards, setCards] = useState([])
const [selected, setSelected] = useState(new Set())
const [note, setNote] = useState('')
const [queueCount, setQueueCount] = useState(() => loadQueue().length)

useEffect(() => { loadDictionary().then(setDict)}, [])

const mined = useMemo(() => cards, [cards])

const runMine = () => {
const found = mineText(dict, text)
setCards(found)
setSelected(new Set(found.map((_, i) => i)))
setNote(found.length? '': 'No dictionary words found in that text yet. Try a longer, real document — emails and official letters mine best.')
}

const toggle = (i) => setSelected((cur) => { const s = new Set(cur); s.has(i)? s.delete(i): s.add(i); return s})

const addSelected = () => {
const items = [...selected].map((i) => mined[i]).filter(Boolean).map((c) => ({
front: c.front, back: c.back, reading: c.reading, source: 'mining', level: c.level,
note: `Mined from your own text. Target: ${c.word}.`,
}))
const { added, queue} = addToQueue(items)
setQueueCount(queue.length)
setNote(added? `Added ${added} card${added === 1? '': 's'} to your review queue — they will surface in Today and Anki-queue reviews, spaced by FSRS.`: 'Those cards are already in your queue.')
}

return (
<div className="space-y-6">
<div>
<div className="flex items-center gap-2 mb-1"><Pickaxe size={20} className="text-violet-400" /><h2 className="text-2xl font-bold text-white">Mine your own Japanese</h2></div>
<p className="text-sm text-slate-400">Generic textbooks don’t contain your life. Paste a real work email, a school letter, a city-office notice — get i+1 cards (one new word per sentence) from the Japanese you actually have to survive. Processed locally in your browser; nothing is uploaded. Your queue currently holds {queueCount} personal cards.</p>
</div>

<div className="rounded-2xl glass p-5 card-glow space-y-3">
<textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder="Paste Japanese text here — an email, a letter from school, meeting minutes…"
className="w-full rounded-xl bg-bun-800 border border-bun-600/40 px-3 py-2.5 text-sm text-slate-100 leading-loose focus:border-violet-500 focus:outline-none" />
<div className="flex flex-wrap gap-2">
<button onClick={runMine} disabled={!text.trim()} className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-semibold">Mine this text</button>
<button onClick={() => setText(SAMPLE)} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-200 text-sm">Try a sample city-office notice</button>
</div>
{note && <p className="text-sm text-emerald-300 flex items-center gap-2"><CheckCircle2 size={15} /> {note}</p>}
</div>

{mined.length > 0 && (
<div className="space-y-3">
<div className="flex items-center justify-between gap-3">
<h3 className="text-lg font-bold text-white">{mined.length} i+1 cards found</h3>
<button onClick={addSelected} disabled={!selected.size} className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-semibold flex items-center gap-1.5"><Plus size={15} /> Add {selected.size} to my queue</button>
</div>
{mined.map((c, i) => (
<label key={i} className={`flex items-start gap-3 rounded-2xl border p-4 cursor-pointer transition ${selected.has(i)? 'bg-violet-600/10 border-violet-500/40': 'bg-bun-700/30 border-bun-600/20'}`}>
<input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} className="mt-1 accent-violet-500" />
<span>
<span className="block text-sm text-slate-100 leading-loose">{c.sentence}</span>
<span className="block text-xs text-slate-400 mt-1">Target: <span className="text-violet-300 font-semibold">{c.word}</span>{c.reading? `（${c.reading}）`: ''} — {c.meaning} {c.level && <span className="ml-1 px-1.5 py-0.5 rounded bg-bun-700 text-slate-300">{c.level}</span>}</span>
</span>
</label>
))}
</div>
)}
</div>
)
}
