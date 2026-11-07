// Neural call-voice tests (run: TZ=UTC npm run test:tts)
// Pins for Doc 17's free-route decision (2026-11-06): the tts edge
// function's request contract (validateTtsText in
// supabase/functions/tts/voice.ts) and the client's pre-send mirror
// (src/lib/neuralText.js) must agree — a text the server would 400
// never leaves the device, and a text the client sends is one the
// server accepts. Synthesis itself is a live-service call and is NOT
// exercised here; its contract (null on any failure) is the caller's
// fallback trigger, pinned by code review of voice.ts.
//
// The browser-direct route (src/lib/edgeTts.js, Doc 17 amendment
// 2026-11-06 late) is pinned the same way: pure protocol parts
// (Sec-MS-GEC, SSML, framing, frame parsing) against known values,
// and the socket driver against a fake WebSocket — never a live one.

import assert from 'node:assert'

const server = await import('../supabase/functions/tts/voice.ts')
const client = await import('../src/lib/neuralText.js')
const edge = await import('../src/lib/edgeTts.js')

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`  ok ${name}`) }
const acheck = async (name, fn) => { await fn(); passed++; console.log(`  ok ${name}`) }

check('server cap is 600 chars and the client mirror agrees', () => {
  assert.equal(server.MAX_TTS_CHARS, 600)
  assert.equal(client.NEURAL_TTS_MAX_CHARS, server.MAX_TTS_CHARS)
})

check('validateTtsText: a normal line is accepted, trimmed', () => {
  const v = server.validateTtsText('  こんにちは、元気ですか。 ')
  assert.equal(v.ok, true)
  assert.equal(v.text, 'こんにちは、元気ですか。')
})

check('validateTtsText: empty, whitespace-only, and non-strings are rejected', () => {
  assert.equal(server.validateTtsText('').reason, 'empty')
  assert.equal(server.validateTtsText('   ').reason, 'empty')
  assert.equal(server.validateTtsText(null).reason, 'not_text')
  assert.equal(server.validateTtsText(undefined).reason, 'not_text')
  assert.equal(server.validateTtsText(42).reason, 'not_text')
  assert.equal(server.validateTtsText({ text: 'x' }).reason, 'not_text')
})

check('validateTtsText: exactly at the cap passes, one char over is too_long', () => {
  assert.equal(server.validateTtsText('あ'.repeat(600)).ok, true)
  const over = server.validateTtsText('あ'.repeat(601))
  assert.equal(over.ok, false)
  assert.equal(over.reason, 'too_long')
})

check('prepareNeuralText: mirrors the server — same accept/reject line', () => {
  assert.equal(client.prepareNeuralText(' こんにちは。 '), 'こんにちは。')
  assert.equal(client.prepareNeuralText(''), null)
  assert.equal(client.prepareNeuralText('   '), null)
  assert.equal(client.prepareNeuralText(null), null)
  assert.equal(client.prepareNeuralText(42), null)
  assert.equal(client.prepareNeuralText('あ'.repeat(600)), 'あ'.repeat(600))
  assert.equal(client.prepareNeuralText('あ'.repeat(601)), null)
  // Cross-check the twins on a mixed sample: client sends ⇔ server accepts.
  for (const t of ['短い文。', 'x'.repeat(599), 'y'.repeat(601), '  ', '普通の文です。']) {
    assert.equal(client.prepareNeuralText(t) !== null, server.validateTtsText(t).ok, `twin mismatch for ${JSON.stringify(t.slice(0, 12))}`)
  }
})

check('estimateSpeechMs: grows with length, shrinks with rate, guards bad rates', () => {
  const short = client.estimateSpeechMs('短い。', 1)
  const long = client.estimateSpeechMs('あ'.repeat(100), 1)
  assert.ok(long > short)
  assert.ok(client.estimateSpeechMs('あ'.repeat(100), 2) < long)
  assert.equal(client.estimateSpeechMs('あ'.repeat(100), 0), long) // rate 0 → treated as 1
  assert.equal(client.estimateSpeechMs('あ'.repeat(100), -1), long)
  assert.equal(client.estimateSpeechMs(null), 1200) // empty text → base estimate only
})

