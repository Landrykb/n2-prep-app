// Reader-bot copy catalogs (Doc 16 §5 amendment #11).
//
// The bot deliberately does NOT import the web app's catalogs:
// Deno edge functions and the Vite app are different module worlds.
// This file is the bot's own single source of truth for furniture
// copy. Learning content — passage text, topics, dictionary
// readings and meanings — is data and is never translated here.
//
// Language resolution is read-only and storage-free: the app owns
// the choice in learner_state.state.language = { lang, at }, and
// the bot reads that slice from the linked user's existing row.

export type BotLang = 'en' | 'fr' | 'ja'

export const BOT_LANGS: BotLang[] = ['en', 'fr', 'ja']

const en: Record<string, string> = {
  'app.openYonde': 'Open Yonde',
  'app.openReader': '📖 Open in Yonde — tap the words',
  'app.reply': 'Your whole Yonde is one tap away — sessions, the checkup, Koe\'s calls, and your queue live in the app. This chat stays your reading shelf.',
  'again.noLongerFits': 'That one no longer fits your words — your set has moved since it was sent. Let me find what fits today:',
  'again.sending': 'Sending it again ✓',
  'checkup.switch': '\nThe checkup is the switch here: take the 10-minute checkup in Yonde, and I can fit to your level, not just your queue.',
  'common.notLinkedToast': 'This chat is not linked to a Yonde account.',
  'common.saveFailedToast': 'That did not save on my side — try again.',
  'feedback.alreadyNoted': 'Already noted ✓',
  'feedback.apology': '🔍 Sorry — I got ahead of myself with that one.',
  'feedback.closing': 'We are back at the level that fits you, and it will harden again gradually — a little stretch at a time, never a leap.',
  'feedback.explainCandidates': 'What was in it — the new words that made it a stretch:\n{lines}',
  'feedback.explainFallback': 'It ran ahead of the words you know — that one is on me, not on you.',
  'feedback.explainUnmet': 'What was in it — the words in it that have not crossed your queue yet:\n{lines}',
  'feedback.logged': 'Logged ✓',
  'feedback.pushMax': 'Already at full stretch',
  'feedback.pushing': '🔥 Pushing you',
  'feedback.stepBack': 'Stepping back to your level',
  'footer.checkupLine': '\nYour checkup in Yonde sharpens this whenever you want it.',
  'footer.declared': 'Fitted to the {band} you told me and your queue: about {pct}% of its words should already be familiar (an estimate) · {words}',
  'footer.declaredJoke': 'Fitted from the very beginning — your N7+ 😂 tap — and your queue: about {pct}% of its words should already be familiar (an estimate) · {words}',
  'footer.defaultBandLine': '\nBand N4 is a gentle default — take the 10-minute checkup in Yonde and I will fit to your real level.',
  'footer.diagnosis': 'Fitted to your {band} level and your queue: about {pct}% of its words should already be familiar (an estimate) · {words}',
  'footer.foundationsLine': '\nFrom the bases, at an easy pace — we climb when your reads get comfortable, a little slower than usual.',
  'footer.newKanjiMany': '\n{count} kanji here are new to you — they\'re in the readings block, and they\'ll keep coming back until they\'re yours.',
  'footer.newKanjiOne': '\n1 kanji here is new to you — it is in the readings block, and it will keep coming back until it is yours.',
  'footer.newWordOne': '{count} new word',
  'footer.newWordsMany': '{count} new words',
  'footer.queue': 'Fitted to your queue: about {pct}% of its words should already be familiar (an estimate) · {words}',
  'footer.recycled': '\nThis one practises the batch you are learning now — the same words again, in new sentences, until they are yours.',
  'footer.stepGentler': '\nKeeping it a notch gentler than {band} while it settles.',
  'footer.stepStretch': '\nStretching you a little past {band} today — Push Me works both ways: Too Hard brings us back.',
  'help': 'Here is what I do:\n/read — a passage fitted to your words\n/app — open Yonde: sessions, the checkup, Koe\'s calls\n/level — tell me your level in one tap\n/unlink — disconnect this chat\n🎙 Voice read: after a passage, hold the microphone button, read it out loud, and let go to send — I listen and answer with your reading match.\nReading when you feel like it is the whole design — no streaks, no nagging.',
  'level.ask': '🔍 One thing first — I do not know your level yet, and I fit every passage to it.\nTap yours and reading starts now. No forms, no homework: this tap is just where we start, and your checkup in Yonde is the sharper measure whenever you want it.',
  'level.bandToast': '{band} — got it.',
  'level.introDeclared': 'You told me {band} — that is the level I fit to. Tap to change it, or take the checkup in Yonde for the sharper measure.',
  'level.introDeclaredJoke': 'You told me N7+ 😂 — I read that as: start me at the very beginning, at an easy pace. Tap to change it, or take the checkup in Yonde for the sharper measure.',
  'level.introDiagnosis': 'Your checkup put you at {band}, and a checkup always outranks a tap — I fit to it. If that feels wrong, a fresh checkup in Yonde is the way to change it. A tap below only sets your starting level for if no checkup were on file.',
  'level.n7Toast': 'N7+ 😂 — noted',
  'level.noneToast': 'No problem — we start easy.',
  'level.notSure': 'Not sure',
  'link.explainer': '🔍 Hori here — I run Yonde Reader. This chat is not linked yet.\nOpen Yonde → <b>Fleet</b> → <b>Yonde Reader on Telegram</b> → <b>Connect Telegram</b>, then tap the link there. It takes ten seconds, and then /read works here.',
  'link.expired': 'That link has expired or was already used. In Yonde → Fleet → Yonde Reader on Telegram, tap Connect Telegram for a fresh one.',
  'link.failed': 'Linking failed on my side — try the fresh link from the app once more.',
  'mine.addedMany': '⛏ {count} words joined your review queue — they will surface in your sessions, with this passage\'s sentence on the card.',
  'mine.addedOne': '⛏ {count} word joined your review queue — they will surface in your sessions, with this passage\'s sentence on the card.',
  'mine.cardNote': 'From Hori\'s Reader passage: 「{sentence}」',
  'mine.failedToast': 'Mining failed on my side — try again.',
  'mine.nothingNew': 'Nothing new to mine — you already know, or have already queued, every bolded word in that passage.',
  'mine.nothingSynced': 'There is nothing synced to mine into yet — open Yonde signed in once so your queue exists here, then tap Mine again.',
  'mine.nothingSyncedToast': 'Nothing synced yet.',
  'mine.passageGone': 'That passage is no longer on the shelf.',
  'mine.toastMany': 'Mined {count} words.',
  'mine.toastNone': 'Nothing new to mine.',
  'mine.toastOne': 'Mined {count} word.',
  'morning.greeting': '🔍 おはよう — morning. Here is today\'s passage, fitted to your words.',
  'n7.jokeReply': 'N7+ 😂 — the legendary level: below the test, above giving up.\nDeal — we start at the very beginning. Every N1 alive started below N5.\nAnd I will slow my steps down — bases first: it takes double the comfortable reads before I dare to stretch you.',
  'nofit.base': 'Nothing on the shelf fits your words today — every passage in reach runs ahead of them, and I would rather send nothing than the wrong level.',
  'nofit.forward': '\nThe nearest way forward: a study session in Yonde — new words change the fit — then /read again.',
  'nofit.generated': ' I also tried writing a fresh one for you just now, and my writer could not manage it this time.',
  'nofit.noSyncedWords': 'I do not have your synced words yet, so I cannot fit a passage to you. Open Yonde signed in once — your queue syncs on its own — then send /read again.',
  'nofit.readAgainButton': 'Read It Again',
  'nofit.recent': 'One passage does fit your words — 「{topic}」 — but you read it in the last two weeks, and I hold recent reads back so /read stays fresh.\nIt is yours again whenever you want it: tap below. And a study session in Yonde grows your words, so fresh fits follow.',
  'passage.defaultTopic': 'Reading',
  'passage.header': '🔍 Hori dug this up for you — {topic} · {band}',
  'passage.mineButton': 'Mine the New Words',
  'passage.pushMe': 'Push Me 🔥',
  'passage.readIt': 'Read It ✓',
  'passage.readingsHeader': '📖 <b>Kanji readings</b> — tap to open',
  'passage.tooHard': 'Too Hard',
  'shelf.empty': 'The reading shelf is empty on my side right now — try again a little later.',
  'starter.footer': 'A starter, not a fitted pick — I do not know your level yet, so this one is from the easy shelf, with the new words kept few. Mine any words you like: every mined word teaches me what you know. Take the 10-minute checkup in Yonde and fitting switches on — from then on, every passage is measured against your words before it is sent.',
  'start.basisDeclared': 'I fit your reading to the {band} you told me.',
  'start.basisDeclaredJoke': 'You told me N7+ 😂 — so we are building from the very beginning, at an easy pace.',
  'start.basisDiagnosis': 'I fit your reading to your checkup level, {band}.',
  'start.basisNone': 'You have not told me your level yet — /level asks in one tap.',
  'start.sendPassage': 'Send Me a Passage',
  'start.status': '🔍 Hori here — this chat IS linked to your Yonde.\n{basis}\nSend /read any time for a passage at your level. Everything you mine lands in your one review queue in Yonde.',
  'trialUp': '🔍 {streakWord} comfortable reads in a row — that level is properly yours now. The next passage stretches a little past it; that is the fit hardening, one notch at a time. If it overshoots, Too Hard brings us straight back.',
  'trialUp.six': 'Six',
  'trialUp.three': 'Three',
  'unlink.done': 'Unlinked. This chat will not receive Yonde Reader messages. Your queue and everything you mined stay in Yonde, untouched.',
  'unlink.notLinked': 'This chat is not linked to a Yonde account, so there was nothing to unlink.',
  'voice.durationLong': '🔍 That ran long for this passage — a reading that long is usually the passage twice, or a pause in the middle. Once through, out loud, at your own pace is the receipt I can count.',
  'voice.durationPlausible': '🔍 Heard you — that is a real read, proven out loud, and it counts here as one. What I cannot do yet is score it word by word: that arrives when transcription joins. Until then, your voice is the receipt — and the fit treats it exactly like one.',
  'voice.durationQuick': '🔍 That was quick for this passage — shorter than a read-aloud of it runs. Read it aloud once through, then hold the microphone and send another voice note — your voice is the receipt.',
  'voice.fix': '\n\nNao\'s one fix — the first new word your voice skipped: {word}{readingSuffix}{meaningSuffix}.\nIt lives in this sentence: 「{sentence}」 — say that sentence once more, with the word in it.',
  'voice.instruction': '🎙 <b>Read it out loud:</b> hold the microphone button below, read the whole passage, and let go to send — I listen and answer with your reading match.',
  'voice.matchBelow': '🔍 Heard you — reading match: {pct}% of the passage text your voice covered. That is a match against the text, not a pronunciation grade. It sits under the line where a read counts as comfortable, so nothing is marked — reads here only ever add up, never against you. Read it once more when you feel like it — hold the microphone and send another voice note whenever you\'re ready.',
  'voice.matchPass': '🔍 Heard you — reading match: {pct}% of the passage text your voice covered. That is a match against the text, not a pronunciation grade — and at that level it counts here as a comfortable read, proven out loud.',
  'voice.noPassage': '🔍 No passage from me in the last day to read back — send /read first, then read the passage aloud back to me. Your voice is the receipt.',
  'voice.passageGone': '🔍 That passage is no longer on my shelf, so I cannot take your reading of it — send /read and read the new one aloud back to me.',
  'welcome': '🔍 Linked — Hori here, your Miner in Yonde.\nSend /read any time and I will dig up a short passage fitted to the words you actually know. New words come <b>bold</b>, and one tap mines them into your review queue.\nNo streaks, no nagging — reading when you feel like it is the whole design.',
}

