export const bjtScoreMapping = [
  { bjt: 'J1+', score: '600 – 800', jlpt: '≈ N1 / advanced', color: 'emerald' },
  { bjt: 'J1', score: '530 – 599', jlpt: '≈ N2', color: 'cyan' },
  { bjt: 'J2', score: '420 – 529', jlpt: '≈ N3', color: 'violet' },
  { bjt: 'J3', score: '320 – 419', jlpt: '≈ N4', color: 'amber' },
  { bjt: 'J4', score: '200 – 319', jlpt: '≈ N5', color: 'rose' },
  { bjt: 'J5', score: '0 – 199', jlpt: 'Beginner', color: 'slate' },
]

export const bjtKeigo = [
  { plain: '見る', sonkei: 'ご覧になる', kenjou: '拝見する', scene: 'Looking at a document' },
  { plain: '言う', sonkei: 'おっしゃる', kenjou: '申す / 申し上げる', scene: 'Saying / telling' },
  { plain: '知る', sonkei: '存じる / 存じ上げる', kenjou: '存じる', scene: 'Knowing (internal)' },
  { plain: '食べる', sonkei: '召し上がる', kenjou: 'いただく', scene: 'Eating / drinking' },
  { plain: '行く', sonkei: 'いらっしゃる / おいでになる', kenjou: '参る / 伺う', scene: 'Going somewhere' },
  { plain: '来る', sonkei: 'いらっしゃる / お越しになる', kenjou: '参る', scene: 'Coming' },
  { plain: 'する', sonkei: 'なさる', kenjou: 'いたす', scene: 'Doing' },
  { plain: 'いる', sonkei: 'いらっしゃる', kenjou: 'おる', scene: 'Being (somewhere)' },
]

export const bjtVocab = [
  { word: '稟議書', reading: 'りんぎしょ', meaning: 'Approval request form (business document)' },
  { word: '決算', reading: 'けっさん', meaning: 'Financial settlement / closing accounts' },
  { word: '見積もり', reading: 'みつもり', meaning: 'Quotation / estimate' },
  { word: '納期', reading: 'のうき', meaning: 'Delivery date' },
  { word: '在庫', reading: 'ざいこ', meaning: 'Inventory / stock' },
  { word: '売上高', reading: 'うりあげだか', meaning: 'Sales revenue' },
  { word: '取引先', reading: 'とりひきさき', meaning: 'Business partner / client' },
  { word: '勤怠', reading: 'きんたい', meaning: 'Attendance / work hours' },
  { word: '予算', reading: 'よさん', meaning: 'Budget' },
  { word: '会議', reading: 'かいぎ', meaning: 'Meeting' },
  { word: '商談', reading: 'しょうだん', meaning: 'Business negotiation' },
  { word: '契約書', reading: 'けいやくしょ', meaning: 'Contract document' },
  { word: '請求書', reading: 'せいきゅうしょ', meaning: 'Invoice / bill' },
  { word: '領収書', reading: 'りょうしゅうしょ', meaning: 'Receipt' },
  { word: '社内', reading: 'しゃない', meaning: 'Within the company' },
]

export const bjtReading = {
  title: '社内メール：出張の稟議',
  level: 'J1',
  time: 3,
  text: '山田部長、\n\n来月の東京出張について、以下の通り稟議書を提出いたします。\n\n日程：12月15日（水）〜17日（金）\n目的：新規取引先との契約交渉\n予算：交通費及び宿泊費を含め、約15万円\n\n現地の営業担当者と直接面談し、来期の納期及び価格条件について合意した後、契約書の草案を作成する予定です。\n\n何かご不明な点がございましたら、お手数ですがご連絡ください。',
  questions: [
    {
      prompt: 'What is the main purpose of the trip?',
      options: [
        { label: 'To sign the final contract.', correct: false },
        { label: 'To negotiate with a new business partner.', correct: true },
        { label: 'To inspect the factory.', correct: false },
        { label: 'To interview candidates.', correct: false },
      ],
      explanation: 'The email says 新規取引先との契約交渉, meaning negotiation with a new business partner.',
    },
    {
      prompt: 'Approximately how much is the budget?',
      options: [
        { label: '50,000 yen', correct: false },
        { label: '100,000 yen', correct: false },
        { label: '150,000 yen', correct: true },
        { label: '200,000 yen', correct: false },
      ],
      explanation: 'The budget is listed as 約15万円, about 150,000 yen.',
    },
  ],
}

export const bjtListening = {
  title: '取引先への電話',
  level: 'J1',
  script: 'A：いつもお世話になっております。ABC商事の田中でございます。\nB：田中様、お電話ありがとうございます。先日お送りいただきました見積もりを拝見いたしました。\nA：ありがとうございます。いかがでしょうか。\nB：金額の面で少し検討させていただきたいのですが、納期は変更が可能でしょうか。\nA：はい、一週間程度であれば調整可能でございます。\nB：では、来週の月曜日までに再度ご連絡いたします。',
  questions: [
    {
      prompt: 'What is the customer considering?',
      options: [
        { label: 'Changing the supplier.', correct: false },
        { label: 'Asking for a faster delivery date.', correct: true },
        { label: 'Canceling the order.', correct: false },
        { label: 'Hiring more staff.', correct: false },
      ],
      explanation: 'The customer says 納期は変更が可能でしょうか, asking if the delivery date can be changed.',
    },
    {
      prompt: 'When will the customer contact them again?',
      options: [
        { label: 'This Friday', correct: false },
        { label: 'Next Monday', correct: true },
        { label: 'Next Wednesday', correct: false },
        { label: 'Tomorrow', correct: false },
      ],
      explanation: 'The customer says 来週の月曜日までに再度ご連絡いたします, by next Monday.',
    },
  ],
}

export const bjtResources = [
  { name: 'Official BJT', url: 'https://www.kanken.or.jp/bjt/', category: 'Official', icon: '🏢' },
  { name: 'BJT Sample Questions', url: 'https://www.kanken.or.jp/bjt/sample/', category: 'Practice', icon: '📝' },
  { name: 'Business Keigo Guide', url: 'https://www3.nhk.or.jp/nhkworld/en/radio/lesson/', category: 'Audio', icon: '🎧' },
]