// --- Browser-direct Edge TTS (src/lib/edgeTts.js) -------------------

check('edgeTts: windowsTicks + GEC input rounding to the 300s boundary', () => {
  const token = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
  assert.equal(edge.windowsTicks(0), 116444736000000000n)
  // The epoch instant sits exactly on a boundary; 1s later rounds back to it.
  assert.equal(edge.buildGecInput(0), `116444736000000000${token}`)
  assert.equal(edge.buildGecInput(1000), `116444736000000000${token}`)
  // 300s later is exactly the next boundary.
  assert.equal(edge.buildGecInput(300000), `116444739000000000${token}`)
})

await acheck('edgeTts: Sec-MS-GEC matches the known SHA-256 vector', async () => {
  // SHA-256("116444736000000000" + trusted client token), uppercase hex.
  assert.equal(
    await edge.computeSecMsGec(0),
    '7ECB79D14E3AA576D2D79E6D487A1388156D91E614B1BE11C64226A29BC8DD8C',
  )
  assert.notEqual(await edge.computeSecMsGec(300000), await edge.computeSecMsGec(0))
  assert.equal(await edge.computeSecMsGec(0, null), null) // no SubtleCrypto → no GEC
})

check('edgeTts: escapeXml escapes the five specials, leaves Japanese alone', () => {
  assert.equal(edge.escapeXml(`a & b <c> "d" 'e'`), 'a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;')
  assert.equal(edge.escapeXml('こんにちは、元気ですか。'), 'こんにちは、元気ですか。')
  assert.equal(edge.escapeXml('&lt;'), '&amp;lt;') // ampersand first, no double-escape loophole
})

check('edgeTts: SSML carries the Nanami voice and the escaped line', () => {
  const ssml = edge.buildSsml('魚 & 肉')
  assert.ok(ssml.includes('xml:lang="ja-JP"'))
  assert.ok(ssml.includes('<voice name="ja-JP-NanamiNeural">'))
  assert.ok(ssml.includes('<prosody pitch="+0Hz" rate="+0%">魚 &amp; 肉</prosody>'))
})

check('edgeTts: the two text frames match the wire format', () => {
  const config = edge.buildSpeechConfigFrame('Thu, 01 Jan 1970 00:00:00 GMT')
  assert.ok(config.startsWith('X-Timestamp:Thu, 01 Jan 1970 00:00:00 GMT\r\n'))
  assert.ok(config.includes('Path:speech.config\r\n\r\n'))
  assert.ok(config.includes('"outputFormat":"ogg-24khz-16bit-mono-opus"'))
  const ssml = edge.buildSsmlFrame('テスト。', { stamp: 'S', requestId: 'abc123' })
  assert.ok(ssml.startsWith('X-RequestId:abc123\r\n'))
  assert.ok(ssml.includes('Content-Type:application/ssml+xml\r\n'))
  assert.ok(ssml.includes('Path:ssml\r\n\r\n'))
  assert.ok(ssml.includes('テスト。'))
})

const audioFrame = (payload, path = 'Path:audio') => {
  const header = new TextEncoder().encode(`${path}\r\nContent-Type:audio/ogg; codecs=opus\r\n\r\n`)
  const frame = new Uint8Array(2 + header.length + payload.length)
  frame[0] = (header.length >> 8) & 0xff
  frame[1] = header.length & 0xff
  frame.set(header, 2)
  frame.set(payload, 2 + header.length)
  return frame
}

check('edgeTts: parseAudioFrame extracts audio, rejects everything else', () => {
  assert.deepEqual([...edge.parseAudioFrame(audioFrame([9, 8, 7]))], [9, 8, 7])
  assert.deepEqual([...edge.parseAudioFrame(audioFrame([1]).buffer)], [1]) // ArrayBuffer input
  assert.equal(edge.parseAudioFrame(audioFrame([9], 'Path:response')), null)
  assert.equal(edge.parseAudioFrame(new Uint8Array([5])), null) // truncated
  assert.equal(edge.parseAudioFrame(new Uint8Array([0xff, 0xff, 1, 2])), null) // header overrun
  assert.equal(edge.parseAudioFrame('a string'), null)
  assert.equal(edge.isTurnEnd('X-RequestId:x\r\nPath:turn.end\r\n\r\n'), true)
  assert.equal(edge.isTurnEnd('Path:turn.start'), false)
})

