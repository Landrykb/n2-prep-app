export const bjtScoreMapping = [
  { bjt: 'J1+', score: '600 – 800', jlpt: '≈ N1 / advanced business', color: 'emerald' },
  { bjt: 'J1', score: '530 – 599', jlpt: '≈ N2', color: 'cyan' },
  { bjt: 'J2', score: '420 – 529', jlpt: '≈ N3', color: 'violet' },
  { bjt: 'J3', score: '320 – 419', jlpt: '≈ N4', color: 'amber' },
  { bjt: 'J4', score: '200 – 319', jlpt: '≈ N5', color: 'rose' },
  { bjt: 'J5', score: '0 – 199', jlpt: 'Beginner', color: 'slate' }
]

export const bjtLevels = ['J1', 'J2', 'J3', 'J4', 'J5']

export const bjtKeigo = [
  { plain: '見る', sonkei: 'ご覧になる', kenjou: '拝見する', scene: 'Looking at a document' },
  { plain: '言う', sonkei: 'おっしゃる', kenjou: '申す / 申し上げる', scene: 'Saying / telling' },
  { plain: '知る', sonkei: '存じる / 存じ上げる', kenjou: '存じる', scene: 'Knowing (internal)' },
  { plain: '食べる', sonkei: '召し上がる', kenjou: 'いただく', scene: 'Eating / drinking' },
  { plain: '行く', sonkei: 'いらっしゃる / おいでになる', kenjou: '参る / 伺う', scene: 'Going somewhere' },
  { plain: '来る', sonkei: 'いらっしゃる / お越しになる', kenjou: '参る', scene: 'Coming' },
  { plain: 'する', sonkei: 'なさる', kenjou: 'いたす', scene: 'Doing' },
  { plain: 'いる', sonkei: 'いらっしゃる', kenjou: 'おる', scene: 'Being (somewhere)' },
  { plain: '聞く', sonkei: 'お聞きになる', kenjou: '伺う / 拝聴する', scene: 'Hearing / asking' },
  { plain: '借りる', sonkei: 'お借りになる', kenjou: '拝借する', scene: 'Borrowing' },
  { plain: '会う', sonkei: 'お目にかかる', kenjou: 'お目にかかる', scene: 'Meeting someone' },
  { plain: '受け取る', sonkei: 'お受け取りになる', kenjou: '頂戴する / 拝受する', scene: 'Receiving' },
  { plain: '待つ', sonkei: 'お待ちになる', kenjou: '待たせる / 待つ', scene: 'Waiting' },
  { plain: '読む', sonkei: 'お読みになる', kenjou: '拝読する', scene: 'Reading (someone’s writing)' },
  { plain: '考える', sonkei: 'お考えになる', kenjou: '考えさせていただく', scene: 'Thinking / considering' },
  { plain: '使う', sonkei: 'お使いになる', kenjou: '使わせていただく', scene: 'Using' }
]