const fr: Record<string, string> = {
  'app.openYonde': 'Ouvrir Yonde',
  'app.openReader': '📖 Ouvrir dans Yonde — toucher les mots',
  'app.reply': 'Tout ton Yonde est à un toucher — les séances, le bilan, les appels de Koe et ta file vivent dans l\'app. Ce chat reste ton étagère de lecture.',
  'again.noLongerFits': 'Celui-ci ne correspond plus à tes mots — ton ensemble a évolué depuis son envoi. Laisse-moi trouver ce qui te correspond aujourd\'hui :',
  'again.sending': 'Je le renvoie ✓',
  'checkup.switch': '\nLe bilan est l\'interrupteur ici : fais le bilan de 10 minutes dans Yonde, et je pourrai m\'ajuster à ton niveau, pas seulement à ta file.',
  'common.notLinkedToast': 'Ce chat n\'est pas relié à un compte Yonde.',
  'common.saveFailedToast': 'Ça ne s\'est pas enregistré de mon côté — réessaie.',
  'feedback.alreadyNoted': 'Déjà noté ✓',
  'feedback.apology': '🔍 Pardon — je suis allé trop loin avec celui-là.',
  'feedback.closing': 'On est revenu au niveau qui te correspond, et il se renforcera de nouveau petit à petit — un léger étirement à la fois, jamais un saut.',
  'feedback.explainCandidates': 'Ce qu\'il contenait — les mots nouveaux qui le rendaient difficile :\n{lines}',
  'feedback.explainFallback': 'Ça allait plus loin que les mots que tu connais — c\'est ma faute, pas la tienne.',
  'feedback.explainUnmet': 'Ce qu\'il contenait — les mots qui ne sont pas encore passés par ta file :\n{lines}',
  'feedback.logged': 'Enregistré ✓',
  'feedback.pushMax': 'Déjà au maximum de l\'étirement',
  'feedback.pushing': '🔥 Je te pousse',
  'feedback.stepBack': 'Retour à ton niveau',
  'footer.checkupLine': '\nTon bilan dans Yonde précisera cela quand tu le voudras.',
  'footer.declared': 'Ajusté au {band} que tu m\'as indiqué et à ta file : environ {pct}% de ses mots devraient déjà t\'être familiers (une estimation) · {words}',
  'footer.declaredJoke': 'Ajusté depuis le tout début — ton toucher N7+ 😂 — et ta file : environ {pct}% de ses mots devraient déjà t\'être familiers (une estimation) · {words}',
  'footer.defaultBandLine': '\nLe niveau N4 est un point de départ doux — fais le bilan de 10 minutes dans Yonde et je m\'ajusterai à ton vrai niveau.',
  'footer.diagnosis': 'Ajusté à ton niveau {band} et à ta file : environ {pct}% de ses mots devraient déjà t\'être familiers (une estimation) · {words}',
  'footer.foundationsLine': '\nDepuis les bases, à un rythme facile — on montera quand tes lectures deviendront confortables, un peu plus lentement que d\'habitude.',
  'footer.newKanjiMany': '\n{count} kanji ici sont nouveaux pour toi — ils sont dans le bloc des lectures, et ils reviendront jusqu\'à ce qu\'ils soient à toi.',
  'footer.newKanjiOne': '\n1 kanji ici est nouveau pour toi — il est dans le bloc des lectures, et il reviendra jusqu\'à ce qu\'il soit à toi.',
  'footer.newWordOne': '{count} nouveau mot',
  'footer.newWordsMany': '{count} nouveaux mots',
  'footer.queue': 'Ajusté à ta file : environ {pct}% de ses mots devraient déjà t\'être familiers (une estimation) · {words}',
  'footer.recycled': '\nCelui-ci entraîne le lot que tu apprends en ce moment — les mêmes mots, dans de nouvelles phrases, jusqu\'à ce qu\'ils soient à toi.',
  'footer.stepGentler': '\nOn reste un cran plus doux que {band} pendant que ça se stabilise.',
  'footer.stepStretch': '\nAujourd\'hui, je te pousse un peu au-delà de {band} — Push Me fonctionne dans les deux sens : Too Hard nous ramène.',
  'help': 'Voici ce que je fais :\n/read — un texte ajusté à tes mots\n/app — ouvrir Yonde : séances, bilan et appels de Koe\n/level — me dire ton niveau en un toucher\n/unlink — déconnecter ce chat\n🎙 Lecture à voix haute : après un texte, maintiens le bouton microphone, lis-le à voix haute, puis relâche pour envoyer — j\'écoute et je te réponds avec ta correspondance de lecture.\nLire quand tu en as envie, c\'est tout le principe — ni séries ni rappels insistants.',
  'level.ask': '🔍 Une chose d\'abord — je ne connais pas encore ton niveau, et j\'ajuste chaque texte en fonction de lui.\nTouche le tien et la lecture commence tout de suite. Ni formulaire ni devoir : ce toucher est simplement notre point de départ, et ton bilan dans Yonde restera la mesure la plus précise quand tu le voudras.',
  'level.bandToast': '{band} — compris.',
  'level.introDeclared': 'Tu m\'as dit {band} — c\'est le niveau auquel je m\'ajuste. Touche pour changer, ou fais le bilan dans Yonde pour une mesure plus précise.',
  'level.introDeclaredJoke': 'Tu m\'as dit N7+ 😂 — je comprends : pars du tout début, à un rythme facile. Touche pour changer, ou fais le bilan dans Yonde pour une mesure plus précise.',
  'level.introDiagnosis': 'Ton bilan t\'a placé en {band}, et un bilan passe toujours avant un toucher — je m\'ajuste à lui. Si ça te semble faux, un nouveau bilan dans Yonde est le moyen de le changer. Un toucher ci-dessous définit seulement ton niveau de départ, au cas où aucun bilan ne serait enregistré.',
  'level.n7Toast': 'N7+ 😂 — noté',
  'level.noneToast': 'Pas de problème — on commence facile.',
  'level.notSure': 'Je ne sais pas',
  'link.explainer': '🔍 C\'est Hori — je m\'occupe de Yonde Reader. Ce chat n\'est pas encore relié.\nOuvre Yonde → <b>Fleet</b> → <b>Yonde Reader on Telegram</b> → <b>Connect Telegram</b>, puis touche le lien affiché là. Ça prend dix secondes, et ensuite /read fonctionne ici.',
  'link.expired': 'Ce lien a expiré ou a déjà été utilisé. Dans Yonde → Fleet → Yonde Reader on Telegram, touche Connect Telegram pour en obtenir un nouveau.',
  'link.failed': 'La liaison a échoué de mon côté — réessaie avec le lien frais depuis l\'app.',
  'mine.addedMany': '⛏ {count} mots ont rejoint ta file de révision — ils apparaîtront dans tes séances, avec la phrase de ce texte sur la carte.',
  'mine.addedOne': '⛏ {count} mot a rejoint ta file de révision — il apparaîtra dans tes séances, avec la phrase de ce texte sur la carte.',
  'mine.cardNote': 'Depuis un texte du Reader de Hori : 「{sentence}」',
  'mine.failedToast': 'Le minage a échoué de mon côté — réessaie.',
  'mine.nothingNew': 'Rien de nouveau à miner — tu connais déjà, ou tu as déjà mis en file, chaque mot en gras de ce texte.',
  'mine.nothingSynced': 'Il n\'y a encore rien de synchronisé dans quoi miner — ouvre Yonde en étant connecté une fois pour que ta file existe ici, puis touche Mine à nouveau.',
  'mine.nothingSyncedToast': 'Rien n\'est encore synchronisé.',
  'mine.passageGone': 'Ce texte n\'est plus sur l\'étagère.',
  'mine.toastMany': 'Miné {count} mots.',
  'mine.toastNone': 'Rien de nouveau à miner.',
  'mine.toastOne': 'Miné {count} mot.',
  'morning.greeting': '🔍 おはよう — bonjour. Voici le texte du jour, ajusté à tes mots.',
  'n7.jokeReply': 'N7+ 😂 — le niveau légendaire : en dessous du test, au-dessus de l\'abandon.\nD\'accord — on commence tout au début. Tous les N1 vivants ont commencé en dessous du N5.\nEt je ralentirai mes pas — les bases d\'abord : il faudra deux fois plus de lectures confortables avant que j\'ose te faire progresser.',
  'nofit.base': 'Rien sur l\'étagère ne correspond à tes mots aujourd\'hui — chaque texte à portée va plus loin qu\'eux, et je préfère ne rien envoyer plutôt qu\'envoyer le mauvais niveau.',
  'nofit.forward': '\nLa voie la plus proche : une séance d\'étude dans Yonde — de nouveaux mots changent l\'ajustement — puis /read à nouveau.',
  'nofit.generated': ' J\'ai aussi essayé d\'en écrire un nouveau pour toi à l\'instant, et mon auteur n\'y est pas arrivé cette fois.',
  'nofit.noSyncedWords': 'Je n\'ai pas encore tes mots synchronisés, donc je ne peux pas t\'ajuster un texte. Ouvre Yonde en étant connecté une fois — ta file se synchronise toute seule — puis renvoie /read.',
  'nofit.readAgainButton': 'Le Relire',
  'nofit.recent': 'Un texte correspond bien à tes mots — 「{topic}」 — mais tu l\'as lu au cours des deux dernières semaines, et je retiens les lectures récentes pour que /read reste frais.\nIl est de nouveau à toi quand tu le veux : touche ci-dessous. Et une séance d\'étude dans Yonde enrichit tes mots, alors de nouveaux ajustements suivront.',
  'passage.defaultTopic': 'Lecture',
  'passage.header': '🔍 Hori a déniché ceci pour toi — {topic} · {band}',
  'passage.mineButton': 'Miner Les Mots Nouveaux',
  'passage.pushMe': 'Pousse-moi 🔥',
  'passage.readIt': 'Lu ✓',
  'passage.readingsHeader': '📖 <b>Lectures des kanji</b> — toucher pour ouvrir',
  'passage.tooHard': 'Trop Dur',
  'shelf.empty': 'L\'étagère de lecture est vide de mon côté pour le moment — réessaie un peu plus tard.',
  'starter.footer': 'Un texte de départ, pas un choix ajusté — je ne connais pas encore ton niveau, alors celui-ci vient de l\'étagère facile, avec peu de mots nouveaux. Mine les mots que tu veux : chaque mot miné m\'apprend ce que tu connais. Fais le bilan de 10 minutes dans Yonde et l\'ajustement s\'activera — ensuite, chaque texte sera mesuré contre tes mots avant d\'être envoyé.',
  'start.basisDeclared': 'J\'ajuste tes lectures au {band} que tu m\'as indiqué.',
  'start.basisDeclaredJoke': 'Tu m\'as dit N7+ 😂 — alors on construit depuis le tout début, à un rythme facile.',
  'start.basisDiagnosis': 'J\'ajuste tes lectures à ton niveau de bilan, {band}.',
  'start.basisNone': 'Tu ne m\'as pas encore dit ton niveau — /level te le demande en un toucher.',
  'start.sendPassage': 'Envoie-moi un texte',
  'start.status': '🔍 C\'est Hori — ce chat EST relié à ton Yonde.\n{basis}\nEnvoie /read quand tu veux pour un texte à ton niveau. Tout ce que tu mines arrive dans ta seule file de révision dans Yonde.',
  'trialUp': '🔍 {streakWord} lectures confortables d\'affilée — ce niveau est vraiment le tien maintenant. Le prochain texte ira un peu plus loin ; c\'est l\'ajustement qui se renforce, un cran à la fois. Si ça va trop loin, Too Hard nous ramène tout de suite.',
  'trialUp.six': 'Six',
  'trialUp.three': 'Trois',
  'unlink.done': 'Délié. Ce chat ne recevra plus de messages de Yonde Reader. Ta file et tout ce que tu as miné restent dans Yonde, intacts.',
  'unlink.notLinked': 'Ce chat n\'est relié à aucun compte Yonde, donc il n\'y avait rien à délier.',
  'voice.durationLong': '🔍 C\'était long pour ce texte — une lecture aussi longue, c\'est souvent le texte deux fois, ou une pause au milieu. Une fois, à voix haute, à ton rythme, c\'est la preuve que je peux compter.',
  'voice.durationPlausible': '🔍 Je t\'ai entendu — c\'est une vraie lecture, prouvée à voix haute, et elle compte ici. Ce que je ne peux pas encore faire, c\'est la noter mot à mot : cela arrivera quand la transcription nous rejoindra. Jusque-là, ta voix est la preuve — et l\'ajustement la traite exactement comme telle.',
  'voice.durationQuick': '🔍 C\'était rapide pour ce texte — plus court qu\'une lecture à voix haute. Lis-le une fois à voix haute, puis maintiens le microphone et envoie un autre message vocal — ta voix est la preuve.',
  'voice.fix': '\n\nLe seul correctif de Nao — le premier mot nouveau que ta voix a sauté : {word}{readingSuffix}{meaningSuffix}.\nIl se trouve dans cette phrase : 「{sentence}」 — redis cette phrase une fois, avec le mot dedans.',
  'voice.instruction': '🎙 <b>Lis-le à voix haute :</b> maintiens le bouton microphone ci-dessous, lis tout le texte, puis relâche pour envoyer — j\'écoute et je te réponds avec ta correspondance de lecture.',
  'voice.matchBelow': '🔍 Je t\'ai entendu — correspondance de lecture : {pct}% du texte que ta voix a couvert. C\'est une correspondance avec le texte, pas une note de prononciation. Cela reste sous le seuil où une lecture compte comme confortable, donc rien n\'est marqué — ici, les lectures ne font que s\'ajouter, jamais contre toi. Relis-le une fois de plus quand tu en as envie — maintiens le microphone et envoie un autre message vocal quand tu es prêt.',
  'voice.matchPass': '🔍 Je t\'ai entendu — correspondance de lecture : {pct}% du texte que ta voix a couvert. C\'est une correspondance avec le texte, pas une note de prononciation — et à ce niveau, cela compte ici comme une lecture confortable, prouvée à voix haute.',
  'voice.noPassage': '🔍 Je n\'ai aucun texte de moi au cours du dernier jour à me relire — envoie d\'abord /read, puis relis le texte à voix haute. Ta voix est la preuve.',
  'voice.passageGone': '🔍 Ce texte n\'est plus sur mon étagère, donc je ne peux pas recevoir ta lecture — envoie /read et relis le nouveau à voix haute.',
  'welcome': '🔍 C\'est relié — Hori, ton Mineur dans Yonde.\nEnvoie /read quand tu veux et je dénicherai un court texte ajusté aux mots que tu connais vraiment. Les mots nouveaux arrivent en <b>gras</b>, et un toucher suffit pour les miner dans ta file de révision.\nNi séries ni rappels insistants — lire quand tu en as envie, c\'est tout le principe.',
}