// A fake socket: 'answer' replies to the ssml frame with one audio
// frame + turn.end; 'silent' never replies. No live service is touched.
class FakeSocket {
  static instances = []
  static mode = 'answer'
  constructor(url) {
    this.url = url
    this.sent = []
    this.closed = false
    FakeSocket.instances.push(this)
    queueMicrotask(() => { if (!this.closed && this.onopen) this.onopen() })
  }
  send(frame) {
    this.sent.push(frame)
    if (FakeSocket.mode === 'answer' && frame.includes('Path:ssml')) {
      queueMicrotask(() => {
        this.onmessage?.({ data: audioFrame([9, 8, 7]).buffer })
        this.onmessage?.({ data: 'X-RequestId:x\r\nPath:turn.end\r\n\r\n' })
      })
    }
  }
  close() {
    this.closed = true
    queueMicrotask(() => this.onclose?.())
  }
}

await acheck('edgeTts: synthesizeInBrowser assembles a Blob from a fake socket', async () => {
  FakeSocket.instances = []
  FakeSocket.mode = 'answer'
  const blob = await edge.synthesizeInBrowser('テストです。', { WebSocketImpl: FakeSocket })
  assert.ok(blob instanceof Blob)
  assert.equal(blob.type, 'audio/ogg')
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [9, 8, 7])
  const ws = FakeSocket.instances[0]
  assert.match(ws.url, /Sec-MS-GEC=[0-9A-F]{64}/)
  assert.ok(ws.url.includes('TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4'))
  assert.equal(ws.sent.length, 2)
  assert.ok(ws.sent[0].includes('Path:speech.config'))
  assert.ok(ws.sent[1].includes('Path:ssml'))
})

await acheck('edgeTts: empty text and missing WebSocket resolve null, never throw', async () => {
  assert.equal(await edge.synthesizeInBrowser(''), null)
  assert.equal(await edge.synthesizeInBrowser('   '), null)
  assert.equal(await edge.synthesizeInBrowser(null), null)
  assert.equal(await edge.synthesizeInBrowser('テスト。', { WebSocketImpl: null }), null)
})

await acheck('edgeTts: a silent socket times out to null and is closed', async () => {
  FakeSocket.instances = []
  FakeSocket.mode = 'silent'
  const blob = await edge.synthesizeInBrowser('テスト。', { WebSocketImpl: FakeSocket, timeoutMs: 40 })
  assert.equal(blob, null)
  assert.equal(FakeSocket.instances[0].closed, true)
})

await acheck('edgeTts: cancelBrowserSynthesis aborts an in-flight synthesis', async () => {
  FakeSocket.instances = []
  FakeSocket.mode = 'silent'
  const pending = edge.synthesizeInBrowser('テスト。', { WebSocketImpl: FakeSocket, timeoutMs: 60000 })
  await new Promise((r) => setTimeout(r, 10)) // let the socket open
  assert.equal(FakeSocket.instances.length, 1)
  edge.cancelBrowserSynthesis()
  assert.equal(await pending, null)
  assert.equal(FakeSocket.instances[0].closed, true)
})

// ---------- TtsButton rides the neural chain (2026-11-07) ----------
// Landry: the scene/model lines are what a learner listens to and
// repeats — the device voice alone was "unnatural, difficult to
// listen and repeat". The button must go through neuralVoice's
// chain (Edge Nanami -> tts function -> device), with the honest
// no-Japanese-voice label fed by the onFallback report.
{
  const { readFileSync } = await import('node:fs')
  const btn = readFileSync(new URL('../src/components/TtsButton.jsx', import.meta.url), 'utf8')
  const nv = readFileSync(new URL('../src/lib/neuralVoice.js', import.meta.url), 'utf8')
  check('TtsButton speaks via the neural chain, not the device voice directly', () => {
    assert.ok(btn.includes("from '../lib/neuralVoice.js'"), 'imports neuralVoice')
    assert.ok(btn.includes('speakSenseiLine(text, {'), 'calls speakSenseiLine')
    assert.ok(!btn.includes('speakText(text'), 'no direct speakText call remains')
    assert.ok(btn.includes('onFallback'), 'keeps the honest fallback label wired')
    assert.ok(nv.includes('onFallback(res)'), 'neuralVoice reports the device result')
  })
}

