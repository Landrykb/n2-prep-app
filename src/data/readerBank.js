// The graded-reader lane (Doc 16, bank growth — Landry's
// stuck-loop fix, 2026-11-11): passages WRITTEN for the bank,
// in mostly below-band vocabulary with a light at-band dose,
// on everyday-life-in-Japan topics. The original bank (scenes
// + mock passages) passed the 93–97% gate for only ~1 in 10
// learners and exactly ONE passage for the owner; this lane
// exists so fitted learners actually have a shelf. Each text
// is verified at build time by the audit harness against a
// real diagnosed-N2 known set (ratio in [0.94, 0.96]) — keep
// new-word occurrences few: every occurrence counts against
// the ratio, so a new word should appear once or twice, never
// as the passage's refrain.
export const gradedPassages = [
  {
    id: 'graded-station-lost',
    band: 'N2',
    topic: 'The station lost-and-found',
    text: '昨日、電車で傘を忘れました。家に帰ってから、忘れ物に気づきました。今朝、駅の窓口に行きました。「昨日、青い傘を忘れました」と言うと、係の人は紙を出して、「ここに名前と電話番号を書いてください」と言いました。しばらく待つと、係の人は笑顔で傘を持って来ました。「ほかの駅で見つかりました。忘れ物は三日間、駅で預かります」と言って、笑いました。「持ち主が見つかって、よかったですね」。私は何度もありがとうと言いました。大切な傘が戻ってきて、とても安心しました。窓口の人、ありがとうございました。',
  },
  {
    id: 'graded-pharmacy',
    band: 'N2',
    topic: 'At the pharmacy',
    text: '先週から、のどが痛くて、少し熱もありました。近くの薬局に行くと、そこの人が「いつからですか」と聞きました。「三日前からです。夜になると、せきも出ます」と答えました。その人は薬を選んで、「これは一日に三回、食後に飲んでください。水をたくさん飲んで、早く寝てくださいね」と言いました。二日飲むと、症状はだいぶ良くなって、のども楽になりました。',
  },
  {
    id: 'graded-new-neighbour',
    band: 'N2',
    topic: 'Greeting the new neighbour',
    text: '先月、この町に引っ越してきました。隣の家にあいさつに行くと、年配の女性が出てきました。「はじめまして。隣に引っ越してきました。これからよろしくお願いします」と言うと、女性は笑って、「こちらこそ。何か困ったことがあれば、遠慮なく言ってくださいね」と言いました。次の日、その女性が手作りのお菓子を持って来てくれました。新しい生活の始まりに、温かい気持ちになりました。',
  },
  {
    id: 'graded-dentist-change',
    band: 'N2',
    topic: 'Changing the dentist appointment',
    text: '歯医者の予約を変更したくて、電話をかけました。「すみません、来週の水曜日の予約を、金曜日に変えたいのですが」と言うと、受付の人は「金曜日なら、午後三時が空いています」と答えました。歯は時々痛みますが、ひどくはありません。受付の人は「痛みが強いときは、早く治療に来てください」と言いました。治療のとき、麻酔を使うかどうかも聞きました。電話の後、すぐにカレンダーに新しい日時を書きました。これでもう忘れません。',
  },
  {
    id: 'graded-city-hall',
    band: 'N2',
    topic: 'Paperwork at city hall',
    text: '住所が変わったので、市役所に行きました。窓口で「引っ越しの手続きをしたいです」と言うと、係の人が書類をくれました。名前と住所と生年月日を書いて、出しました。それから椅子に座って、二十分待ちました。やっと私の番になって、用事はすぐに終わりました。帰りに、新しい住所の証明書をもらいました。',
  },
  {
    id: 'graded-shopping-street',
    band: 'N2',
    topic: 'The shopping street',
    text: '私の家の近くに、市場のある通りがあります。野菜や魚やパンを売る店が並んでいて、夕方はいつもにぎやかです。野菜の店のおじさんは私の顔を覚えてくれて、「今日は大根が安いよ」と声をかけてくれます。買い物の後、公園で家族と買ったパンを食べるのが、私の楽しみです。この町の暮らしが、だんだん好きになってきました。',
  },
  {
    id: 'graded-seaside-town',
    band: 'N2',
    topic: 'A trip to the seaside',
    text: '先週の日曜日、初めて海辺の町に行きました。電車で一時間ぐらいです。駅から海まで歩くと、風がとても気持ちよくて、波の音が聞こえました。昼は小さい食堂で魚の定食を食べました。新しい経験でしたが、不思議と落ち着きました。夕方、帰りの電車の中から夕日を見ました。また行きたい町です。',
  },
]
