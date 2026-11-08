// JLPT sealed bank — N2 reading passages and listening dialogues that are
// NEVER shown in the Reading / Listening practice surfaces. A full mock
// whose fixed-text sections (reading + listening) come from this bank is
// a proof paper: the learner cannot have memorised its texts.
// (Pool law: Doc 21. The generated sections — kanji, vocab, grammar —
// are form variants of studied material by construction, like the real
// exam testing studied words; the fixed texts are what must be unseen.)
//
// Shapes mirror src/data.js `passages` and src/data/n2Listening.js so the
// mock builder consumes them unchanged. Listening entries carry
// audio: null — the mock plays the script through the voice lane.

export const sealedPassages = [
{
id: 'sr-1', title: '社内連絡：会議室の予約方法の変更', level: 'N2', time: 3,
text: '社員各位\n\n来月1日より、会議室の予約方法が変わります。これまでは総務課に電話で申し込んでいましたが、今後は社内システムから予約してください。予約は利用日の3日前まで可能です。また、予約のキャンセルもシステムから行えます。なお、10名以上で利用する場合や、プロジェクターを使う場合は、これまで通り総務課への連絡が必要です。',
glossary: [
{ word: '予約', reading: 'よやく', meaning: 'reservation'},
{ word: '総務課', reading: 'そうむか', meaning: 'general affairs section'},
],
questions: [
{
prompt: '来月から会議室はどうやって予約しますか。',
options: [
{ label: '総務課に電話する', correct: false},
{ label: '社内システムから予約する', correct: true},
{ label: '総務課に行って申し込む', correct: false},
{ label: 'メールで申し込む', correct: false},
],
explanation: '「今後は社内システムから予約してください」とある。',
},
],
},
{
id: 'sr-2', title: '図書館からのお知らせ', level: 'N2', time: 3,
text: '市立図書館では、来月から開館時間を変更いたします。平日は午前9時から午後8時まで、土日・祝日は午前9時から午後6時までとなります。また、毎週月曜日は休館日でしたが、来月からは第2・第4月曜日のみ休館いたします。貸出期間や貸出冊数に変更はありません。',
glossary: [
{ word: '開館', reading: 'かいかん', meaning: 'opening (of a library/facility)'},
{ word: '休館日', reading: 'きゅうかんび', meaning: 'closed day'},
],
questions: [
{
prompt: '来月から、図書館が休みになるのはいつですか。',
options: [
{ label: '毎週月曜日', correct: false},
{ label: '第2・第4月曜日', correct: true},
{ label: '土日・祝日', correct: false},
{ label: '平日の夜', correct: false},
],
explanation: '「来月からは第2・第4月曜日のみ休館」とある。',
},
],
},
{
id: 'sr-3', title: '地域の商店街と大型店', level: 'N2', time: 6,
text: '近年、郊外に大型のショッピングセンターが増え、地域の商店街から客足が遠のいている。しかし、すべての商店街が衰退しているわけではない。商店街の中には、大型店にはない魅力を生かして客を集めているところもある。例えば、店主が客の顔と好みを覚えていて、一人一人に合った商品を勧める商店街では、高齢者を中心に根強い人気がある。また、商店街全体でイベントを開き、若い世代を呼び込む工夫をしている例も見られる。大型店の便利さに対抗するには、地域に根ざした関係の深さこそが商店街の強みだと言えるだろう。',
glossary: [
{ word: '客足', reading: 'きゃくあし', meaning: 'customer traffic'},
{ word: '衰退', reading: 'すいたい', meaning: 'decline'},
{ word: '根強い', reading: 'ねづよい', meaning: 'deep-rooted / strong'},
],
questions: [
{
prompt: 'この文章によると、客を集めている商店街には何がありますか。',
options: [
{ label: '大型店より安い値段', correct: false},
{ label: '大型店にはない魅力', correct: true},
{ label: '広い駐車場', correct: false},
{ label: '長い営業時間', correct: false},
],
explanation: '「大型店にはない魅力を生かして客を集めている」とある。',
},
{
prompt: '筆者は商店街の強みは何だと言っていますか。',
options: [
{ label: '商品の安さ', correct: false},
{ label: 'イベントの多さ', correct: false},
{ label: '地域に根ざした関係の深さ', correct: true},
{ label: '店の新しさ', correct: false},
],
explanation: '最後に「地域に根ざした関係の深さこそが商店街の強み」と述べている。',
},
],
},
{
id: 'sr-4', title: '働く人の睡眠', level: 'N2', time: 6,
text: '睡眠不足は、仕事の効率を下げる大きな原因だと言われている。ある調査では、睡眠時間が6時間未満の人は、7時間以上眠る人に比べて、仕事中のミスが約1.5倍多いという結果が出た。にもかかわらず、忙しさを理由に睡眠を削る人は少なくない。専門家は、睡眠時間を確保するためには、寝る時刻を決めるより、起きる時刻を一定にすることが効果的だと指摘する。起きる時刻が一定になれば、自然と眠くなる時刻も安定し、無理なく眠りに入れるからだ。',
glossary: [
{ word: '効率', reading: 'こうりつ', meaning: 'efficiency'},
{ word: '確保', reading: 'かくほ', meaning: 'securing / ensuring'},
],
questions: [
{
prompt: '調査では、睡眠時間が6時間未満の人について何が分かりましたか。',
options: [
{ label: '仕事中のミスが約1.5倍多い', correct: true},
{ label: '仕事の効率が上がる', correct: false},
{ label: '早く起きられる', correct: false},
{ label: '疲れが取れやすい', correct: false},
],
explanation: '「仕事中のミスが約1.5倍多いという結果が出た」とある。',
},
{
prompt: '専門家は睡眠時間を確保するために何が効果的だと言っていますか。',
options: [
{ label: '寝る時刻を決めること', correct: false},
{ label: '起きる時刻を一定にすること', correct: true},
{ label: '昼寝をすること', correct: false},
{ label: '休日に長く眠ること', correct: false},
],
explanation: '「起きる時刻を一定にすることが効果的だ」と指摘している。',
},
],
},
{
id: 'sr-5', title: '手紙の役割', level: 'N2', time: 8,
text: 'メールやSNSが当たり前になった今、手紙を書く機会は大きく減った。しかし、手紙には電子的な連絡手段にはない価値があると考える人は少なくない。\n第一に、手紙は相手のことを考えて書く時間が長い。文を考え、言葉を選び、時には書き直す。その過程で、相手への気持ちが整理される。第二に、手紙は形として残る。もらった手紙を数年後に読み返し、当時の気持ちを思い出す人も多い。\nもちろん、速さや便利さではメールにかなわない。大切なのは、連絡の目的によって手段を使い分けることだろう。急ぎの連絡はメールで、感謝や謝罪など気持ちを伝えたいときは手紙で、というように。手紙が完全になくなることはないと筆者は考える。',
glossary: [
{ word: '手段', reading: 'しゅだん', meaning: 'means / method'},
{ word: '過程', reading: 'かてい', meaning: 'process'},
{ word: '使い分ける', reading: 'つかいわける', meaning: 'to use appropriately for each case'},
],
questions: [
{
prompt: '手紙の価値として、文章で挙げられているものは何ですか。',
options: [
{ label: '速く届くこと', correct: false},
{ label: '書く過程で気持ちが整理され、形として残ること', correct: true},
{ label: 'お金がかからないこと', correct: false},
{ label: '何度も送り直せること', correct: false},
],
explanation: '第一に気持ちの整理、第二に形として残ることが挙げられている。',
},
{
prompt: '筆者は連絡手段についてどう考えていますか。',
options: [
{ label: '手紙だけを使うべきだ', correct: false},
{ label: 'メールだけを使うべきだ', correct: false},
{ label: '目的によって使い分けることが大切だ', correct: true},
{ label: 'どちらも使うべきではない', correct: false},
],
explanation: '「連絡の目的によって手段を使い分けること」が大切だと述べている。',
},
{
prompt: 'この文章の結論として最も合うものはどれですか。',
options: [
{ label: '手紙は完全になくなるだろう', correct: false},
{ label: '手紙が完全になくなることはないだろう', correct: true},
{ label: 'メールはもう使われないだろう', correct: false},
{ label: '手紙は仕事に使えない', correct: false},
],
explanation: '最後に「手紙が完全になくなることはないと筆者は考える」とある。',
},
],
},
{
id: 'sr-6', title: '市営プールのご案内', level: 'N2', time: 5,
text: '\n開館期間：7月1日〜8月31日\n開館時間：午前9時〜午後6時（受付は午後5時まで）\n料金：大人 600円 / 中学生以下 300円\n回数券（11枚つづり）：大人 6,000円\n※小学生以下のお子様は、保護者の同伴が必要です。\n※8月15日はイベントのため、午後3時で閉館します。',
glossary: [
{ word: '回数券', reading: 'かいすうけん', meaning: 'book of tickets'},
{ word: '同伴', reading: 'どうはん', meaning: 'accompaniment'},
],
questions: [
{
prompt: '大人が回数券を買うと、1回あたりいくらになりますか。',
options: [
{ label: '600円', correct: false},
{ label: '約545円', correct: true},
{ label: '500円', correct: false},
{ label: '300円', correct: false},
],
explanation: '6,000円で11回分なので、1回あたり約545円になる。',
},
{
prompt: '8月15日にプールを利用したい人は何に注意しなければなりませんか。',
options: [
{ label: '受付が午後5時までであること', correct: false},
{ label: '午後3時で閉館すること', correct: true},
{ label: '保護者の同伴が必要なこと', correct: false},
{ label: '料金が高くなること', correct: false},
],
explanation: '「8月15日はイベントのため、午後3時で閉館」とある。',
},
],
},
]