// ---------- One Session scene flow: fewer taps (2026-11-07) ----------
// Landry: "too much taps — more automatic." A spoken attempt
// checks itself when the transcript lands, the model line plays
// on its own below mastery, and Say It Again restarts the mic in
// the same tap. Each removed round is also one less webview
// microphone prompt (iOS re-asks per recognition round in the
// Telegram webview — the app cannot hold the grant, so it asks
// as rarely as the flow allows).
{
  const { readFileSync } = await import('node:fs')
  const os = readFileSync(new URL('../src/components/OneSession.jsx', import.meta.url), 'utf8')
  check('OneSession: spoken attempts auto-check, model auto-plays, retry is one tap', () => {
    assert.ok(os.includes('if (transcript.trim()) checkScene(transcript)'), 'transcript auto-checks')
    assert.ok(os.includes('speakSenseiLine(scene.model,'), 'model line auto-plays below mastery')
    assert.ok(os.includes("setLastAttempt(null); startListening()"), 'Say It Again restarts listening in one tap')
  })
}

// ---------- voice casts (Landry, 2026-11-07) ----------
{
  const vc = await import('../src/lib/voiceCast.js')
  check('casts resolve to Edge voices: Nanami female, Keita male, pitch lifts for girl/boy', () => {
    assert.equal(vc.resolveCast('female').edge, 'ja-JP-NanamiNeural')
    assert.equal(vc.resolveCast('male').edge, 'ja-JP-KeitaNeural')
    assert.equal(vc.resolveCast('girl').edge, 'ja-JP-NanamiNeural')
    assert.notEqual(vc.resolveCast('girl').pitch, '+0Hz')
    assert.equal(vc.resolveCast('boy').edge, 'ja-JP-KeitaNeural')
    assert.notEqual(vc.resolveCast('boy').pitch, '+0Hz')
    assert.equal(vc.resolveCast('nope').edge, 'ja-JP-NanamiNeural', 'unknown falls back')
    assert.equal(server.resolveTtsCast('male').edge, 'ja-JP-KeitaNeural', 'server twin agrees')
    assert.equal(server.resolveTtsCast('girl').pitch, vc.resolveCast('girl').pitch, 'server pitch agrees')
  })

  check('speaker labels map to casts; dialogue scripts parse into unlabelled turns', () => {
    assert.equal(vc.castForSpeaker('女'), 'female')
    assert.equal(vc.castForSpeaker('男'), 'male')
    assert.equal(vc.castForSpeaker('店長'), 'male')
    assert.equal(vc.castForSpeaker('女の子'), 'girl')
    assert.equal(vc.castForSpeaker('男の子'), 'boy')
    const turns = vc.parseScriptTurns('店員：いらっしゃいませ。\n客：すみません、おにぎりはどこですか。\n店員：あちらの棚です。')
    assert.equal(turns.length, 3)
    assert.equal(turns[0].cast, 'male')
    assert.equal(turns[0].text, 'いらっしゃいませ。')
    assert.ok(!turns.some((t) => t.text.includes('：')), 'labels are never spoken')
    const convo = vc.parseScriptTurns('男：夏休み、北海道へ旅行しない？\n女：いいね。飛行機と電車、どっちがいいかな。')
    assert.deepEqual(convo.map((t) => t.cast), ['male', 'female'])
    assert.equal(vc.parseScriptTurns('ただの文章です。'), null, 'plain text is not a dialogue')
    assert.equal(vc.parseScriptTurns('女：一行だけ。'), null, 'one labelled line is not a dialogue')
  })

  const { readFileSync } = await import('node:fs')
  const scenesSrc = readFileSync(new URL('../src/data/scenes.js', import.meta.url), 'utf8')
  const btnSrc = readFileSync(new URL('../src/components/TtsButton.jsx', import.meta.url), 'utf8')
  check('scene partners carry casts; TtsButton plays turns and honours the model cast', () => {
    const scenes = scenesSrc
    const tags = scenes.match(/partnerVoice: '(female|male|girl|boy)'/g) || []
    assert.ok(tags.length >= 22, `every scene tagged (got ${tags.length})`)
    const btn = btnSrc
    assert.ok(btn.includes('parseScriptTurns(text)'), 'button detects dialogues')
    assert.ok(btn.includes('speakTurns(turns'), 'button plays turns')
    assert.ok(btn.includes('cast || modelCast()'), 'single lines use the chosen model voice')
  })
}