export const bjtVocab = [
  { word: '稟議書', reading: 'りんぎしょ', meaning: 'Approval request form', level: 'J2' },
  { word: '決算', reading: 'けっさん', meaning: 'Financial settlement / closing accounts', level: 'J2' },
  { word: '見積もり', reading: 'みつもり', meaning: 'Quotation / estimate', level: 'J3' },
  { word: '納期', reading: 'のうき', meaning: 'Delivery date', level: 'J3' },
  { word: '在庫', reading: 'ざいこ', meaning: 'Inventory / stock', level: 'J3' },
  { word: '売上高', reading: 'うりあげだか', meaning: 'Sales revenue', level: 'J2' },
  { word: '取引先', reading: 'とりひきさき', meaning: 'Business partner / client', level: 'J3' },
  { word: '勤怠', reading: 'きんたい', meaning: 'Attendance / work hours', level: 'J3' },
  { word: '予算', reading: 'よさん', meaning: 'Budget', level: 'J3' },
  { word: '会議', reading: 'かいぎ', meaning: 'Meeting', level: 'J4' },
  { word: '商談', reading: 'しょうだん', meaning: 'Business negotiation', level: 'J2' },
  { word: '契約書', reading: 'けいやくしょ', meaning: 'Contract document', level: 'J2' },
  { word: '請求書', reading: 'せいきゅうしょ', meaning: 'Invoice / bill', level: 'J3' },
  { word: '領収書', reading: 'りょうしゅうしょ', meaning: 'Receipt', level: 'J4' },
  { word: '社内', reading: 'しゃない', meaning: 'Within the company', level: 'J4' },
  { word: '取締役', reading: 'とりしまりやく', meaning: 'Director / board member', level: 'J1' },
  { word: '株主', reading: 'かぶぬし', meaning: 'Shareholder', level: 'J2' },
  { word: '業績', reading: 'ぎょうせき', meaning: 'Business performance', level: 'J2' },
  { word: '採用', reading: 'さいよう', meaning: 'Hiring / adoption', level: 'J3' },
  { word: '退職', reading: 'たいしょく', meaning: 'Retirement / resignation', level: 'J3' },
  { word: '出張', reading: 'しゅっちょう', meaning: 'Business trip', level: 'J4' },
  { word: '期日', reading: 'きじつ', meaning: 'Deadline / due date', level: 'J3' },
  { word: '議事録', reading: 'ぎじろく', meaning: 'Meeting minutes', level: 'J2' },
  { word: '稟議', reading: 'りんぎ', meaning: 'Approval / deliberation', level: 'J2' },
  { word: '稟議決裁', reading: 'りんぎけっさい', meaning: 'Approval decision', level: 'J1' },
  { word: '稟議会', reading: 'りんぎかい', meaning: 'Approval meeting', level: 'J1' },
  { word: '稟議者', reading: 'りんぎしゃ', meaning: 'Approver / person raising request', level: 'J2' },
  { word: '稟議事項', reading: 'りんぎじこう', meaning: 'Approval item', level: 'J2' },
  { word: '稟議番号', reading: 'りんぎばんごう', meaning: 'Approval number', level: 'J2' },
  { word: '稟議期限', reading: 'りんぎきげん', meaning: 'Approval deadline', level: 'J2' },
  { word: '稟議提出', reading: 'りんぎていしゅつ', meaning: 'Submission of approval request', level: 'J2' },
  { word: '稟議承認', reading: 'りんぎしょうにん', meaning: 'Approval authorization', level: 'J1' },
  { word: '稟議否決', reading: 'りんぎひけつ', meaning: 'Rejection of approval', level: 'J1' },
  { word: '稟議保留', reading: 'りんぎほりゅう', meaning: 'Approval on hold', level: 'J2' },
  { word: '稟議再提出', reading: 'りんぎさいていしゅつ', meaning: 'Resubmission of request', level: 'J2' },
  { word: '稟議回覧', reading: 'りんぎかいらん', meaning: 'Approval circulation', level: 'J2' },
  { word: '稟議書式', reading: 'りんぎしょしき', meaning: 'Approval form format', level: 'J2' },
  { word: '稟議起案', reading: 'りんぎきあん', meaning: 'Drafting an approval request', level: 'J2' },
  { word: '稟議審議', reading: 'りんぎしんぎ', meaning: 'Approval review', level: 'J1' },
  { word: '稟議可決', reading: 'りんぎかけつ', meaning: 'Approval passed', level: 'J1' },
  { word: '稟議未決', reading: 'りんぎみけつ', meaning: 'Approval pending', level: 'J2' },
  { word: '稟議完了', reading: 'りんぎかんりょう', meaning: 'Approval completed', level: 'J2' },
  { word: '稟議状況', reading: 'りんぎじょうきょう', meaning: 'Approval status', level: 'J2' },
  { word: '稟議経路', reading: 'りんぎけいろ', meaning: 'Approval route', level: 'J2' },
  { word: '稟議フロー', reading: 'りんぎふろー', meaning: 'Approval workflow', level: 'J2' },
  { word: '稟議電子', reading: 'りんぎでんし', meaning: 'Electronic approval', level: 'J2' },
  { word: '稟議紙', reading: 'りんぎかみ', meaning: 'Paper approval', level: 'J3' },
  { word: '稟議承認者', reading: 'りんぎしょうにんしゃ', meaning: 'Approver', level: 'J1' },
  { word: '稟議申請者', reading: 'りんぎしんせいしゃ', meaning: 'Applicant', level: 'J2' },
  { word: '稟議内容', reading: 'りんぎないよう', meaning: 'Approval details', level: 'J2' },
  { word: '稟議金額', reading: 'りんぎきんがく', meaning: 'Approval amount', level: 'J2' },
  { word: '稟議目的', reading: 'りんぎもくてき', meaning: 'Approval purpose', level: 'J2' },
  { word: '稟議理由', reading: 'りんぎりゆう', meaning: 'Approval reason', level: 'J2' },
  { word: '名刺', reading: 'めいし', meaning: 'Business card', level: 'J4' },
  { word: '訪問', reading: 'ほうもん', meaning: 'Visit (to a client)', level: 'J4' },
  { word: '電話', reading: 'でんわ', meaning: 'Phone / call', level: 'J4' },
  { word: '来客', reading: 'らいきゃく', meaning: 'Visitor / customer', level: 'J4' },
  { word: '受付', reading: 'うけつけ', meaning: 'Reception', level: 'J4' },
  { word: '社員', reading: 'しゃいん', meaning: 'Employee', level: 'J5' },
  { word: '会社', reading: 'かいしゃ', meaning: 'Company', level: 'J5' },
  { word: '会議室', reading: 'かいぎしつ', meaning: 'Meeting room', level: 'J5' },
  { word: '資料', reading: 'しりょう', meaning: 'Materials / document', level: 'J4' },
  { word: '進捗', reading: 'しんちょく', meaning: 'Progress', level: 'J3' },
]