const ja: Record<string, string> = {
  'app.openYonde': 'Yondeを開く',
  'app.openReader': '📖 Yondeで開く — 単語をタップ',
  'app.reply': 'Yonde全体はタップ1つ先にあります — セッション、チェックアップ、Koeの電話、キューはアプリの中にあります。このチャットは、あなたの読書棚のままです。',
  'again.noLongerFits': 'そのテキストは、もうあなたの単語に合いません — 送ったあとに、あなたの語彙が進みました。今日合うものを探します：',
  'again.sending': 'もう一度送ります ✓',
  'checkup.switch': '\nここで必要なのはチェックアップです。Yondeで10分のチェックアップを受けると、キューだけでなく、あなたのレベルにも合わせられます。',
  'common.notLinkedToast': 'このチャットはYondeアカウントと連携されていません。',
  'common.saveFailedToast': '私の側で保存できませんでした — もう一度試してください。',
  'feedback.alreadyNoted': 'すでにメモ済みです ✓',
  'feedback.apology': '🔍 ごめんなさい — あれは先へ行き過ぎました。',
  'feedback.closing': '合うレベルに戻りました。また少しずつ強くなります — 一度に少しだけ先へ、大きく跳ぶことはありません。',
  'feedback.explainCandidates': '中身はこれでした — 難しくしていた新しい単語です：\n{lines}',
  'feedback.explainFallback': 'あなたの知っている単語より先へ進んでいました — それはあなたのせいではなく、私のせいです。',
  'feedback.explainUnmet': '中身はこれでした — まだあなたのキューを通っていない単語です：\n{lines}',
  'feedback.logged': '記録しました ✓',
  'feedback.pushMax': 'すでに最大まで進んでいます',
  'feedback.pushing': '🔥 先へ進めます',
  'feedback.stepBack': 'あなたのレベルに戻します',
  'footer.checkupLine': '\nYondeのチェックアップで、いつでもこれをもっと正確にできます。',
  'footer.declared': 'あなたが教えてくれた{band}と、あなたのキューに合わせました： 単語の約{pct}%は、すでに知っているはずです（推定） · {words}',
  'footer.declaredJoke': 'いちばん最初から — あなたのN7+ 😂のタップから — と、あなたのキューに合わせました： 単語の約{pct}%は、すでに知っているはずです（推定） · {words}',
  'footer.defaultBandLine': '\nN4はやさしい初期値です — Yondeで10分のチェックアップを受けると、本当のレベルに合わせます。',
  'footer.diagnosis': 'あなたの{band}レベルとキューに合わせました： 単語の約{pct}%は、すでに知っているはずです（推定） · {words}',
  'footer.foundationsLine': '\n基礎から、やさしいペースで — 読みが無理なくできるようになったら、普段より少しゆっくり上がっていきます。',
  'footer.newKanjiMany': '\nここに、あなたにとって新しい漢字が{count}つあります — 読み方のブロックにあり、あなたのものになるまで何度も戻ってきます。',
  'footer.newKanjiOne': '\nここに、あなたにとって新しい漢字が1つあります — 読み方のブロックにあり、あなたのものになるまで何度も戻ってきます。',
  'footer.newWordOne': '{count}つの新しい単語',
  'footer.newWordsMany': '{count}つの新しい単語',
  'footer.queue': 'あなたのキューに合わせました： 単語の約{pct}%は、すでに知っているはずです（推定） · {words}',
  'footer.recycled': '\nこれは、今学んでいるまとまりの練習です — 同じ単語を、新しい文の中で、あなたのものになるまで。',
  'footer.stepGentler': '\n落ち着くまで、{band}より1段階やさしく保ちます。',
  'footer.stepStretch': '\n今日は{band}より少し先へ進みます — Push Meは双方向です： Too Hardで戻ります。',
  'help': 'できることはこれです。\n/read — あなたの単語に合わせたテキスト\n/app — Yondeを開く：セッション、チェックアップ、Koeの電話\n/level — タップ1つでレベルを伝える\n/unlink — このチャットの連携を切る\n🎙 音声で読む：テキストのあと、マイクボタンを長押しして全文を声に出して読み、離して送ってください。聞き取って、読み取りの一致度を返します。\n読みたいときに読むのがすべてです。連続記録も催促もありません。',
  'level.ask': '🔍 まず1つだけ — あなたのレベルがまだ分かりません。すべてのテキストを、そのレベルに合わせて選んでいます。\nあなたのレベルをタップすると、すぐに読み始められます。フォームも宿題もありません。このタップが始める場所で、もっと正確な測定がほしいときは、Yondeのチェックアップがいつでも使えます。',
  'level.bandToast': '{band} — 了解です。',
  'level.introDeclared': 'あなたは{band}と教えてくれました — それが、私が合わせるレベルです。変更するにはタップしてください。もっと正確な測定には、Yondeのチェックアップを使ってください。',
  'level.introDeclaredJoke': 'あなたはN7+ 😂と教えてくれました — いちばん最初から、やさしいペースで、という意味だと受け取りました。変更するにはタップしてください。もっと正確な測定には、Yondeのチェックアップを使ってください。',
  'level.introDiagnosis': 'チェックアップでは{band}でした。チェックアップはタップより優先されるので、それに合わせます。違うと感じる場合は、Yondeで新しいチェックアップを受けるのが変更方法です。下のタップは、チェックアップが記録にない場合の開始レベルだけを設定します。',
  'level.n7Toast': 'N7+ 😂 — メモしました',
  'level.noneToast': '大丈夫です — やさしく始めましょう。',
  'level.notSure': 'わからない',
  'link.explainer': '🔍 Horiです。Yonde Readerを担当しています。このチャットはまだ連携されていません。\nYondeを開いて、<b>Fleet</b> → <b>Yonde Reader on Telegram</b> → <b>Connect Telegram</b> の順に進み、そこにあるリンクをタップしてください。10秒で終わります。そのあと、ここで /read が使えます。',
  'link.expired': 'そのリンクは期限切れか、使用済みです。Yonde → Fleet → Yonde Reader on Telegram で Connect Telegram をタップし、新しいリンクを取得してください。',
  'link.failed': '私の側で連携に失敗しました — アプリからの新しいリンクでもう一度試してください。',
  'mine.addedMany': '⛏ {count}つの単語が復習キューに入りました — セッションで出てきて、カードにはこのテキストの文が載ります。',
  'mine.addedOne': '⛏ {count}つの単語が復習キューに入りました — セッションで出てきて、カードにはこのテキストの文が載ります。',
  'mine.cardNote': 'HoriのReaderのテキストから： 「{sentence}」',
  'mine.failedToast': '私の側で取り込みに失敗しました — もう一度試してください。',
  'mine.nothingNew': '新しく取り込むものはありません — このテキストの太字の単語はすべて、すでに知っているか、すでにキューに入っています。',
  'mine.nothingSynced': 'まだ、取り込む先になる同期済みのものがありません — ログインした状態でYondeを一度開くと、ここにキューができ、そのあとでもう一度Mineをタップしてください。',
  'mine.nothingSyncedToast': 'まだ何も同期されていません。',
  'mine.passageGone': 'そのテキストは、もう棚にありません。',
  'mine.toastMany': '{count}つの単語を取り込みました。',
  'mine.toastNone': '新しく取り込むものはありません。',
  'mine.toastOne': '{count}つの単語を取り込みました。',
  'morning.greeting': '🔍 おはようございます。今日のテキストです。あなたの単語に合わせてあります。',
  'n7.jokeReply': 'N7+ 😂 — 伝説のレベルです。テストより下、でもあきらめるより上。\nいいですよ — いちばん最初から始めましょう。生きているN1の全員が、N5より下から始めたのです。\nそして、歩幅はゆっくりにします。基礎を先に： 慣れた読みが通常の2倍たまるまで、次の段階へは進みません。',
  'nofit.base': '今日、あなたの単語に合うものは棚にありません。手の届くテキストはすべて、あなたの単語より先へ進んでいます。間違ったレベルを送るくらいなら、何も送らない方がいいのです。',
  'nofit.forward': '\nいちばん近い進み方はこれです。Yondeで学習セッションをして — 新しい単語が合うものを変えます — そのあと、もう一度 /read を送ってください。',
  'nofit.generated': ' さらに、今あなたのために新しいものを書こうとしましたが、今回は書き手がうまく書けませんでした。',
  'nofit.noSyncedWords': 'まだ同期された単語がないので、あなたに合わせたテキストを選べません。ログインした状態でYondeを一度開いてください — キューは自動で同期します — そのあと、もう一度 /read を送ってください。',
  'nofit.readAgainButton': 'もう一度読む',
  'nofit.recent': 'あなたの単語に合うテキストが1つあります — 「{topic}」 — ただし、この2週間以内に読んだものです。/read を新しく保つため、最近の読みは控えています。\nほしいときはいつでも、またあなたのものです。下をタップしてください。そして、Yondeで学習セッションをすると単語が増え、新しく合うものが続きます。',
  'passage.defaultTopic': '読書',
  'passage.header': '🔍 Horiが見つけてきました — {topic} · {band}',
  'passage.mineButton': '新しい単語を取り込む',
  'passage.pushMe': 'もっと難しく 🔥',
  'passage.readIt': '読んだ ✓',
  'passage.readingsHeader': '📖 <b>漢字の読み方</b> — タップで開く',
  'passage.tooHard': '難しすぎる',
  'shelf.empty': '今、私の側では読書棚が空です — 少しあとでもう一度試してください。',
  'starter.footer': 'これは合わせた選択ではなく、入門用です。まだレベルが分からないので、やさしい棚から選び、新しい単語は少なくしてあります。好きな単語を取り込んでください。取り込んだ単語1つ1つが、あなたの知っていることを私に教えてくれます。Yondeで10分のチェックアップを受けると、合わせる機能が有効になります。それ以降、すべてのテキストは送る前にあなたの単語と照合されます。',
  'start.basisDeclared': '読み物は、あなたが教えてくれた{band}に合わせています。',
  'start.basisDeclaredJoke': 'あなたはN7+ 😂と教えてくれました — だから、いちばん最初から、やさしいペースで積み上げています。',
  'start.basisDiagnosis': '読み物は、チェックアップのレベル{band}に合わせています。',
  'start.basisNone': 'まだレベルを聞いていません — /level ならタップ1つで聞けます。',
  'start.sendPassage': 'テキストを送って',
  'start.status': '🔍 Horiです — このチャットはあなたのYondeと連携されています。\n{basis}\nあなたのレベルに合ったテキストがほしいときは、いつでも /read を送ってください。取り込んだものはすべて、Yondeの1つの復習キューに入ります。',
  'trialUp': '🔍 {streakWord}回続けて無理なく読めました — そのレベルは、もうしっかりあなたのものです。次のテキストは少しだけ先へ進みます。合わせ方が、1段階ずつ強くなっているのです。行き過ぎたら、Too Hardですぐに戻ります。',
  'trialUp.six': '6',
  'trialUp.three': '3',
  'unlink.done': '連携を切りました。このチャットにYonde Readerのメッセージは届きません。キューと、取り込んだものはすべて、Yondeの中にそのまま残ります。',
  'unlink.notLinked': 'このチャットはYondeアカウントと連携されていないので、切るものはありませんでした。',
  'voice.durationLong': '🔍 このテキストにしては長かったです — それだけ長い読みは、たいていテキストを2回読んだか、途中で止まったかです。声に出して、自分のペースで1回通して読むのが、私が数えられる証拠です。',
  'voice.durationPlausible': '🔍 聞こえました — 本物の読みです。声に出して証明できて、ここでは1回として数えます。まだ単語ごとに採点はできません： それは文字起こしが加わってからです。それまでは、あなたの声が証拠です — そして合わせ方も、まさにその通りに扱います。',
  'voice.durationQuick': '🔍 このテキストにしては速かったです — 声に出して読む速さより短いです。声に出して1回通して読み、そのあとマイクを長押しして別の音声メモを送ってください — あなたの声が証拠です。',
  'voice.fix': '\n\nNaoの直すところは1つ — あなたの声が飛ばした最初の新しい単語です： {word}{readingSuffix}{meaningSuffix}。\nこの文の中にあります： 「{sentence}」 — その単語を入れて、その文をもう一度言ってください。',
  'voice.instruction': '🎙 <b>声に出して読んでください：</b> 下のマイクボタンを長押しして、テキスト全文を読み、離して送ってください。聞き取って、読み取りの一致度を返します。',
  'voice.matchBelow': '🔍 聞こえました — 読み取りの一致度： あなたの声がカバーしたのは、テキストの{pct}%です。これはテキストとの一致で、発音の採点ではありません。無理なく読めたと数える線より下なので、何も記録されません — ここでは、読みは積み上がるだけで、あなたに不利になることは決してありません。気が向いたらもう一度読んでください — マイクを長押しして、準備ができたら別の音声メモを送ってください。',
  'voice.matchPass': '🔍 聞こえました — 読み取りの一致度： あなたの声がカバーしたのは、テキストの{pct}%です。これはテキストとの一致で、発音の採点ではありません — そしてこの水準なら、ここでは無理なく読めたこととして数えます。声に出して証明できました。',
  'voice.noPassage': '🔍 この1日で、私から読んでもらうテキストがありません — まず /read を送り、そのテキストを声に出して読んでください。あなたの声が証拠です。',
  'voice.passageGone': '🔍 そのテキストはもう棚にないので、その読みを受けることができません — /read を送り、新しいものを声に出して読んでください。',
  'welcome': '🔍 連携できました — YondeのMiner、Horiです。\n/read を送ると、あなたが実際に知っている単語に合わせた短いテキストを探します。新しい単語は<b>太字</b>で届き、タップ1つで復習キューに入ります。\n連続記録も催促もありません。読みたいときに読むのが、この仕組みのすべてです。',
}