// ---------- Yobidashi pacing + ringing discipline (2026-11-07) ----------
// Landry's live reports: the call "feels rushed" (a recognition
// segment boundary ended his turn mid-answer), saving settings
// rang every already-past slot in turn, and the sensei name
// field could not be deleted. The fixes are structural; pin
// their shapes here.
{
  const { readFileSync } = await import('node:fs')
  const call = readFileSync(new URL('../src/components/SenseiCall.jsx', import.meta.url), 'utf8')
  check('the call waits for a real silence gap, not a segment boundary', () => {
    assert.ok(call.includes('SILENCE_GAP_MS = 2600'), 'silence gap constant')
    assert.ok(call.includes('turn.text += finalText'), 'segments accumulate')
    assert.ok(call.includes('turn.restarts >= 10'), 'recogniser relaunches inside one turn, capped')
    assert.ok(call.includes('beginUserTurn(), 900'), 'a beat before the mic opens')
  })
  check('one catch-up ring per day; the name field edits freely', () => {
    assert.ok(call.includes('catchupRung: true'), 'catch-up marked on the day')
    assert.ok(call.includes("status: 'skipped' } : x"), 'later past slots skip quietly')
    assert.ok(!call.includes("senseiName: e.target.value || 'Sensei'"), 'no mid-typing snap-back')
    assert.ok(call.includes("trim() || 'Sensei'"), 'default applies at save')
  })
}

// ---------- Stale-chunk rescue + file delivery (2026-11-07) ----------
// Two of Landry's live hits: a view tap right after a deploy
// showed the crash screen (old bundle, dead chunk URL — a
// reload fixed it), and the Anki progress move navigated the
// whole Mini App to a raw JSON dump (an <a download> click
// inside the Telegram webview). Both fixes are structural.
{
  const { readFileSync } = await import('node:fs')
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const anki = readFileSync(new URL('../src/components/Anki.jsx', import.meta.url), 'utf8')
  check('lazy views reload once on a stale chunk instead of crashing', () => {
    assert.ok(app.includes('lazyView'), 'wrapper exists')
    assert.ok((app.match(/= lazyView\(\(\) => import\(/g) || []).length >= 15, 'all views wrapped')
    assert.ok(app.includes('yonde:chunkReloadAt'), 'reload is rate-limited')
  })
  check('file delivery never navigates the app to a blob', () => {
    assert.ok(!anki.includes("a.download = 'yonde-anki-backup.json'"), 'backup anchor download gone')
    assert.ok(!anki.includes("a.download = 'yonde-anki-cards.csv'"), 'csv anchor download gone')
    assert.ok(anki.includes('deliverTextFile'), 'both exports use the safe delivery')
    assert.ok(anki.includes('backupStashed: true'), 'the record claims the stash, not a download')
  })
}

// ---------- Dictionary speaks the reading (2026-11-07) ----------
// Landry: the dictionary's speaker "says other words than the
// kanji written" — it was fed the kanji surface, so the engine
// chose its own reading (明日 -> あした even on the あす entry).
// The entry's reading is the only correct thing to speak.
{
  const { readFileSync } = await import('node:fs')
  const dict = readFileSync(new URL('../src/components/DictionaryView.jsx', import.meta.url), 'utf8')
  check('the dictionary speaker is fed the entry reading', () => {
    assert.ok(dict.includes('text={e.reading || e.word}'), 'reading first, surface as fallback')
    assert.ok(!dict.includes('text={e.word}'), 'bare surface never spoken')
  })
}

console.log(`\ntts: ${passed} checks passed`)
