// BJT exam bank — original items written to the REAL BJT formats
// (official structure: kanken.or.jp BJT; reference anatomy in
// ~/workspace/jpn2easy/research/bjt-reference/ANATOMY.md).
//
// POOLS (Landry, 2026-11-08): every group is tagged pool: 'sealed' | 'practice'.
//  - practice: circulates in daily form practice and trainer surfaces.
//  - sealed: NEVER shown in practice, never used to generate variants.
//    A full exam assembled from the sealed pool is the proof paper —
//    passing questions you have never practised is the strong evidence.
// An item that has ever been practised can never become sealed.
//
// GROUP shape: { id, form, pool, level, domain, scene?, doc?, script?,
//   items: [{ prompt, options: [4 strings], answer: index, vocab: [headwords] }] }
// script: [{ who: 'A'|'B', text }] — spoken turns (A = male cast, B = female).
// For 'bamen' groups the 4 options ARE the spoken statements (the real test
// plays them; the scene card stands in for the photo — adapted format).

export const BJT_FORMS = {
  bamen:    { part: 1, name: '場面把握', en: 'Scene statements', count: 5 },
  hatsugen: { part: 1, name: '発言聴解', en: 'Right thing to say', count: 10 },
  sougouL:  { part: 1, name: '総合聴解', en: 'Dialogue comprehension', count: 10 },
  joukyou:  { part: 2, name: '状況把握', en: 'Situation statements', count: 5 },
  shiryou:  { part: 2, name: '資料聴読解', en: 'Document + listening', count: 10 },
  sougouLR: { part: 2, name: '総合聴読解', en: 'Document + dialogue', count: 10 },
  goi:      { part: 3, name: '語彙・文法', en: 'Vocabulary & grammar', count: 10 },
  hyougen:  { part: 3, name: '表現読解', en: 'Expression reading', count: 10 },
  sougouR:  { part: 3, name: '総合読解', en: 'Document reading', count: 10 },
}

export const BJT_PARTS = [
  { part: 1, name: '聴解', minutes: 45, forms: ['bamen', 'hatsugen', 'sougouL'] },
  { part: 2, name: '聴読解', minutes: 30, forms: ['joukyou', 'shiryou', 'sougouLR'] },
  { part: 3, name: '読解', minutes: 30, forms: ['goi', 'hyougen', 'sougouR'] },
]