export const bjtPassages = [
  {
    title: '社内メール：出張の稟議',
    level: 'J2',
    time: 3,
    text: '山田部長、\n\n来月の東京出張について、以下の通り稟議書を提出いたします。\n\n日程：12月15日（水）〜17日（金）\n目的：新規取引先との契約交渉\n予算：交通費及び宿泊費を含め、約15万円\n\n現地の営業担当者と直接面談し、来期の納期及び価格条件について合意した後、契約書の草案を作成する予定です。\n\n何かご不明な点がございましたら、お手数ですがご連絡ください。',
    questions: [
      {
        prompt: '出張の目的は何ですか。',
        options: [
          { label: '最終契約の締結', correct: false },
          { label: '新規取引先との契約交渉', correct: true },
          { label: '工場の見学', correct: false },
          { label: '面接', correct: false },
        ],
        explanation: 'メールには「新規取引先との契約交渉」と書いてある。',
      },
      {
        prompt: '予算は約いくらですか。',
        options: [
          { label: '5万円', correct: false },
          { label: '10万円', correct: false },
          { label: '15万円', correct: true },
          { label: '20万円', correct: false },
        ],
        explanation: '予算は「約15万円」と書いてある。',
      },
    ],
  },
  {
    title: '会議の議事録',
    level: 'J1',
    time: 4,
    text: '営業戦略会議\n日時：10月20日 14:00〜15:30\n出席者：佐藤部長、田中課長、伊藤主任\n\n1. 四半期の売上高について\n前四半期比8%増加。新規顧客の獲得が目標を上回った。\n\n2. 来期の予算配分\n広告費を20%削減し、デジタルマーケティング投資を拡大する方向で検討中。\n\n3. 次回打ち合わせ\n来週の月曜日までに各課から資料を提出すること。',
    questions: [
      {
        prompt: '前の四半期と比べて何が8%増えましたか。',
        options: [
          { label: '従業員数', correct: false },
          { label: '売上高', correct: true },
          { label: '広告費', correct: false },
          { label: '在庫', correct: false },
        ],
        explanation: '四半期の売上高が前四半期比8%増加した。',
      },
      {
        prompt: '何を20%削減する方向で検討中ですか。',
        options: [
          { label: 'デジタルマーケティング投資', correct: false },
          { label: '広告費', correct: true },
          { label: '出張予算', correct: false },
          { label: '新規顧客予算', correct: false },
        ],
        explanation: '「広告費を20%削減」とある。',
      },
    ],
  },
  {
    title: '社内通知：在庫管理の見直し',
    level: 'J2',
    time: 3,
    text: '倉庫管理課 各位\n\n最近、一部商品の在庫切れ及び過剰在庫が目立っております。\n\n来月より、週次の在庫レポートを毎週金曜日までに提出していただきます。\n在庫状況に応じて、発注量の調整及び販売促進を適宜実施してください。\n\nなお、棚卸の実施日は来月5日を予定しております。',
    questions: [
      {
        prompt: 'どのような問題が目立っていますか。',
        options: [
          { label: '倉庫の人員が多い', correct: false },
          { label: '在庫切れ及び過剰在庫', correct: true },
          { label: '支払いの遅延', correct: false },
          { label: '機器の故障', correct: false },
        ],
        explanation: '「在庫切れ及び過剰在庫が目立っております」とある。',
      },
      {
        prompt: '在庫レポートはいつ提出しますか。',
        options: [
          { label: '毎週月曜日まで', correct: false },
          { label: '毎週金曜日まで', correct: true },
          { label: '毎月', correct: false },
          { label: '毎日', correct: false },
        ],
        explanation: '「毎週金曜日までに提出」とある。',
      },
    ],
  },
  {
    title: 'お詫びメール：納期遅延',
    level: 'J1',
    time: 4,
    text: 'O社 山田様\n\nいつも大変お世話になっております。\n\n平素より格別のご高配を賜り、厚く御礼申し上げます。\n\nさて、先日ご注文いただきました商品の納期につきまして、原材料の調達遅延により、当初の予定より5日ほど遅れる見込みでございます。\n\nお客様には大変ご迷惑をおかけいたしますが、何卒ご理解賜りますようお願い申し上げます。\n\n今後とも何卒よろしくお願い申し上げます。',
    questions: [
      {
        prompt: 'メールの主な目的は何ですか。',
        options: [
          { label: '注文の確認', correct: false },
          { label: '納期遅延の謝罪', correct: true },
          { label: '支払いの依頼', correct: false },
          { label: '新商品の発表', correct: false },
        ],
        explanation: '納期が5日ほど遅れることを謝罪している。',
      },
      {
        prompt: '納期は約何日遅れますか。',
        options: [
          { label: '3日', correct: false },
          { label: '5日', correct: true },
          { label: '7日', correct: false },
          { label: '10日', correct: false },
        ],
        explanation: '「5日ほど遅れる見込み」とある。',
      },
    ],
  },
  {
    title: '社内のお知らせ：社員証',
    level: 'J4',
    time: 2,
    text: '社員の皆様\n\n来月より新しい社員証が発行されます。\n現在お持ちの社員証は、12月末日までに受付へお返しください。\n\n新しい社員証は、1月5日から各部署へ配布いたします。\nなくした場合は、人事課へ連絡してください。',
    questions: [
      {
        prompt: '現在の社員証はいつまでに返却しますか。',
        options: [
          { label: '1月末日まで', correct: false },
          { label: '12月末日まで', correct: true },
          { label: '2月末日まで', correct: false },
          { label: 'すぐに', correct: false },
        ],
        explanation: '「12月末日までに受付へお返しください」とある。',
      },
      {
        prompt: '新しい社員証はどこで配布されますか。',
        options: [
          { label: '受付で', correct: false },
          { label: '各部署で', correct: true },
          { label: '郵送で', correct: false },
          { label: '研修センターで', correct: false },
        ],
        explanation: '「各部署へ配布いたします」とある。',
      },
    ],
  },
  {
    title: '休憩室の利用',
    level: 'J5',
    time: 1,
    text: '皆様\n\n休憩室は12時から13時までのお昼休みにご利用いただけます。\n食事の後は、必ずゴミを捨てて、椅子を元の位置に戻してください。\n\nなお、休憩室では電話はお控えください。',
    questions: [
      {
        prompt: '食事の後は何をする必要がありますか。',
        options: [
          { label: '食器をそのままにする', correct: false },
          { label: 'ゴミを捨てて椅子を元の位置に戻す', correct: true },
          { label: '電話をする', correct: false },
          { label: '寝る', correct: false },
        ],
        explanation: '「ゴミを捨てて、椅子を元の位置に戻してください」とある。',
      },
      {
        prompt: '休憩室は何時から何時まで利用できますか。',
        options: [
          { label: '終日', correct: false },
          { label: '10時から12時', correct: false },
          { label: '12時から13時', correct: true },
          { label: '15時から16時', correct: false },
        ],
        explanation: '「12時から13時まで」とある。',
      },
    ],
  },
]

