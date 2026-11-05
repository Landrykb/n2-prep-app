// BJT trainer items: the real BJT's Part II format — listen AND read together.
// Each item: a spoken announcement/dialogue (via TTS) + a short business
// document you must combine it with, then questions. Timed as a set.

export const bjtTrainerItems = [
{
id: 'bt1', title: '会議日程の変更', level: 'J2',
script: '田中：来週火曜日の定例会議ですが、取引先の都合で、水曜日の午後に変更になりました。資料は月曜日までに共有フォルダに入れてください。なお、出席できない方は、事前に代理の方を立ててください。',
document: '\n件名：定例会議（週次）\n日時：毎週火曜日 10:00–11:00\n場所：第2会議室\n備考：資料は前日までに共有フォルダへ。欠席の場合は代理出席が必須。',
questions: [
{ prompt: '会議はどうなりますか。', options: [{ label: '火曜日のまま行われる', correct: false}, { label: '水曜日の午後に変更になる', correct: true}, { label: '中止になる', correct: false}, { label: 'オンラインになる', correct: false}], explanation: '音声では「水曜日の午後に変更」と言っている。文書の「毎週火曜日」は通常案内で、今回は音声の変更が優先。'},
{ prompt: '出席できない人はどうしなければなりませんか。', options: [{ label: '資料だけ提出する', correct: false}, { label: '上司に電話する', correct: false}, { label: '代理の人を立てる', correct: true}, { label: '何もしなくてよい', correct: false}], explanation: '音声・文書の両方で代理出席が必要だとされている。'},
{ prompt: '資料はいつまでにどこに入れますか。', options: [{ label: '月曜日までに共有フォルダ', correct: true}, { label: '火曜日までにメール', correct: false}, { label: '水曜日までに第2会議室', correct: false}, { label: '当日、印刷して持参', correct: false}], explanation: '音声では「月曜日までに共有フォルダ」と具体的に言っている。'},
],
},
{
id: 'bt2', title: '納期の交渉', level: 'J1',
script: '佐藤：お世話になっております。先日ご注文いただいた部品ですが、工場の点検のため、納期を一週間ほど延ばしていただけないでしょうか。\n相手：来月の出荷に間に合うなら構いませんが、遅れる場合は早めに連絡ください。\n佐藤：かしこまりました。進捗は毎週金曜日にご報告いたします。',
document: '\n品目：制御部品 A-210 × 500個\n納期：今月末日（契約条件：納期変更は双方合意の上、書面にて確認）\n単価：契約書別表の通り',
questions: [
{ prompt: '佐藤がお願いしていることは何ですか。', options: [{ label: '値引き', correct: false}, { label: '納期を一週間延ばすこと', correct: true}, { label: '注文の取消し', correct: false}, { label: '数量の変更', correct: false}], explanation: '「納期を一週間ほど延ばしていただけないでしょうか」と依頼している。'},
{ prompt: '相手が承諾した条件は何ですか。', options: [{ label: '追加料金を払うこと', correct: false}, { label: '来月の出荷に間に合うこと', correct: true}, { label: '毎週報告すること', correct: false}, { label: '書面で契約し直すこと', correct: false}], explanation: '「来月の出荷に間に合うなら構いません」が相手の条件。金曜日の報告は佐藤側の提案。'},
],
},
{
id: 'bt3', title: 'クレーム対応', level: 'J1',
script: '客：昨日届いた商品が、注文と違う色なんですが。\n担当：誠に申し訳ございません。すぐに正しい商品をお送りいたします。お手元の商品は、着払いでご返送いただけますでしょうか。\n客：分かりました。いつ届きますか。\n担当：明後日までにはお届けいたします。この度はご迷惑をおかけし、申し訳ございませんでした。',
document: '\n1. まず謝罪し、代替品を最優先で発送する。\n2. 返送は着払いとし、顧客に負担をかけない。\n3. 再発防止のため、出荷担当へ同日中に報告する。',
questions: [
{ prompt: '担当者の対応で、ルールに沿っているものはどれですか。', options: [{ label: '返送を元払いにした', correct: false}, { label: '代替品を最優先で送り、返送は着払いにした', correct: true}, { label: '値引きを提案した', correct: false}, { label: '上司に代わってもらった', correct: false}], explanation: '音声の対応はルール1・2と一致している。'},
{ prompt: '正しい商品はいつ届きますか。', options: [{ label: '明日', correct: false}, { label: '明後日まで', correct: true}, { label: '来週', correct: false}, { label: '未定', correct: false}], explanation: '「明後日までにはお届けいたします」と言っている。'},
],
},
{
id: 'bt4', title: '出張報告と経費', level: 'J2',
script: '鈴木：部長、大阪出張の報告です。商談はまとまりましたが、帰りの新幹線が運休になり、一泊延びました。\n部長：お疲れさま。延泊の費用は経費で処理して。領収書を忘れずにね。\n鈴木：はい。精算書は金曜日までに提出いたします。',
document: '\n・宿泊費は実費精算（上限あり）。領収書必須。\n・精算書の提出期限：出張終了後、5営業日以内。\n・交通機関の運休など、やむを得ない延泊は事後報告で可。',
questions: [
{ prompt: '延泊した理由は何ですか。', options: [{ label: '商談が長引いたから', correct: false}, { label: '新幹線が運休になったから', correct: true}, { label: 'ホテルを予約し直したから', correct: false}, { label: '部長に指示されたから', correct: false}], explanation: '「帰りの新幹線が運休になり、一泊延びました」と言っている。'},
{ prompt: '精算のために必要なことは何ですか。', options: [{ label: '領収書を提出し、金曜日までに精算書を出す', correct: true}, { label: '来月まで待つ', correct: false}, { label: '部長の承認印だけもらう', correct: false}, { label: '延泊は自己負担にする', correct: false}], explanation: '文書では領収書必須、音声では金曜日までに精算書を提出すると約束している。'},
],
},
]