export const sealedListening = [
{
id: 'sl-1', title: '出張の変更', level: 'N2', audio: null,
script: '女：課長、来週の大阪出張の件ですが、取引先から連絡があり、会議が水曜日から木曜日に変更になりました。\n男：そうですか。では、ホテルと新幹線の予約を変更してください。帰りは金曜日のままでいいです。\n女：かしこまりました。ホテルは1泊延ばす形で変更します。新幹線は行きの便だけ変えますね。\n男：お願いします。それから、木曜日の会議の資料は、火曜日までに用意してください。',
questions: [
{
prompt: '女性はこの後、何をしなければなりませんか。',
options: [
{ label: '会議の日程を取引先と相談する', correct: false},
{ label: 'ホテルと新幹線の予約を変更する', correct: true},
{ label: '出張をキャンセルする', correct: false},
{ label: '会議の資料を印刷する', correct: false},
],
explanation: '「ホテルと新幹線の予約を変更してください」と頼まれている。',
},
{
prompt: '会議の資料はいつまでに用意しますか。',
options: [
{ label: '水曜日まで', correct: false},
{ label: '木曜日まで', correct: false},
{ label: '火曜日まで', correct: true},
{ label: '金曜日まで', correct: false},
],
explanation: '「火曜日までに用意してください」とある。',
},
],
},
{
id: 'sl-2', title: 'アルバイトの面接', level: 'N2', audio: null,
script: '男：来週からアルバイトを始めたいんですが、週に何日まで働けますか。\n女：当店では週4日までお願いしています。土日は忙しいので、どちらか1日は入っていただけると助かります。\n男：分かりました。平日は大学の授業があるので、夕方5時からなら大丈夫です。\n女：では、月曜日と水曜日の夕方、それに土曜日でどうですか。\n男：はい、それでお願いします。',
questions: [
{
prompt: 'この店ではアルバイトは週に何日まで働けますか。',
options: [
{ label: '週3日まで', correct: false},
{ label: '週4日まで', correct: true},
{ label: '週5日まで', correct: false},
{ label: '毎日でもよい', correct: false},
],
explanation: '「当店では週4日までお願いしています」とある。',
},
{
prompt: '男性はどの曜日に入ることになりそうですか。',
options: [
{ label: '月曜日、水曜日、日曜日', correct: false},
{ label: '火曜日、木曜日、土曜日', correct: false},
{ label: '月曜日、水曜日、土曜日', correct: true},
{ label: '平日は毎日', correct: false},
],
explanation: '「月曜日と水曜日の夕方、それに土曜日」と提案され、男性が承諾している。',
},
],
},
{
id: 'sl-3', title: '天気予報', level: 'N2', audio: null,
script: '女：明日の天気をお伝えします。午前中は各地で晴れるでしょう。午後は山沿いを中心に雲が広がり、夕方からは雨の降るところもありそうです。気温は今日より2度ほど高くなり、過ごしやすい一日になるでしょう。ただし、夜は北風が強まりますので、お帰りの際は暖かい服装でお出かけください。',
questions: [
{
prompt: '明日の午後はどうなると言っていますか。',
options: [
{ label: '各地で晴れる', correct: false},
{ label: '山沿いを中心に雲が広がる', correct: true},
{ label: '雪が降る', correct: false},
{ label: '気温が下がる', correct: false},
],
explanation: '「午後は山沿いを中心に雲が広がり」とある。',
},
{
prompt: '夜について、何に注意するよう言っていますか。',
options: [
{ label: '雨に注意する', correct: false},
{ label: '北風が強まるので暖かい服装にする', correct: true},
{ label: '早く帰る', correct: false},
{ label: '傘を持って出かける', correct: false},
],
explanation: '「夜は北風が強まりますので…暖かい服装で」とある。',
},
],
},
{
id: 'sl-4', title: '即時応答 1', level: 'N2', audio: null,
script: '女：すみません、この書類、コピーをお願いできますか。\n男：はい、ただいま。何部必要ですか。',
questions: [
{
prompt: '男性は何を聞いていますか。',
options: [
{ label: 'コピーの色', correct: false},
{ label: '必要な部数', correct: true},
{ label: '書類の内容', correct: false},
{ label: '提出の期限', correct: false},
],
explanation: '「何部必要ですか」と部数を聞いている。',
},
],
},
{
id: 'sl-5', title: '即時応答 2', level: 'N2', audio: null,
script: '男：明日の会議、資料の準備はできていますか。\n女：すみません、あと少しで終わります。3時までにはお持ちします。',
questions: [
{
prompt: '女性は資料をいつ持ってきますか。',
options: [
{ label: '今すぐ', correct: false},
{ label: '3時までに', correct: true},
{ label: '明日の会議で', correct: false},
{ label: '夕方までに', correct: false},
],
explanation: '「3時までにはお持ちします」とある。',
},
],
},
{
id: 'sl-6', title: '即時応答 3', level: 'N2', audio: null,
script: '女：駅までどうやって行けばいいですか。\n男：バスが便利ですよ。3番乗り場から出ています。',
questions: [
{
prompt: '男性は何を勧めていますか。',
options: [
{ label: 'タクシーに乗ること', correct: false},
{ label: '歩いて行くこと', correct: false},
{ label: '3番乗り場からバスに乗ること', correct: true},
{ label: '電車に乗ること', correct: false},
],
explanation: '「バスが便利ですよ。3番乗り場から出ています」とある。',
},
],
},
{
id: 'sl-7', title: '即時応答 4', level: 'N2', audio: null,
script: '男：来週の歓迎会、店はもう決めましたか。\n女：はい、駅前の店を予約しました。20人まで入れるそうです。',
questions: [
{
prompt: '歓迎会について決まっていることは何ですか。',
options: [
{ label: '店を予約したこと', correct: true},
{ label: '参加者の人数', correct: false},
{ label: '開始の時間', correct: false},
{ label: '料理の内容', correct: false},
],
explanation: '「駅前の店を予約しました」とある。',
},
],
},
]
