// Additional listening dialogues across N5–N1, same shape as n2Listening.js
// ({ title, level, script, questions }). Merged into the listening view.

export const listeningPlus = [
  {
    title: 'コンビニで',
    audio: 'https://rcckuxwvqgtyvovwpxaw.supabase.co/storage/v1/object/public/listening-audio/konbini.m4a', level: 'N5',
    script: '店員：いらっしゃいませ。\n客：すみません、おにぎりはどこですか。\n店員：あちらの棚です。飲み物もいかがですか。\n客：じゃあ、お茶もください。全部でいくらですか。\n店員：450円です。袋は要りますか。\n客：はい、お願いします。',
    questions: [
      { prompt: '客は何を買いますか。', options: [{ label: 'おにぎりだけ', correct: false }, { label: 'おにぎりとお茶', correct: true }, { label: 'お茶だけ', correct: false }, { label: 'パンとお茶', correct: false }], explanation: 'おにぎりとお茶を買う。' },
      { prompt: '全部でいくらですか。', options: [{ label: '350円', correct: false }, { label: '400円', correct: false }, { label: '450円', correct: true }, { label: '540円', correct: false }], explanation: '450円だと言っている。' },
    ],
  },
  {
    title: '友達との約束',
    audio: 'https://rcckuxwvqgtyvovwpxaw.supabase.co/storage/v1/object/public/listening-audio/tomodachi-yakusoku.m4a', level: 'N5',
    script: '女：明日、映画を見に行きませんか。\n男：いいですね。何時に会いますか。\n女：10時に駅の前で会いましょう。\n男：分かりました。遅れないで行きます。',
    questions: [
      { prompt: '二人は明日何をしますか。', options: [{ label: '映画を見に行く', correct: true }, { label: '買い物に行く', correct: false }, { label: '勉強する', correct: false }, { label: '電車に乗る', correct: false }], explanation: '映画を見に行く約束をしている。' },
      { prompt: '何時にどこで会いますか。', options: [{ label: '9時に駅の中', correct: false }, { label: '10時に駅の前', correct: true }, { label: '10時に映画館', correct: false }, { label: '11時に駅の前', correct: false }], explanation: '10時に駅の前で会う。' },
    ],
  },
  {
    title: '道を聞く',
    audio: 'https://rcckuxwvqgtyvovwpxaw.supabase.co/storage/v1/object/public/listening-audio/michi-kiku.m4a', level: 'N4',
    script: '女：すみません、郵便局はどこですか。\n男：この道をまっすぐ行って、二つ目の信号を右に曲がると、左側にあります。\n女：ここから遠いですか。\n男：歩いて5分ぐらいです。銀行の隣ですよ。',
    questions: [
      { prompt: '郵便局はどこにありますか。', options: [{ label: '一つ目の信号の右側', correct: false }, { label: '二つ目の信号を曲がった左側', correct: true }, { label: '駅の前', correct: false }, { label: '銀行の中', correct: false }], explanation: '二つ目の信号を右に曲がると左側にある。' },
      { prompt: 'ここから郵便局までどうやって行きますか。', options: [{ label: 'バスで5分', correct: false }, { label: '歩いて5分ぐらい', correct: true }, { label: '電車で5分', correct: false }, { label: '歩いて15分ぐらい', correct: false }], explanation: '歩いて5分ぐらいだと言っている。' },
    ],
  },
  {
    title: 'アルバイトの電話',
    audio: 'https://rcckuxwvqgtyvovwpxaw.supabase.co/storage/v1/object/public/listening-audio/arubaito-denwa.m4a', level: 'N4',
    script: '女：もしもし、アルバイトの募集を見て電話しました。\n店長：ありがとうございます。週に何日ぐらい働けますか。\n女：学校があるので、週に3日、夕方から働けます。\n店長：では、面接はいつがいいですか。金曜日の4時はいかがですか。\n女：はい、大丈夫です。履歴書を持って行きます。',
    questions: [
      { prompt: '女性は週に何日働けますか。', options: [{ label: '毎日', correct: false }, { label: '週に2日', correct: false }, { label: '週に3日', correct: true }, { label: '週に5日', correct: false }], explanation: '学校があるので週に3日だけ働ける。' },
      { prompt: '面接はいつですか。', options: [{ label: '金曜日の4時', correct: true }, { label: '金曜日の3時', correct: false }, { label: '木曜日の4時', correct: false }, { label: 'まだ決まっていない', correct: false }], explanation: '金曜日の4時に面接をする。' },
    ],
  },
  {
    title: '旅行の計画',
    audio: 'https://rcckuxwvqgtyvovwpxaw.supabase.co/storage/v1/object/public/listening-audio/ryoko-keikaku.m4a', level: 'N3',
    script: '男：夏休み、北海道へ旅行しない？\n女：いいね。飛行機と電車、どっちがいいかな。\n男：飛行機の方が速いけど、高いよ。早めに予約すれば安くなるらしい。\n女：じゃあ、今週中に予約しよう。ホテルは駅の近くが便利だね。',
    questions: [
      { prompt: '二人はどうやって北海道へ行くことにしそうですか。', options: [{ label: '電車', correct: false }, { label: '飛行機', correct: true }, { label: '船', correct: false }, { label: '車', correct: false }], explanation: '飛行機を早めに予約すれば安くなると話している。' },
      { prompt: 'ホテルはどこがいいと言っていますか。', options: [{ label: '海の近く', correct: false }, { label: '空港の近く', correct: false }, { label: '駅の近く', correct: true }, { label: '安ければどこでもいい', correct: false }], explanation: '駅の近くが便利だと言っている。' },
    ],
  },
  {
    title: '健康診断の結果',
    audio: 'https://rcckuxwvqgtyvovwpxaw.supabase.co/storage/v1/object/public/listening-audio/kenko-shindan.m4a', level: 'N3',
    script: '医者：検査の結果ですが、少し血圧が高めですね。\n男：薬を飲んだ方がいいですか。\n医者：今はまだ大丈夫です。塩分を控えて、毎日少し運動してください。\n男：分かりました。次の検査はいつですか。\n医者：3か月後にまた来てください。',
    questions: [
      { prompt: '医者は男の人に何をするように言いましたか。', options: [{ label: '薬を飲むこと', correct: false }, { label: '塩分を控えて運動すること', correct: true }, { label: '仕事を休むこと', correct: false }, { label: 'すぐ入院すること', correct: false }], explanation: '薬はまだ不要で、塩分を控えて運動するように言っている。' },
      { prompt: '次の検査はいつですか。', options: [{ label: '来週', correct: false }, { label: '来月', correct: false }, { label: '3か月後', correct: true }, { label: '1年後', correct: false }], explanation: '3か月後に来るように言っている。' },
    ],
  },
  {
    title: '引っ越しの相談',
    audio: 'https://rcckuxwvqgtyvovwpxaw.supabase.co/storage/v1/object/public/listening-audio/hikkoshi-sodan.m4a', level: 'N2',
    script: '女：来月、職場の近くに引っ越そうと思っているんです。\n男：家賃は今より高くなりませんか。\n女：少し高くなりますが、通勤時間が短くなるので、その分、資格の勉強に使えます。\n男：なるほど。更新料や礼金のことも考えると、最初の費用は結構かかりますよ。',
    questions: [
      { prompt: '女性が引っ越したい一番の理由は何ですか。', options: [{ label: '家賃が安くなるから', correct: false }, { label: '通勤時間を勉強に使いたいから', correct: true }, { label: '部屋が広くなるから', correct: false }, { label: '職場に近い友達がいるから', correct: false }], explanation: '通勤時間が短くなり、その分を資格の勉強に使えると言っている。' },
      { prompt: '男性が心配していることは何ですか。', options: [{ label: '引っ越しの手続き', correct: false }, { label: '最初の費用がかかること', correct: true }, { label: '通勤が遠くなること', correct: false }, { label: '近所の騒音', correct: false }], explanation: '更新料や礼金で最初の費用が結構かかると言っている。' },
    ],
  },
  {
    title: '会議の日程変更',
    audio: 'https://rcckuxwvqgtyvovwpxaw.supabase.co/storage/v1/object/public/listening-audio/kaigi-nittei.m4a', level: 'N1',
    script: '女：来週の定例会議ですが、部長が出張から戻れないため、木曜日への変更を余儀なくされました。\n男：木曜日は取引先との打ち合わせが入っています。重なってしまいますね。\n女：では、打ち合わせの後に回すか、来週に延期するか、どちらかで調整しましょう。資料は変更前に配布しておいてください。',
    questions: [
      { prompt: '会議が変更になった理由は何ですか。', options: [{ label: '資料が間に合わないから', correct: false }, { label: '部長が出張から戻れないから', correct: true }, { label: '会議室が使えないから', correct: false }, { label: '取引先の都合', correct: false }], explanation: '部長が出張から戻れないため変更を余儀なくされた。' },
      { prompt: '資料については何と言っていますか。', options: [{ label: '変更後に作り直すこと', correct: false }, { label: '配布しないこと', correct: false }, { label: '変更前に配布しておくこと', correct: true }, { label: '取引先に送ること', correct: false }], explanation: '資料は変更前に配布しておくように言っている。' },
    ],
  },
  {
    title: '環境問題のニュース',
    audio: 'https://rcckuxwvqgtyvovwpxaw.supabase.co/storage/v1/object/public/listening-audio/kankyo-news.m4a', level: 'N1',
    script: 'アナウンサー：市は来年度から、プラスチックごみの分別をより厳格化する方針を明らかにしました。背景には、リサイクル率の伸び悩みがあります。市民からは利便性の低下を懸念する声も上がっていますが、市は説明会を通じて理解を求めていく考えです。',
    questions: [
      { prompt: '市が来年度から行うことは何ですか。', options: [{ label: 'ごみ収集を有料化する', correct: false }, { label: 'プラスチックごみの分別を厳しくする', correct: true }, { label: 'リサイクルをやめる', correct: false }, { label: '説明会を中止する', correct: false }], explanation: '分別の厳格化方針を明らかにしたと言っている。' },
      { prompt: '市民が心配していることは何ですか。', options: [{ label: 'リサイクル率が上がること', correct: false }, { label: '不便になること', correct: true }, { label: '説明会が開かれないこと', correct: false }, { label: '費用が高くなること', correct: false }], explanation: '利便性の低下を懸念する声が上がっている。' },
    ],
  },
  {
    title: '新しい制度の説明',
    audio: 'https://rcckuxwvqgtyvovwpxaw.supabase.co/storage/v1/object/public/listening-audio/seido-setsumei.m4a', level: 'N1',
    script: '男：今回の制度改正は、一見すると手続きの簡素化に見えますが、実は申請者の負担が増える側面もあります。\n女：とおっしゃいますと。\n男：従来は窓口で済んだ確認が、事前にオンラインで完結させなければならない。デジタルに不慣れな方への配慮が不可欠でしょう。',
    questions: [
      { prompt: '男性は制度改正についてどう考えていますか。', options: [{ label: '完全に良い改正だ', correct: false }, { label: '便利になる反面、負担が増える面もある', correct: true }, { label: '何も変わらない', correct: false }, { label: '廃止すべきだ', correct: false }], explanation: '簡素化に見えるが申請者の負担が増える側面もあると言っている。' },
      { prompt: '男性が不可欠だと言っていることは何ですか。', options: [{ label: '窓口を増やすこと', correct: false }, { label: 'オンライン化をやめること', correct: false }, { label: 'デジタルに不慣れな人への配慮', correct: true }, { label: '申請期限を延ばすこと', correct: false }], explanation: 'デジタルに不慣れな方への配慮が不可欠だと言っている。' },
    ],
  },
]