export const BOT_CATALOGS: Record<BotLang, Record<string, string>> = { en, fr, ja }

export function normalizeBotLang(value: unknown): BotLang {
  return value === 'fr' || value === 'ja' || value === 'en' ? value : 'en'
}

export function languageFromState(state: unknown): BotLang {
  if (!state || typeof state !== 'object') return 'en'
  const language = (state as Record<string, unknown>).language
  if (!language || typeof language !== 'object') return 'en'
  return normalizeBotLang((language as Record<string, unknown>).lang)
}

export function languageFromStateRow(row: unknown): BotLang {
  if (!row || typeof row !== 'object') return 'en'
  return languageFromState((row as Record<string, unknown>).state)
}

export function bt(lang: unknown, key: string, vars: Record<string, unknown> = {}): string {
  const resolved = normalizeBotLang(lang)
  const template = BOT_CATALOGS[resolved][key] ?? BOT_CATALOGS.en[key] ?? key
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = vars[name]
    return value === null || value === undefined ? '' : String(value)
  })
}

export function botNewWordsLabel(lang: unknown, count: number): string {
  return bt(lang, count === 1 ? 'footer.newWordOne' : 'footer.newWordsMany', { count })
}

export function botLevelIntro(
  lang: unknown,
  source: string,
  band: string | null,
  joke = false,
): string {
  if (source === 'diagnosis') return bt(lang, 'level.introDiagnosis', { band: band ?? '' })
  if (source === 'declared' && joke) return bt(lang, 'level.introDeclaredJoke')
  if (source === 'declared') return bt(lang, 'level.introDeclared', { band: band ?? '' })
  return bt(lang, 'level.ask')
}

