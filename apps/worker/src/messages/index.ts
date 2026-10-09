// ユーザーに見せる文面と、チャンネルへの投稿は、このフォルダに集める。
//   channel.ts    チャンネルへの投稿（募集開始・マッチング結果・マッチングのキャンセル）。通知先（allowed_mentions）も、ここで決める
//   recruit.ts    募集開始の文面
//   matching.ts   マッチング結果・キャンセルの文面
//   status.ts     /uc-status と /uc-admin-status の文面
//   scoreboard.ts /uc-teams の文面
//   win.ts        /uc-admin-win の結果の文面
//   mention.ts    チームのロールのメンション
// ※ コマンドの、短い失敗の案内（「時刻を指定してください」など）は、処理の流れと、一緒に、各コマンドに、書いている。
export { postMatchingCancelled, postMatchingResult, postRecruit, type ChannelPoster } from "./channel";