export const bjtListening = [
  {
    title: '取引先への電話',
    level: 'J2',
    script: 'A：いつもお世話になっております。ABC商事の田中でございます。\nB：田中様、お電話ありがとうございます。先日お送りいただきました見積もりを拝見いたしました。\nA：ありがとうございます。いかがでしょうか。\nB：金額の面で少し検討させていただきたいのですが、納期は変更が可能でしょうか。\nA：はい、一週間程度であれば調整可能でございます。\nB：では、来週の月曜日までに再度ご連絡いたします。',
    questions: [
      {
        prompt: 'お客様は何を検討していますか。',
        options: [
          { label: '取引先を変える', correct: false },
          { label: '納期の変更を求める', correct: true },
          { label: '注文をキャンセルする', correct: false },
          { label: '人員を増やす', correct: false },
        ],
        explanation: '「納期は変更が可能でしょうか」と尋ねている。',
      },
      {
        prompt: 'お客様はいつ再連絡しますか。',
        options: [
          { label: '今週金曜日までに', correct: false },
          { label: '来週の月曜日までに', correct: true },
          { label: '来週の水曜日までに', correct: false },
          { label: '明日までに', correct: false },
        ],
        explanation: '「来週の月曜日までに再度ご連絡いたします」とある。',
      },
    ],
  },
  {
    title: '社内での稟議確認',
    level: 'J1',
    script: 'A：先週提出した新規開発の稟議書ですが、部長の承認はいただけましたか。\nB：はい、承認は得られました。ただし、予算の上限を10%削減する条件がつきました。\nA：かしこまりました。支出計画を見直し、来週水曜日までに再提出いたします。\nB：よろしくお願いします。',
    questions: [
      {
        prompt: '承認にどんな条件がつきましたか。',
        options: [
          { label: 'チームの拡大', correct: false },
          { label: '予算の上限を10%削減', correct: true },
          { label: 'プロジェクトを1か月遅らせる', correct: false },
          { label: '取引先を変える', correct: false },
        ],
        explanation: '「予算の上限を10%削減する条件がつきました」とある。',
      },
      {
        prompt: 'いつ再提出しますか。',
        options: [
          { label: '来週月曜日までに', correct: false },
          { label: '来週水曜日までに', correct: true },
          { label: '来週金曜日までに', correct: false },
          { label: '今日までに', correct: false },
        ],
        explanation: '「来週水曜日までに再提出いたします」とある。',
      },
    ],
  },
  {
    title: '会議室の予約',
    level: 'J3',
    script: 'A：すみません、来週火曜日の午後、A会議室は空いておりますでしょうか。\nB：午後でしたら、14時から16時までお使いいただけます。\nA：ありがとうございます。では、その時間でお願いいたします。\nB：承知いたしました。15名様用の椅子と、プロジェクターもご用意いたします。',
    questions: [
      {
        prompt: '何曜日の会議室を予約していますか。',
        options: [
          { label: '月曜日', correct: false },
          { label: '火曜日', correct: true },
          { label: '水曜日', correct: false },
          { label: '木曜日', correct: false },
        ],
        explanation: '「来週火曜日の午後」とある。',
      },
      {
        prompt: '何を準備しますか。',
        options: [
          { label: '飲み物', correct: false },
          { label: '椅子とプロジェクター', correct: true },
          { label: '昼食', correct: false },
          { label: 'ホワイトボード用マーカー', correct: false },
        ],
        explanation: '「15名様用の椅子と、プロジェクターもご用意いたします」とある。',
      },
    ],
  },
  {
    title: '客先訪問の報告',
    level: 'J2',
    script: 'A：先ほどS社を訪問してまいりました。\nB：お疲れ様です。反応はいかがでしたか。\nA：当初は価格面で懸念を示されていましたが、納品スケジュールを調整したことで、前向きなご検討をいただけるとのことです。\nB：そうですか。週内に見積もりの再送を行ってください。\nA：かしこまりました。',
    questions: [
      {
        prompt: '客先は最初何を懸念していましたか。',
        options: [
          { label: '納期スケジュール', correct: false },
          { label: '価格', correct: true },
          { label: '品質', correct: false },
          { label: 'アフターサービス', correct: false },
        ],
        explanation: '「当初は価格面で懸念を示されていました」とある。',
      },
      {
        prompt: '今週内に何を行う必要がありますか。',
        options: [
          { label: '再訪問する', correct: false },
          { label: '見積もりの再送を行う', correct: true },
          { label: '契約を締結する', correct: false },
          { label: '商品を納品する', correct: false },
        ],
        explanation: '「週内に見積もりの再送を行ってください」とある。',
      },
    ],
  },
  {
    title: '具合が悪いので休む',
    level: 'J4',
    script: 'A：すみません、体の調子が悪く、今日は欠勤させていただきたいのですが。\nB：大丈夫ですか。病院には行かれたほうがよろしいかと思います。\nA：はい、午後に予約を取りました。\nB：では、お大事になさってください。出勤の可否は後ほどご連絡ください。',
    questions: [
      {
        prompt: 'なぜ休みを取りますか。',
        options: [
          { label: '会議がある', correct: false },
          { label: '体調が悪い', correct: true },
          { label: '引っ越しをする', correct: false },
          { label: '休暇を取る', correct: false },
        ],
        explanation: '「体の調子が悪く、今日は欠勤させていただきたい」とある。',
      },
      {
        prompt: '後で何をするよう求められていますか。',
        options: [
          { label: '報告書を提出する', correct: false },
          { label: '出勤の可否を連絡する', correct: true },
          { label: '会議に出席する', correct: false },
          { label: '客先を訪問する', correct: false },
        ],
        explanation: '「出勤の可否は後ほどご連絡ください」とある。',
      },
    ],
  },
  {
    title: 'ボールペンを借りる',
    level: 'J5',
    script: 'A：すみません、ボールペンをお借りしてもよろしいでしょうか。\nB：はい、どうぞお使いください。\nA：ありがとうございます。\nB：用が済みましたら、受付へお返しください。',
    questions: [
      {
        prompt: '何を借りたいですか。',
        options: [
          { label: 'ノート', correct: false },
          { label: 'ペン', correct: true },
          { label: 'ホッチキス', correct: false },
          { label: '電話', correct: false },
        ],
        explanation: '「ボールペンをお借りしてもよろしいでしょうか」とある。',
      },
      {
        prompt: '使用後はどうしますか。',
        options: [
          { label: '持って帰る', correct: false },
          { label: '捨てる', correct: false },
          { label: '受付に返す', correct: true },
          { label: '上司に渡す', correct: false },
        ],
        explanation: '「受付へお返しください」とある。',
      },
    ],
  },
]