export const bjtBank = [
  // ── Part 1 §1 場面把握 (sealed) — scene card + 4 spoken statements ──────
  {
    id: 'sb-bamen-1', form: 'bamen', pool: 'sealed', level: 'J3', domain: 'reception',
    scene: '受付の前で、スーツの男性が女性に小さな紙を渡しています。女性はそれを受け取って、笑顔で頭を下げています。',
    items: [{
      prompt: '場面の説明として正しいものはどれですか。',
      options: [
        '男の人が、女の人に名刺を渡しています。',
        '男の人が、女の人に契約書を渡しています。',
        '男の人が、女の人から名刺をもらっています。',
        '男の人が、女の人に資料を見せています。',
      ],
      answer: 0, vocab: ['名刺', '受付'],
    }],
  },
  {
    id: 'sb-bamen-2', form: 'bamen', pool: 'sealed', level: 'J3', domain: 'meeting',
    scene: '会議室で、女性がホワイトボードのグラフを指しながら話しています。5人の社員が椅子に座って聞いています。',
    items: [{
      prompt: '場面の説明として正しいものはどれですか。',
      options: [
        '女の人が、面接をしています。',
        '女の人が、プレゼンテーションをしています。',
        '女の人が、電話で話しています。',
        '女の人が、講演をしています。',
      ],
      answer: 1, vocab: ['会議室', '資料'],
    }],
  },
  {
    id: 'sb-bamen-3', form: 'bamen', pool: 'sealed', level: 'J2', domain: 'warehouse',
    scene: '倉庫で、作業着の男性が段ボール箱を台車に積んでいます。そばで別の男性がタブレットで数を確認しています。',
    items: [{
      prompt: '場面の説明として正しいものはどれですか。',
      options: [
        '男の人たちが、商品を販売しています。',
        '男の人たちが、品物を入荷しています。',
        '男の人たちが、在庫を確認しながら品物を運んでいます。',
        '男の人たちが、会議をしています。',
      ],
      answer: 2, vocab: ['在庫', '納品'],
    }],
  },
  {
    id: 'sb-bamen-4', form: 'bamen', pool: 'sealed', level: 'J3', domain: 'office',
    scene: 'オフィスで、若い男性社員が先輩の席のそばに立ち、書類を見せながら何か相談しています。先輩はうなずいています。',
    items: [{
      prompt: '場面の説明として正しいものはどれですか。',
      options: [
        '男の人が、上司に叱られています。',
        '男の人が、書類について相談しています。',
        '男の人が、契約書にサインしています。',
        '男の人が、商品を回収しています。',
      ],
      answer: 1, vocab: ['上司', '提出'],
    }],
  },
  {
    id: 'sb-bamen-5', form: 'bamen', pool: 'sealed', level: 'J2', domain: 'phone',
    scene: 'デスクで女性社員が電話を受けながら、メモを取り、時々うなずいて聞いています。机の上にはカレンダーが開かれています。',
    items: [{
      prompt: '場面の説明として正しいものはどれですか。',
      options: [
        '女の人が、電話を取り次いでいます。',
        '女の人が、電話で日程の相談を受けています。',
        '女の人が、電話をかけ直しています。',
        '女の人が、電話番号を調べています。',
      ],
      answer: 1, vocab: ['電話', '期日'],
    }],
  },

  // ── Part 1 §2 発言聴解 (sealed) — situation spoken, pick the right line ─
  {
    id: 'sb-hatsu-1', form: 'hatsugen', pool: 'sealed', level: 'J2', domain: 'phone',
    script: [{ who: 'B', text: '取引先の方から、同僚の佐藤あてに電話がありました。佐藤は今、別の会議に出ています。電話を受けたあなたは、相手に何と言いますか。' }],
    items: [{
      prompt: '何と言いますか。',
      options: [
        '申し訳ございません。佐藤はただいま会議中でございます。',
        'すみません。佐藤さんは今、会議をしています。',
        '申し訳ございません。佐藤様はただいま会議中でございます。',
        'すみません。佐藤は今、会議中ですので、あなたは待ってください。',
      ],
      answer: 0, vocab: ['電話', '会議'],
    }],
  },
  {
    id: 'sb-hatsu-2', form: 'hatsugen', pool: 'sealed', level: 'J2', domain: 'visit',
    script: [{ who: 'B', text: 'あなたは取引先を訪問し、担当の山田様に初めて会いました。名刺を渡しながら、何と言いますか。' }],
    items: [{
      prompt: '何と言いますか。',
      options: [
        'はじめまして。ABC商事の田中と申します。どうぞよろしくお願いいたします。',
        'はじめまして。ABC商事の田中です。よろしくね。',
        'どうも。こちら、わたしの名刺になります。ご覧になってください。',
        'はじめまして。田中様でいらっしゃいますね。名刺を差し上げます。',
      ],
      answer: 0, vocab: ['名刺', '訪問'],
    }],
  },
  {
    id: 'sb-hatsu-3', form: 'hatsugen', pool: 'sealed', level: 'J1', domain: 'apology',
    script: [{ who: 'B', text: '納品した商品にミスがあり、取引先から苦情の電話がありました。あなたは担当者として、まず何と言いますか。' }],
    items: [{
      prompt: '何と言いますか。',
      options: [
        'それは困りましたね。でも、うちのせいではありません。',
        '大変申し訳ございません。すぐに確認し、折り返しご連絡いたします。',
        '申し訳ありませんが、担当者に文句を言ってください。',
        'ご迷惑をおかけしてすみません。来週ご連絡します。',
      ],
      answer: 1, vocab: ['納品', '苦情'],
    }],
  },
  {
    id: 'sb-hatsu-4', form: 'hatsugen', pool: 'sealed', level: 'J2', domain: 'meeting',
    script: [{ who: 'B', text: '会議で、部長が新しい企画について意見を求めています。あなたは反対の意見を言うとき、まず何と言いますか。' }],
    items: [{
      prompt: '何と言いますか。',
      options: [
        '部長、それは違います。',
        '申し上げにくいのですが、費用の面で少し心配がございます。',
        'わたしは反対です。理由は後で言います。',
        '部長のお考えは正しくありません。',
      ],
      answer: 1, vocab: ['会議', '予算'],
    }],
  },
  {
    id: 'sb-hatsu-5', form: 'hatsugen', pool: 'sealed', level: 'J2', domain: 'phone',
    script: [{ who: 'B', text: '電話で、相手の名前が聞き取れませんでした。失礼のないように聞き返すには、何と言いますか。' }],
    items: [{
      prompt: '何と言いますか。',
      options: [
        'えっ、誰ですか。',
        '恐れ入りますが、もう一度お名前をお願いできますでしょうか。',
        'すみません、名前をもう一回言ってくれませんか。',
        'お名前を聞くのを忘れました。教えてください。',
      ],
      answer: 1, vocab: ['電話'],
    }],
  },
  {
    id: 'sb-hatsu-6', form: 'hatsugen', pool: 'sealed', level: 'J3', domain: 'leave',
    script: [{ who: 'B', text: '今日は体の調子が悪く、早く帰りたいと思っています。上司の課長に、何と言いますか。' }],
    items: [{
      prompt: '何と言いますか。',
      options: [
        '課長、今日は帰ります。',
        '申し訳ございません。体調が優れないので、本日は早退させていただけますでしょうか。',
        '課長、具合が悪いから帰ってもいいですか。',
        '体調が悪いので、今日はもう帰ることにします。',
      ],
      answer: 1, vocab: ['上司'],
    }],
  },
  {
    id: 'sb-hatsu-7', form: 'hatsugen', pool: 'sealed', level: 'J1', domain: 'email',
    script: [{ who: 'B', text: '取引先から送られてきた資料を受け取りました。お礼のメールで、その資料を見たことを伝えるには、どの表現を使いますか。' }],
    items: [{
      prompt: 'どの表現を使いますか。',
      options: [
        '資料、見ました。ありがとうございます。',
        '資料を拝見いたしました。ありがとうございます。',
        '資料をご覧になりました。ありがとうございます。',
        '資料をいただいて見せてもらいました。',
      ],
      answer: 1, vocab: ['資料'],
    }],
  },
  {
    id: 'sb-hatsu-8', form: 'hatsugen', pool: 'sealed', level: 'J2', domain: 'schedule',
    script: [{ who: 'B', text: '会議の日程について、部長から「来週の水曜日の午後はどうか」と聞かれました。その日は出張で不在です。何と答えますか。' }],
    items: [{
      prompt: '何と答えますか。',
      options: [
        '水曜日はだめです。',
        '申し訳ございません。その日は出張で不在にしております。木曜日でしたら終日空いております。',
        '水曜日は出張なので、無理だと思います。',
        'その日は行けませんから、変えてください。',
      ],
      answer: 1, vocab: ['出張', '会議'],
    }],
  },
  {
    id: 'sb-hatsu-9', form: 'hatsugen', pool: 'sealed', level: 'J1', domain: 'request',
    script: [{ who: 'B', text: '忙しい先輩に、書類の確認をお願いしなければなりません。何と言いますか。' }],
    items: [{
      prompt: '何と言いますか。',
      options: [
        '先輩、この書類を見てください。急ぎです。',
        'お忙しいところ恐れ入りますが、こちらの書類をご確認いただけますでしょうか。',
        '先輩、書類の確認をお願いしたいんですが、いいですか。',
        'この書類、確認しておいてくださいね。',
      ],
      answer: 1, vocab: ['提出', '申請'],
    }],
  },
  {
    id: 'sb-hatsu-10', form: 'hatsugen', pool: 'sealed', level: 'J2', domain: 'reception',
    script: [{ who: 'B', text: '予約のない来客が受付に来ました。担当者に確認する間、待ってもらうには何と言いますか。' }],
    items: [{
      prompt: '何と言いますか。',
      options: [
        '予約がないので、帰ってください。',
        '担当者に確認いたしますので、恐れ入りますが、少々お待ちいただけますでしょうか。',
        'ちょっと待っててください。確認してきます。',
        '予約がない方はお待ちください。',
      ],
      answer: 1, vocab: ['受付', '来客'],
    }],
  },
]