export function botTrialUpCopy(lang: unknown, target?: number | null): string {
  return bt(lang, 'trialUp', {
    streakWord: bt(lang, target === 6 ? 'trialUp.six' : 'trialUp.three'),
  })
}

export function botFittedFooter(
  lang: unknown,
  opts: {
    bandSource: string
    band: string
    pct: number
    newWordCount: number
    joke?: boolean
    fitStep?: number
    basisBand?: string | null
    newKanjiCount?: number
    recycledBatch?: boolean
  },
): string {
  const words = botNewWordsLabel(lang, opts.newWordCount)
  const vars = { band: opts.band, pct: opts.pct, words }
  let out = opts.bandSource === 'diagnosis'
    ? bt(lang, 'footer.diagnosis', vars)
    : opts.bandSource === 'declared' && opts.joke
      ? bt(lang, 'footer.declaredJoke', vars) + bt(lang, 'footer.foundationsLine')
      : opts.bandSource === 'declared'
        ? bt(lang, 'footer.declared', vars) + bt(lang, 'footer.checkupLine')
        : bt(lang, 'footer.queue', vars) + bt(lang, 'footer.defaultBandLine')

  const fitStep = opts.fitStep ?? 0
  if (fitStep !== 0) {
    out += bt(lang, fitStep > 0 ? 'footer.stepStretch' : 'footer.stepGentler', {
      band: opts.basisBand ?? opts.band,
    })
  }

  const newKanjiCount = opts.newKanjiCount ?? 0
  if (newKanjiCount === 1) out += bt(lang, 'footer.newKanjiOne')
  else if (newKanjiCount > 1) out += bt(lang, 'footer.newKanjiMany', { count: newKanjiCount })
  if (opts.recycledBatch) out += bt(lang, 'footer.recycled')
  return out
}