export const bjtDailyQuestions = [
  { id: 1, level: 'J1', prompt: 'Which sentence best describes a budget reduction?', options: [{ label: '予算を増やす', correct: false }, { label: '予算を削減する', correct: true }, { label: '予算を確保する', correct: false }, { label: '予算を変更しない', correct: false }], explanation: '削減 means to reduce / cut.' },
  { id: 2, level: 'J2', prompt: 'What does 納期 mean?', options: [{ label: 'Delivery date', correct: true }, { label: 'Payment date', correct: false }, { label: 'Meeting date', correct: false }, { label: 'Hiring date', correct: false }], explanation: '納期 = delivery date.' },
  { id: 3, level: 'J2', prompt: 'What is the respectful form of 食べる?', options: [{ label: 'いただく', correct: false }, { label: '召し上がる', correct: true }, { label: '申し上げる', correct: false }, { label: 'なさる', correct: false }], explanation: '召し上がる is sonkeigo for eating/drinking.' },
  { id: 4, level: 'J3', prompt: 'What does 見積もり mean?', options: [{ label: 'Estimate / quotation', correct: true }, { label: 'Receipt', correct: false }, { label: 'Contract', correct: false }, { label: 'Invoice', correct: false }], explanation: '見積もり = estimate / quotation.' },
  { id: 5, level: 'J1', prompt: 'Which word means “approval passed”?', options: [{ label: '否決', correct: false }, { label: '可決', correct: true }, { label: '保留', correct: false }, { label: '未決', correct: false }], explanation: '可決 = approval / adoption (passed).' },
  { id: 6, level: 'J3', prompt: 'What is 在庫?', options: [{ label: 'Inventory / stock', correct: true }, { label: 'Budget', correct: false }, { label: 'Revenue', correct: false }, { label: 'Report', correct: false }], explanation: '在庫 = inventory.' },
  { id: 7, level: 'J2', prompt: 'What is the humble form of 言う?', options: [{ label: 'おっしゃる', correct: false }, { label: '申す', correct: true }, { label: 'なさる', correct: false }, { label: 'いらっしゃる', correct: false }], explanation: '申す / 申し上げる is kenjougo for say.' },
  { id: 8, level: 'J1', prompt: 'What does 取締役 mean?', options: [{ label: 'Director', correct: true }, { label: 'Customer', correct: false }, { label: 'Supplier', correct: false }, { label: 'Employee', correct: false }], explanation: '取締役 = director / board member.' },
  { id: 9, level: 'J2', prompt: 'What is 売上高?', options: [{ label: 'Sales revenue', correct: true }, { label: 'Cost', correct: false }, { label: 'Profit', correct: false }, { label: 'Tax', correct: false }], explanation: '売上高 = sales revenue.' },
  { id: 10, level: 'J3', prompt: 'What is 請求書?', options: [{ label: 'Invoice / bill', correct: true }, { label: 'Receipt', correct: false }, { label: 'Quotation', correct: false }, { label: 'Approval form', correct: false }], explanation: '請求書 = invoice.' },
  { id: 11, level: 'J1', prompt: 'What does 業績 mean?', options: [{ label: 'Business performance', correct: true }, { label: 'Business trip', correct: false }, { label: 'Business card', correct: false }, { label: 'Business lunch', correct: false }], explanation: '業績 = business performance / results.' },
  { id: 12, level: 'J2', prompt: 'Which is respectful for “to see”?', options: [{ label: '拝見する', correct: false }, { label: 'ご覧になる', correct: true }, { label: 'いただく', correct: false }, { label: '参る', correct: false }], explanation: 'ご覧になる is sonkeigo for 見る.' },
  { id: 13, level: 'J3', prompt: 'What does 出張 mean?', options: [{ label: 'Business trip', correct: true }, { label: 'Overtime', correct: false }, { label: 'Resignation', correct: false }, { label: 'Promotion', correct: false }], explanation: '出張 = business trip.' },
  { id: 14, level: 'J1', prompt: 'What is 議事録?', options: [{ label: 'Meeting minutes', correct: true }, { label: 'Contract', correct: false }, { label: 'Invoice', correct: false }, { label: 'Schedule', correct: false }], explanation: '議事録 = meeting minutes.' },
  { id: 15, level: 'J2', prompt: 'What does 契約書 mean?', options: [{ label: 'Contract document', correct: true }, { label: 'Receipt', correct: false }, { label: 'Quotation', correct: false }, { label: 'Application', correct: false }], explanation: '契約書 = contract document.' },
  { id: 16, level: 'J1', prompt: 'Which phrase means “the approval is pending”?', options: [{ label: '稟議可決', correct: false }, { label: '稟議保留', correct: true }, { label: '稟議完了', correct: false }, { label: '稰議承認', correct: false }], explanation: '保留 means pending / on hold.' },
  { id: 17, level: 'J2', prompt: 'What is 株主?', options: [{ label: 'Shareholder', correct: true }, { label: 'Manager', correct: false }, { label: 'Clerk', correct: false }, { label: 'Customer', correct: false }], explanation: '株主 = shareholder.' },
  { id: 18, level: 'J3', prompt: 'What is 期日?', options: [{ label: 'Deadline / due date', correct: true }, { label: 'Starting date', correct: false }, { label: 'Holiday', correct: false }, { label: 'Budget', correct: false }], explanation: '期日 = due date.' },
  { id: 19, level: 'J2', prompt: 'What is 採用?', options: [{ label: 'Hiring / adoption', correct: true }, { label: 'Retirement', correct: false }, { label: 'Transfer', correct: false }, { label: 'Promotion', correct: false }], explanation: '採用 = hiring / adoption.' },
  { id: 20, level: 'J1', prompt: 'What is 退職?', options: [{ label: 'Resignation / retirement', correct: true }, { label: 'Employment', correct: false }, { label: 'Transfer', correct: false }, { label: 'Training', correct: false }], explanation: '退職 = retirement / resignation.' },
  { id: 21, level: 'J3', prompt: 'What does 在庫切れ mean?', options: [{ label: 'Out of stock', correct: true }, { label: 'Too much stock', correct: false }, { label: 'New stock', correct: false }, { label: 'Stock report', correct: false }], explanation: '在庫切れ = out of stock.' },
  { id: 22, level: 'J4', prompt: 'What is 名刺?', options: [{ label: 'Business card', correct: true }, { label: 'Name tag', correct: false }, { label: 'Business letter', correct: false }, { label: 'Address book', correct: false }], explanation: '名刺 = business card.' },
  { id: 23, level: 'J5', prompt: 'What is 会社?', options: [{ label: 'Company', correct: true }, { label: 'House', correct: false }, { label: 'School', correct: false }, { label: 'Hospital', correct: false }], explanation: '会社 = company.' },
  { id: 24, level: 'J4', prompt: 'What is 電話?', options: [{ label: 'Phone / call', correct: true }, { label: 'Computer', correct: false }, { label: 'Mail', correct: false }, { label: 'Fax', correct: false }], explanation: '電話 = phone.' },
  { id: 25, level: 'J3', prompt: 'What does 訪問 mean?', options: [{ label: 'Visit', correct: true }, { label: 'Move', correct: false }, { label: 'Call', correct: false }, { label: 'Report', correct: false }], explanation: '訪問 = visit.' },
  { id: 26, level: 'J4', prompt: 'What is 資料?', options: [{ label: 'Materials / document', correct: true }, { label: 'Lunch', correct: false }, { label: 'Schedule', correct: false }, { label: 'Phone', correct: false }], explanation: '資料 = materials / document.' },
  { id: 27, level: 'J5', prompt: 'What is 社員?', options: [{ label: 'Employee', correct: true }, { label: 'Customer', correct: false }, { label: 'Manager', correct: false }, { label: 'Visitor', correct: false }], explanation: '社員 = employee.' },
  { id: 28, level: 'J3', prompt: 'What is 進捗?', options: [{ label: 'Progress', correct: true }, { label: 'Budget', correct: false }, { label: 'Report', correct: false }, { label: 'Meeting', correct: false }], explanation: '進捗 = progress.' },
  { id: 29, level: 'J4', prompt: 'What is 受付?', options: [{ label: 'Reception', correct: true }, { label: 'Meeting room', correct: false }, { label: 'Kitchen', correct: false }, { label: 'Warehouse', correct: false }], explanation: '受付 = reception.' },
  { id: 30, level: 'J5', prompt: 'What is 会議室?', options: [{ label: 'Meeting room', correct: true }, { label: 'Office', correct: false }, { label: 'Break room', correct: false }, { label: 'Entrance', correct: false }], explanation: '会議室 = meeting room.' },
]