export const bjtBankListening = [
  // ── Part 1 §3 総合聴解 (sealed) — dialogue, then content questions ──────
  {
    id: 'sb-souL-1', form: 'sougouL', pool: 'sealed', level: 'J2', domain: 'negotiation',
    script: [
      { who: 'A', text: '先日お願いした見積もりの件ですが、その後いかがでしょうか。' },
      { who: 'B', text: '申し訳ございません。部品の価格が上がってしまい、ご希望の金額では難しくなってしまいました。' },
      { who: 'A', text: 'そうですか。では、納期を来月末まで延ばす代わりに、金額は当初のままでお願いできませんか。' },
      { who: 'B', text: '納期に余裕をいただければ、金額は当初のままで対応できます。' },
      { who: 'A', text: 'ありがとうございます。では、その条件で社内の稟議にかけます。' },
    ],
    items: [
      {
        prompt: 'なぜ希望の金額では難しくなりましたか。',
        options: ['部品の価格が上がったから', '人手が足りないから', '工場が休みだから', '注文が増えたから'],
        answer: 0, vocab: ['見積もり', '納期'],
      },
      {
        prompt: '二人は最終的にどうすることにしましたか。',
        options: ['金額を上げて、納期はそのままにする', '納期を延ばして、金額は当初のままにする', '契約を見送る', '部品の会社を変える'],
        answer: 1, vocab: ['稟議', '契約書'],
      },
    ],
  },
  {
    id: 'sb-souL-2', form: 'sougouL', pool: 'sealed', level: 'J2', domain: 'schedule',
    script: [
      { who: 'B', text: '課長、来週の新商品発表会の準備の進捗をご報告します。' },
      { who: 'A', text: 'お願いします。会場の手配はどうなりましたか。' },
      { who: 'B', text: 'ホテルの会場は予約できました。ただ、試供品のサンプルがまだ50個しか届いていません。' },
      { who: 'A', text: '予定は100個でしたね。業者に確認してください。発表会は木曜日ですから、火曜日までには揃えたいところです。' },
      { who: 'B', text: 'かしこまりました。本日中に業者へ連絡し、明日ご報告いたします。' },
    ],
    items: [
      {
        prompt: '何がまだ揃っていませんか。',
        options: ['会場の予約', '試供品のサンプル', '発表会の資料', '参加者の名簿'],
        answer: 1, vocab: ['進捗'],
      },
      {
        prompt: 'サンプルはいつまでに揃えたいと言っていますか。',
        options: ['今日中', '明日まで', '火曜日まで', '木曜日まで'],
        answer: 2, vocab: ['期日'],
      },
    ],
  },
  {
    id: 'sb-souL-3', form: 'sougouL', pool: 'sealed', level: 'J1', domain: 'performance',
    script: [
      { who: 'A', text: '今期の業績ですが、売上高は前年同期比で12%伸びました。' },
      { who: 'B', text: 'それは良い知らせですね。利益の方はどうですか。' },
      { who: 'A', text: '利益はほぼ横ばいです。広告費が想定より増えたことが原因です。' },
      { who: 'B', text: '来期は広告費の配分を見直す必要がありますね。特にオンライン広告の効果を検証しましょう。' },
      { who: 'A', text: 'はい、来月の会議までに分析資料を用意します。' },
    ],
    items: [
      {
        prompt: '今期の売上高はどうでしたか。',
        options: ['前年同期比で12%減った', '前年同期比で12%伸びた', '横ばいだった', '目標に届かなかった'],
        answer: 1, vocab: ['売上高', '業績'],
      },
      {
        prompt: '利益が伸びなかった原因は何ですか。',
        options: ['売上が落ちたから', '社員が減ったから', '広告費が想定より増えたから', '在庫が余ったから'],
        answer: 2, vocab: ['予算', '在庫'],
      },
    ],
  },
  {
    id: 'sb-souL-4', form: 'sougouL', pool: 'sealed', level: 'J3', domain: 'attendance',
    script: [
      { who: 'B', text: 'すみません、来週の金曜日に有給をいただきたいのですが。' },
      { who: 'A', text: '来週の金曜日ですね。その日は月末の棚卸がありますが、あなたの担当分は前日までに終わりますか。' },
      { who: 'B', text: 'はい、木曜日までに終わらせる予定です。残りは鈴木さんに引き継ぎます。' },
      { who: 'A', text: '分かりました。では、申請書を今日中に提出してください。' },
      { who: 'B', text: 'ありがとうございます。すぐに提出いたします。' },
    ],
    items: [
      {
        prompt: '女性はいつ休みを取りたいと言っていますか。',
        options: ['今週の金曜日', '来週の金曜日', '来週の木曜日', '月末'],
        answer: 1, vocab: ['有給', '申請'],
      },
      {
        prompt: '休むための条件として、何をしなければなりませんか。',
        options: ['棚卸に出ること', '担当分を前日までに終わらせ、申請書を今日中に出すこと', '鈴木さんに休んでもらうこと', '残業をすること'],
        answer: 1, vocab: ['提出', '残業'],
      },
    ],
  },
  {
    id: 'sb-souL-5', form: 'sougouL', pool: 'sealed', level: 'J1', domain: 'complaint',
    script: [
      { who: 'A', text: '先週納品した機械の調子が悪いと、お客様から連絡がありました。' },
      { who: 'B', text: 'どのような症状か、詳しく聞きましたか。' },
      { who: 'A', text: '電源を入れても、画面がつかないことがあるそうです。同じ型の機械は他に3台納品しています。' },
      { who: 'B', text: 'まずは技術担当を今日中にお客様のところへ行かせましょう。他の3台についても、来週中に点検の連絡をしてください。' },
      { who: 'A', text: '承知しました。お客様には私から電話で経過を報告いたします。' },
    ],
    items: [
      {
        prompt: '機械にはどんな問題がありますか。',
        options: ['音が大きすぎる', '電源を入れても画面がつかないことがある', '部品が足りない', '届くのが遅れた'],
        answer: 1, vocab: ['納品', '苦情'],
      },
      {
        prompt: '今日中にすることになったのは何ですか。',
        options: ['機械を回収すること', '技術担当をお客様のところへ行かせること', '他の3台を点検すること', 'お客様に報告書を送ること'],
        answer: 1, vocab: ['担当'],
      },
    ],
  },

  // ── Part 2 §1 状況把握 (sealed) — spoken situation + scene card ────────
  {
    id: 'sb-jou-1', form: 'joukyou', pool: 'sealed', level: 'J3', domain: 'phone',
    scene: '男性社員が電話で話しながら、パソコンの画面で表を見ています。',
    script: [{ who: 'B', text: '男の人は、電話で在庫の数を確認しています。在庫はあと20個しかないので、来週発注することになりました。' }],
    items: [{
      prompt: '男の人は何をしていますか。',
      options: [
        '電話で在庫の数を確認しています。',
        '電話で商品を販売しています。',
        'パソコンで資料を作成しています。',
        '電話で会議の日程を決めています。',
      ],
      answer: 0, vocab: ['在庫', '発注'],
    }],
  },
  {
    id: 'sb-jou-2', form: 'joukyou', pool: 'sealed', level: 'J3', domain: 'meeting',
    scene: '会議の前に、社員たちが資料を配っています。',
    script: [{ who: 'B', text: '社員たちは、会議の資料を人数分コピーして、各席に置いています。会議は10時から始まります。' }],
    items: [{
      prompt: '社員たちは何をしていますか。',
      options: [
        '会議を始めています。',
        '資料を配って会議の準備をしています。',
        '資料を読んで質問をしています。',
        '会議の議事録を書いています。',
      ],
      answer: 1, vocab: ['資料', '議事録'],
    }],
  },
  {
    id: 'sb-jou-3', form: 'joukyou', pool: 'sealed', level: 'J2', domain: 'visit',
    scene: 'ロビーで、来客の男性が受付の女性と話しています。',
    script: [{ who: 'B', text: '来客の男性は、約束の時間より30分早く着きました。受付の女性は、担当者に連絡し、ロビーで待ってもらうことにしました。' }],
    items: [{
      prompt: 'この後、男性はどうしますか。',
      options: [
        'すぐに会議室に入ります。',
        'ロビーで担当者を待ちます。',
        '一度帰って出直します。',
        '受付で名刺を渡します。',
      ],
      answer: 1, vocab: ['来客', '受付'],
    }],
  },
  {
    id: 'sb-jou-4', form: 'joukyou', pool: 'sealed', level: 'J2', domain: 'office',
    scene: '女性社員が部長の席に立ち、稟議書を見せています。',
    script: [{ who: 'B', text: '女性は、新しい設備の購入について稟議書を提出し、部長に内容を説明しています。部長は予算を確認しています。' }],
    items: [{
      prompt: '女性は何をしていますか。',
      options: [
        '稟議書の内容を説明しています。',
        '稟議書にサインをもらっています。',
        '予算の計算を手伝っています。',
        '設備を見せています。',
      ],
      answer: 0, vocab: ['稟議書', '予算'],
    }],
  },
  {
    id: 'sb-jou-5', form: 'joukyou', pool: 'sealed', level: 'J3', domain: 'training',
    scene: '研修室で、新入社員が講師の話を聞きながらノートを取っています。',
    script: [{ who: 'B', text: '新入社員たちは、電話応対の研修を受けています。講師が電話のかけ方の例を実演しています。' }],
    items: [{
      prompt: '新入社員たちは何の研修を受けていますか。',
      options: [
        'パソコンの使い方の研修',
        '電話応対の研修',
        '名刺交換の研修',
        '会議の進め方の研修',
      ],
      answer: 1, vocab: ['電話', '社員'],
    }],
  },
]

