export const n2Listening = [
  {
    title: '会社での打ち合わせ',
    level: 'N2',
    script: '男：来週の会議の資料は揃いましたか。\n女：はい、ほとんどできていますが、最新の売上データがまだ届いていません。\n男：それはいつ届きそうですか。\n女：明日の朝には担当の営業から送ってもらえるはずです。\n男：わかりました。それを反映させて、来週月曜日の朝までには必ず印刷して配布してください。\n女：かしこまりました。',
    questions: [
      {
        prompt: '資料はまだ何が不足していますか。',
        options: [
          { label: '会議の日程表', correct: false },
          { label: '最新の売上データ', correct: true },
          { label: '参加者の名簿', correct: false },
          { label: '来期の予算案', correct: false },
        ],
        explanation: '最新の売上データがまだ届いていないと言っている。',
      },
      {
        prompt: '資料はいつまでに配布しますか。',
        options: [
          { label: '今週金曜日まで', correct: false },
          { label: '来週月曜日の朝まで', correct: true },
          { label: '来週火曜日の午後まで', correct: false },
          { label: '明日の朝まで', correct: false },
        ],
        explanation: '来週月曜日の朝までには印刷して配布してほしいと言っている。',
      },
    ],
  },
  {
    title: '不動産屋で',
    level: 'N2',
    script: '男：このマンション、駅から徒歩7分で、南向きの部屋ですね。\n女：はい、そしてペットも一匹まで飼えます。ただし、建物の裏側は工事中で、来月まで少し騒音がするかもしれません。\n男：そうですか。家賃はいくらですか。\n女：月9万円で、共益費と駐輪場代を含みます。\n男：駐車場はありますか。\n女：はい、空きは一つだけあります。月1万5千円が追加になります。',
    questions: [
      {
        prompt: '物件について、今何が問題かもしれませんか。',
        options: [
          { label: '駅から遠い', correct: false },
          { label: '工事中の騒音', correct: true },
          { label: 'ペットが飼えない', correct: false },
          { label: '南向きではない', correct: false },
        ],
        explanation: '建物の裏側は工事中で、騒音がするかもしれないと言っている。',
      },
      {
        prompt: '駐車場を借りると、家賃にいくら追加されますか。',
        options: [
          { label: '5千円', correct: false },
          { label: '1万円', correct: false },
          { label: '1万5千円', correct: true },
          { label: '2万円', correct: false },
        ],
        explanation: '駐車場は月1万5千円追加と言っている。',
      },
    ],
  },
  {
    title: 'レストランの予約',
    level: 'N2',
    script: '女：あのう、来週金曜日の夜、5名で予約をお願いしたいのですが。\n男：かしこまりました。何時からのご予約ですか。\n女：19時でお願いします。\n男：申し訳ございませんが、19時は満席でして。18時半か20時半でしたらお席をご用意できますが。\n女：そうですか。では、20時半でお願いします。\n男：かしこまりました。コースのご予約でよろしいでしょうか。\n女：はい、6千円のコースをお願いします。',
    questions: [
      {
        prompt: '女性は何時に予約を取りましたか。',
        options: [
          { label: '18時半', correct: false },
          { label: '19時', correct: false },
          { label: '20時半', correct: true },
          { label: '21時', correct: false },
        ],
        explanation: '19時は満席だったので、20時半を選んだ。',
      },
      {
        prompt: '女性はどのコースを選びましたか。',
        options: [
          { label: '4千円のコース', correct: false },
          { label: '6千円のコース', correct: true },
          { label: '8千円のコース', correct: false },
          { label: 'まだ決めていない', correct: false },
        ],
        explanation: '6千円のコースをお願いすると言っている。',
      },
    ],
  },
]