export const bjtStrategy = {
  J5: 'Master basic office nouns (会社、社員、名刺), simple keigo (です/ます), and short notices.',
  J4: 'Add 電話、訪問、資料. Read simple 社内通知 and phone call scripts.',
  J3: 'Work with 見積もり、納期、在庫、取引先 and basic business emails.',
  J2: 'Read 稟議書、議事録、契約書. Use more nuanced keigo and negotiation language.',
  J1: 'Read detailed minutes, negotiation emails, financial reports, and board-level keigo.',
}

export const bjtResources = [
  { name: 'Official BJT', url: 'https://www.kanken.or.jp/bjt/', category: 'Official', icon: '🏢' },
  { name: 'BJT Sample Questions', url: 'https://www.kanken.or.jp/bjt/sample/', category: 'Practice', icon: '📝' },
  { name: 'Business Keigo YouTube', url: 'https://www.youtube.com/results?search_query=BJT+business+keigo+Japanese', category: 'Video', icon: '🎬' },
  { name: 'BJT Listening Practice', url: 'https://www.youtube.com/results?search_query=BJT+listening+practice', category: 'Video', icon: '🎧' },
  { name: 'N2 Business Vocab', url: 'https://www.youtube.com/results?search_query=JLPT+N2+business+vocabulary', category: 'Video', icon: '📚' },
  { name: 'BJT Prep Playlist', url: 'https://www.youtube.com/results?search_query=BJT+J1+preparation', category: 'Video', icon: '📺' }
]