export const bjtBankDocs = [
// ── Part 2 §2 資料聴読解 (sealed) — document + spoken briefing ─────────
{
id: 'sb-shi-1', form: 'shiryou', pool: 'sealed', level: 'J2', domain: 'schedule',
doc: '\n13:00 開場・受付開始\n13:30 開会の挨拶（社長）\n13:45 新商品の説明（開発部）\n14:30 試用体験\n15:15 質疑応答\n16:00 閉会',
script: [
{ who: 'B', text: '資料は新商品発表会のスケジュールです。当日、試用体験の時間を少し延ばすことになりました。そのため、質疑応答は15時30分からになります。'},
],
items: [
{
prompt: '新商品の説明をするのは誰ですか。',
options: ['社長', '開発部', '営業部', '受付担当'],
answer: 1, vocab: ['資料'],
},
{
prompt: '変更の後、質疑応答は何時からですか。',
options: ['14時30分', '15時15分', '15時30分', '16時'],
answer: 2, vocab: ['期日'],
},
],
},
{
id: 'sb-shi-2', form: 'shiryou', pool: 'sealed', level: 'J2', domain: 'sales',
doc: '\n第1四半期：4,200万円\n第2四半期：4,850万円\n第3四半期：4,600万円\n第4四半期：5,300万円',
script: [
{ who: 'A', text: '資料は四半期ごとの売上です。第3四半期は少し下がりましたが、第4四半期に大きく回復しました。年間を通して、目標の1億8,000万円を上回りました。'},
],
items: [
{
prompt: '売上がいちばん高かったのはいつですか。',
options: ['第1四半期', '第2四半期', '第3四半期', '第4四半期'],
answer: 3, vocab: ['売上高'],
},
{
prompt: '年間の売上は目標と比べてどうでしたか。',
options: ['目標を下回った', '目標と同じだった', '目標を上回った', '目標は決まっていない'],
answer: 2, vocab: ['売上高', '業績'],
},
],
},
{
id: 'sb-shi-3', form: 'shiryou', pool: 'sealed', level: 'J3', domain: 'notice',
doc: '健康診断のお知らせ\n日時：11月12日（火）9:00〜12:00\n場所：本社3階 会議室A\n持ち物：社員証、健康保険証\n※前日の21時以降は食事をしないでください。',
script: [
{ who: 'B', text: '資料は健康診断のお知らせです。今年は去年と場所が変わり、本社3階になりました。当日は人事課の鈴木が受付を担当します。'},
],
items: [
{
prompt: '健康診断の場所はどこですか。',
options: ['本社1階', '本社3階 会議室A', '病院', '人事課'],
answer: 1, vocab: ['社員', '受付'],
},
{
prompt: '前日の何時以降、食事をしてはいけませんか。',
options: ['18時', '20時', '21時', '22時'],
answer: 2, vocab: ['期日'],
},
],
},
{
id: 'sb-shi-4', form: 'shiryou', pool: 'sealed', level: 'J1', domain: 'org',
doc: '\n4月1日より、営業本部を東日本営業部と西日本営業部に分割します。\n・東日本営業部長：佐藤 健一\n・西日本営業部長：中村 美咲\n現営業本部長 高橋 誠は、取締役に就任します。',
script: [
{ who: 'A', text: '資料は4月からの組織変更のお知らせです。営業本部が二つに分かれます。なお、東西両部の予算は、当面これまで通り本部で一括管理します。'},
],
items: [
{
prompt: '高橋誠さんは4月からどうなりますか。',
options: ['東日本営業部長になる', '西日本営業部長になる', '取締役に就任する', '退職する'],
answer: 2, vocab: ['取締役', '部署'],
},
{
prompt: '予算の管理はどうなりますか。',
options: ['各部が別々に管理する', '当面、本部で一括管理する', '社長が管理する', '廃止される'],
answer: 1, vocab: ['予算', '部署'],
},
],
},
{
id: 'sb-shi-5', form: 'shiryou', pool: 'sealed', level: 'J3', domain: 'order',
doc: '\n品名：コピー用紙 A4（500枚×10箱）\n数量：30箱\n単価：2,800円\n合計：84,000円\n納期：11月20日',
script: [
{ who: 'B', text: '資料はコピー用紙の注文書です。今回、数量を前回の20箱から30箱に増やしました。納期は来月の予定でしたが、業者から11月20日に届けられると連絡がありました。'},
],
items: [
{
prompt: '今回の注文数量は前回と比べてどうなりましたか。',
options: ['減った', '同じ', '増えた', 'まだ決まっていない'],
answer: 2, vocab: ['発注'],
},
{
prompt: '合計金額はいくらですか。',
options: ['28,000円', '56,000円', '84,000円', '280,000円'],
answer: 2, vocab: ['請求書', '納期'],
},
],
},

// ── Part 2 §3 総合聴読解 (sealed) — document + longer dialogue ─────────
{
id: 'sb-lr-1', form: 'sougouLR', pool: 'sealed', level: 'J1', domain: 'hiring',
doc: '来年度 新卒採用\n営業職：10名（東京6名・大阪4名）\n技術職：8名（東京8名）\n事務職：2名（東京2名）\n面接日程：書類選考の後、2月中',
script: [
{ who: 'A', text: '採用計画を見ました。技術職は応募が少ない傾向があるので、早めに学校訪問を始めたほうがいいですね。'},
{ who: 'B', text: '同感です。去年は技術職が定員に届きませんでした。今年は大学の説明会に1月から参加します。'},
{ who: 'A', text: '営業職の大阪分は、現地の担当と面接日程を調整してください。'},
{ who: 'B', text: '承知しました。来週中に日程案をまとめます。'},
],
items: [
{
prompt: '技術職の採用で、去年何が問題でしたか。',
options: ['面接の日程が決まらなかった', '応募が少なく定員に届かなかった', '学校訪問が遅れた', '予算が足りなかった'],
answer: 1, vocab: ['採用'],
},
{
prompt: '営業職は合計何名採用しますか。',
options: ['4名', '6名', '10名', '20名'],
answer: 2, vocab: ['採用', '訪問'],
},
],
},
{
id: 'sb-lr-2', form: 'sougouLR', pool: 'sealed', level: 'J2', domain: 'inventory',
doc: '10月末時点\n商品A：在庫 120個（適正 100個）\n商品B：在庫 15個（適正 80個）\n商品C：在庫 210個（適正 150個）',
script: [
{ who: 'B', text: '在庫レポートを確認しました。商品Bがかなり不足しています。来週のキャンペーンで需要が増える見込みなので、急いで発注が必要です。'},
{ who: 'A', text: '商品Cは余り気味ですね。キャンペーンの対象に商品Cを入れて、在庫を減らしましょう。'},
{ who: 'B', text: '分かりました。商品Bは本日中に発注し、商品Cはキャンペーン案に加えます。'},
],
items: [
{
prompt: '急いで発注が必要なのはどの商品ですか。',
options: ['商品A', '商品B', '商品C', '全部'],
answer: 1, vocab: ['在庫', '発注'],
},
{
prompt: '商品Cはどうすることにしましたか。',
options: ['値引きして廃棄する', 'キャンペーンの対象に入れる', '他の倉庫へ移す', '発注を増やす'],
answer: 1, vocab: ['在庫', '値引き'],
},
],
},
{
id: 'sb-lr-3', form: 'sougouLR', pool: 'sealed', level: 'J2', domain: 'trip',
doc: '福岡出張（田中）\n11月25日（月）9:00 羽田発 → 11:05 福岡着\n13:00 F社訪問（商談）\n11月26日（火）10:00 G社訪問（契約書の確認）\n15:30 福岡発 → 17:20 羽田着',
script: [
{ who: 'A', text: '出張日程ですが、F社から連絡があり、月曜日の商談を30分早めてほしいそうです。'},
{ who: 'B', text: '飛行機が11時5分に着くので、12時30分開始なら間に合います。F社に確認してみます。'},
{ who: 'A', text: 'お願いします。火曜日のG社は変更なしです。契約書の草案を忘れずに持って行ってください。'},
],
items: [
{
prompt: 'F社は何を希望していますか。',
options: ['商談を30分遅らせること', '商談を30分早めること', '商談を火曜日にすること', 'オンラインに変えること'],
answer: 1, vocab: ['出張', '商談'],
},
{
prompt: '火曜日に田中さんがしなければならないことは何ですか。',
options: ['見積もりを提出すること', '契約書の草案を持ってG社を訪問すること', '福岡で会議を開くこと', '飛行機を変更すること'],
answer: 1, vocab: ['契約書', '訪問'],
},
],
},
{
id: 'sb-lr-4', form: 'sougouLR', pool: 'sealed', level: 'J1', domain: 'budget',
doc: '（単位：万円）\n広告費：1,200（今期 1,500）\n開発費：3,000（今期 2,600）\n人件費：8,000（今期 7,800）\nその他：800（今期 900）',
script: [
{ who: 'A', text: '予算案ですが、広告費を削る代わりに、開発費を増やしています。新しいシステム開発が来期の重点です。'},
{ who: 'B', text: '人件費も増えていますね。採用を増やすのですか。'},
{ who: 'A', text: 'はい、技術職を中心に増員する計画です。ただし、全体の合計は今期より抑える方針です。'},
],
items: [
{
prompt: '来期、最も増額される項目はどれですか。',
options: ['広告費', '開発費', '人件費', 'その他'],
answer: 1, vocab: ['予算', '経費'],
},
{
prompt: '人件費が増える理由は何ですか。',
options: ['給料が上がるから', '技術職を中心に増員するから', '残業が増えるから', '退職金が増えるから'],
answer: 1, vocab: ['採用', '残業'],
},
],
},
{
id: 'sb-lr-5', form: 'sougouLR', pool: 'sealed', level: 'J3', domain: 'meeting',
doc: 'プロジェクト進捗会議\n日時：毎週月曜日 10:00〜11:00\n場所：第2会議室\n参加者：各チームリーダー\n持ち物：週報（前週分）',
script: [
{ who: 'B', text: '来週の月曜日は祝日なので、進捗会議は火曜日の同じ時間に変更されます。場所も第2会議室が使えないため、本社ビルの研修室になります。'},
{ who: 'A', text: '分かりました。週報はいつも通り前週分を持って行けばいいですか。'},
{ who: 'B', text: 'はい。ただし、来週は月末のまとめも必要なので、先月分の資料も持ってきてください。'},
],
items: [
{
prompt: '来週の会議はいつ、どこで開かれますか。',
options: ['月曜日、第2会議室', '火曜日、研修室', '火曜日、第2会議室', '月曜日、研修室'],
answer: 1, vocab: ['会議室', '進捗'],
},
{
prompt: '来週、余分に持って行くものは何ですか。',
options: ['今週の週報', '先月分の資料', '名刺', '会議室の鍵'],
answer: 1, vocab: ['資料', '議事録'],
},
],
},
]

export const bjtBankReading = [
// ── Part 3 語彙・文法 (sealed) ──────────────────────────────────────────
{
id: 'sb-goi-1', form: 'goi', pool: 'sealed', level: 'J2', domain: 'vocab',
items: [{ prompt: '会議の前に、資料を全員に（　）しました。', options: ['配布', '配達', '分配', '配給'], answer: 0, vocab: ['資料']}],
},
{
id: 'sb-goi-2', form: 'goi', pool: 'sealed', level: 'J2', domain: 'vocab',
items: [{ prompt: '納期に遅れないよう、作業の（　）を毎日確認している。', options: ['進捗', '進行中', '進出', '進学'], answer: 0, vocab: ['進捗', '納期']}],
},
{
id: 'sb-goi-3', form: 'goi', pool: 'sealed', level: 'J1', domain: 'vocab',
items: [{ prompt: 'この案件は、社長の（　）が下りるまで正式に始められない。', options: ['決裁', '決算', '決勝', '決意'], answer: 0, vocab: ['決裁', '案件']}],
},
{
id: 'sb-goi-4', form: 'goi', pool: 'sealed', level: 'J2', domain: 'grammar',
items: [{ prompt: '部長、明日の会議の件ですが、資料はもうご覧（　）か。', options: ['になりました', 'しました', 'いただきました', 'まいりました'], answer: 0, vocab: ['資料', '会議']}],
},
{
id: 'sb-goi-5', form: 'goi', pool: 'sealed', level: 'J3', domain: 'vocab',
items: [{ prompt: '商品の（　）が切れているので、至急発注してください。', options: ['在庫', '在籍', '在宅', '在留'], answer: 0, vocab: ['在庫', '発注']}],
},
{
id: 'sb-goi-6', form: 'goi', pool: 'sealed', level: 'J1', domain: 'vocab',
items: [{ prompt: '経営会議で、新規事業への参入は（　）され、来期に持ち越された。', options: ['可決', '否決', '保留', '審議'], answer: 2, vocab: ['保留', '審議']}],
},
{
id: 'sb-goi-7', form: 'goi', pool: 'sealed', level: 'J2', domain: 'grammar',
items: [{ prompt: 'お客様からお預かりした書類は、こちらで大切に（　）。', options: ['保管いたします', '保管なさいます', '保管いただきます', '保管ご覧になります'], answer: 0, vocab: ['提出']}],
},
{
id: 'sb-goi-8', form: 'goi', pool: 'sealed', level: 'J3', domain: 'vocab',
items: [{ prompt: '出張の交通費は、帰社後に領収書を付けて（　）してください。', options: ['精算', '決算', '清算金', '計算'], answer: 0, vocab: ['精算', '領収書']}],
},
{
id: 'sb-goi-9', form: 'goi', pool: 'sealed', level: 'J2', domain: 'vocab',
items: [{ prompt: '取引先との（　）が進み、来月にも契約が成立する見込みだ。', options: ['交渉', '交際', '交通', '交流会'], answer: 0, vocab: ['交渉', '取引先']}],
},
{
id: 'sb-goi-10', form: 'goi', pool: 'sealed', level: 'J1', domain: 'grammar',
items: [{ prompt: '詳細につきましては、添付の資料をご確認（　）幸いです。', options: ['いただけますと', 'なさいますと', 'いたしますと', '申し上げますと'], answer: 0, vocab: ['資料']}],
},

// ── Part 3 表現読解 (sealed) — short business text, one question ───────
{
id: 'sb-hyo-1', form: 'hyougen', pool: 'sealed', level: 'J2', domain: 'email',
doc: '件名：会議日程の変更について\n来週水曜日に予定しておりました定例会議は、会場の都合により、木曜日15時からに変更いたします。ご都合の悪い方は、金曜日正午までにご連絡ください。',
items: [{ prompt: '都合の悪い人は、どうしなければなりませんか。', options: ['会議を欠席する', '金曜日正午までに連絡する', '会場を変更する', '木曜日15時に来る'], answer: 1, vocab: ['会議']}],
},
{
id: 'sb-hyo-2', form: 'hyougen', pool: 'sealed', level: 'J3', domain: 'notice',
doc: 'コピー機の利用について\nコピー機の故障が増えています。大量のコピーは、17時以降にご利用ください。また、用紙がなくなった場合は、総務課までお知らせください。',
items: [{ prompt: '大量のコピーはいつすればよいですか。', options: ['朝一番', '昼休み', '17時以降', 'いつでもよい'], answer: 2, vocab: ['社内']}],
},
{
id: 'sb-hyo-3', form: 'hyougen', pool: 'sealed', level: 'J2', domain: 'email',
doc: '件名：見積書送付のご依頼\n先日はお打ち合わせの機会をいただき、ありがとうございました。つきましては、来週月曜日までに、見積書をご送付いただけますと幸いです。',
items: [{ prompt: 'このメールで依頼していることは何ですか。', options: ['打ち合わせの日程調整', '見積書を来週月曜日までに送ること', '契約書へのサイン', '商品の納品'], answer: 1, vocab: ['見積もり', '打ち合わせ']}],
},
{
id: 'sb-hyo-4', form: 'hyougen', pool: 'sealed', level: 'J1', domain: 'notice',
doc: '年末年始の受注について\n年末の受注は12月25日までとさせていただきます。26日以降のご注文は、年始の営業開始日より順次対応いたします。何卒ご了承くださいますようお願い申し上げます。',
items: [{ prompt: '12月27日に注文した場合、どうなりますか。', options: ['年内に届く', '受注できない', '年始の営業開始日より順次対応される', '追加料金がかかる'], answer: 2, vocab: ['受注', '納期']}],
},
{
id: 'sb-hyo-5', form: 'hyougen', pool: 'sealed', level: 'J3', domain: 'notice',
doc: '残業申請について\n残業を行う場合は、当日の17時までに、勤怠システムから申請してください。事後の申請は認められませんので、ご注意ください。',
items: [{ prompt: '残業の申請はいつまでに行いますか。', options: ['当日の17時まで', '翌日の朝まで', '月末まで', '事後でもよい'], answer: 0, vocab: ['残業', '勤怠']}],
},
{
id: 'sb-hyo-6', form: 'hyougen', pool: 'sealed', level: 'J2', domain: 'email',
doc: '件名：セミナー参加のお礼\n本日は弊社セミナーにご参加いただき、誠にありがとうございました。当日の資料は、明日中にメールにてお送りいたします。ご不明点がございましたら、担当の伊藤までご連絡ください。',
items: [{ prompt: '資料はいつ、どのように送られますか。', options: ['今日、郵送で', '明日中、メールで', '来週、郵送で', '当日、手渡しで'], answer: 1, vocab: ['資料', '担当']}],
},
{
id: 'sb-hyo-7', form: 'hyougen', pool: 'sealed', level: 'J1', domain: 'email',
doc: '件名：価格改定のお知らせ\n原材料価格の高騰により、来月より一部製品の価格を改定させていただくこととなりました。詳細は添付の一覧をご確認ください。何卒ご理解賜りますようお願い申し上げます。',
items: [{ prompt: '価格が改定される理由は何ですか。', options: ['売上が下がったから', '原材料価格が上がったから', '社員が増えたから', '為替が変動したから'], answer: 1, vocab: ['売上高']}],
},
{
id: 'sb-hyo-8', form: 'hyougen', pool: 'sealed', level: 'J3', domain: 'notice',
doc: '社員食堂は、改修工事のため、来週月曜日から金曜日まで休業いたします。期間中は、近隣の飲食店で使える食事券を人事課で配布いたします。',
items: [{ prompt: '食堂が休みの間、社員はどうやって食事をしますか。', options: ['自宅で食べる', '食事券で近隣の飲食店を使う', '会社が弁当を用意する', '食堂の別フロアを使う'], answer: 1, vocab: ['社員']}],
},
{
id: 'sb-hyo-9', form: 'hyougen', pool: 'sealed', level: 'J2', domain: 'email',
doc: '件名：資料送付のお願い\n来週の商談に先立ち、貴社の製品カタログと価格表を、本日中にお送りいただけますでしょうか。急ぎの案件のため、ご対応いただけますと幸いです。',
items: [{ prompt: '送ってほしいものは何ですか。', options: ['契約書と請求書', '製品カタログと価格表', '見積書と納品書', '会社案内と名刺'], answer: 1, vocab: ['商談', '資料']}],
},
{
id: 'sb-hyo-10', form: 'hyougen', pool: 'sealed', level: 'J1', domain: 'notice',
doc: '当期の決算短信を公開いたしました。売上高は前期比6%増、営業利益は同4%増となりました。詳細は当社ホームページの投資家情報ページをご覧ください。',
items: [{ prompt: '営業利益は前期と比べてどうなりましたか。', options: ['6%増えた', '4%増えた', '4%減った', '変わらなかった'], answer: 1, vocab: ['決算', '売上高']}],
},

// ── Part 3 総合読解 (sealed) — longer documents, two questions ─────────
{
id: 'sb-souR-1', form: 'sougouR', pool: 'sealed', level: 'J1', domain: 'report',
doc: '新規事業の進捗について\n新規事業部 部長 高田\n\n本四半期は、新規顧客の獲得に注力し、目標の80件に対し92件の契約を獲得した。一方で、カスタマーサポートへの問い合わせが前四半期比で30%増加しており、対応人員の不足が課題となっている。来四半期は、サポート要員の増員と、よくある質問への自動応答システムの導入を検討する。',
items: [
{ prompt: '新規契約は目標と比べてどうでしたか。', options: ['目標に届かなかった', '目標と同じだった', '目標を上回った', 'まだ分からない'], answer: 2, vocab: ['契約書', '進捗']},
{ prompt: '現在の課題は何ですか。', options: ['顧客が獲得できないこと', 'サポート対応の人員不足', 'システムの故障', '予算の不足'], answer: 1, vocab: ['担当', '苦情']},
],
},
{
id: 'sb-souR-2', form: 'sougouR', pool: 'sealed', level: 'J2', domain: 'rules',
doc: '出張時の宿泊費について\n来月より、出張時の宿泊費の上限を、1泊12,000円から13,500円に引き上げます。ただし、予約は原則として出発の7日前までに行い、変更・キャンセル料は自己負担といたします。上限を超える場合は、事前に部長の承認が必要です。',
items: [
{ prompt: '宿泊費の新しい上限はいくらですか。', options: ['12,000円', '13,000円', '13,500円', '15,000円'], answer: 2, vocab: ['出張', '経費']},
{ prompt: '上限を超える宿泊をする場合、必要なことは何ですか。', options: ['総務課への連絡', '事前に部長の承認を得ること', '領収書の提出', '7日前の予約'], answer: 1, vocab: ['承認', '領収書']},
],
},
{
id: 'sb-souR-3', form: 'sougouR', pool: 'sealed', level: 'J2', domain: 'email',
doc: '件名：展示会出展のご報告と今後の対応\n営業部 佐々木\n\n先週開催された業界展示会に当社も出展し、3日間で約400名の方にブースへお越しいただきました。特に新製品への関心が高く、商談の約束を15件いただいております。今週中に、ご来場者全員へお礼メールを送付し、来週から順次訪問のアポイントを取ってまいります。',
items: [
{ prompt: '展示会では何件の商談の約束が取れましたか。', options: ['3件', '15件', '40件', '400件'], answer: 1, vocab: ['商談']},
{ prompt: '今週中にすることになっているのは何ですか。', options: ['訪問のアポイントを取ること', '来場者全員へお礼メールを送ること', '新製品を発売すること', '報告書を提出すること'], answer: 1, vocab: ['訪問', '提出']},
],
},
{
id: 'sb-souR-4', form: 'sougouR', pool: 'sealed', level: 'J1', domain: 'minutes',
doc: '商品開発会議\n日時：10月28日 13:00〜14:30\n出席者：開発部、営業部、品質管理部\n\n1. 新製品の発売日について\n品質テストの結果を受け、発売日を当初予定の12月1日から12月15日へ延期することを決定した。\n2. 価格について\n価格は現行モデルと同額に据え置くことで合意した。\n3. 次回会議\n11月11日、販売促進計画を議題とする。',
items: [
{ prompt: '発売日が延期された理由は何ですか。', options: ['部品が届かなかったから', '品質テストの結果を受けて', '価格が決まらなかったから', '営業部が反対したから'], answer: 1, vocab: ['議事録']},
{ prompt: '新製品の価格はどう決まりましたか。', options: ['現行モデルより値上げする', '現行モデルと同額に据え置く', '現行モデルより値引きする', 'まだ決まっていない'], answer: 1, vocab: ['値引き', '合意']},
],
},
{
id: 'sb-souR-5', form: 'sougouR', pool: 'sealed', level: 'J3', domain: 'notice',
doc: '今年度の社員旅行は、11月29日（金）から30日（土）まで、箱根方面へ行きます。参加希望の方は、10月31日までに総務課へ申し込んでください。参加費は一人5,000円です。集合場所と時間は、後日メールでお知らせします。家族の参加はできません。',
items: [
{ prompt: '申し込みの締め切りはいつですか。', options: ['10月29日', '10月31日', '11月29日', '11月30日'], answer: 1, vocab: ['申請', '期日']},
{ prompt: 'この旅行について正しいものはどれですか。', options: ['参加費は無料である', '家族も参加できる', '集合場所は後日メールで知らされる', '日帰り旅行である'], answer: 2, vocab: ['社員']},
],
},
]

// All sealed bank groups (80 questions: one full sealed paper).
export const bjtAllGroups = [...bjtBank, ...bjtBankListening, ...bjtBankDocs, ...bjtBankReading]
