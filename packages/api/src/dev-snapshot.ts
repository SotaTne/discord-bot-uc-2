/**
 * 開発専用: worker の「いまの状態」を、まとめて返すための型。
 * 疑似 Discord の画面（apps/mock）が、状態を常に見せるために使う。
 * worker は、開発のビルドのときだけ、これを返す（/dev/state。本番のビルドには、入らない）。
 */

/**
 * 開発用の疑似時計の状態（worker が持つ）。本物の時刻 + ずれ（offsetMs、ミリ秒。進めた分が、正）。
 * 時間は、そのまま進む（固定はしない）。
 */
export type DevClock = { offsetMs: number };

export type DevJobState = "done" | "ready" | "waiting" | "expired";

export type DevSnapshot = {
  /** この状態を作ったときの「いま」（ISO 8601。worker の時計 = 疑似時計） */
  now: string;
  /** worker の疑似時計の状態。mock が、自分の時計とずれていないか確かめるのに使う */
  clock: DevClock;
  /** 「今日」（JST, YYYY-MM-DD） */
  today: string;
  settings: {
    channelId: string | null;
    recruitHour: number;
    cutoffMinutes: number;
    fixedAfterMatches: number;
    fixedPoints: number;
  };
  /** 登録されている試合時刻 */
  slotHours: number[];
  /** 今日の対戦枠の状態（まだ作られていない対戦枠は、ない）。matched は、マッチング済みで、挙手を受け付けない */
  matchSlots: { slotHour: number; status: "open" | "matched" }[];
  teams: { id: number; name: string; roleId: string }[];
  /** 今日の挙手（取り消した挙手は、残らない）。対戦枠・挙手の順 */
  handups: {
    id: number;
    slotHour: number;
    teamId: number;
    teamName: string;
    raisedBy: string;
    createdAt: number;
  }[];
  /** チームごとの、挙手中の対戦枠・対戦数・除外された回数・勝利数・得点 */
  teamStats: {
    teamId: number;
    name: string;
    /** 今日、挙手中（取り消されていない）の対戦枠の時刻 */
    activeHandups: number[];
    /** マッチングで組まれた対戦の数（これまでの合計） */
    matches: number;
    /** 奇数で除外された回数 */
    excluded: number;
    /** 有効な勝利の数（得点のクリア以降） */
    wins: number;
    total: number;
  }[];
  /** マッチングの記録。新しい順（最大30件） */
  rounds: {
    slotDate: string;
    slotHour: number;
    createdAt: number;
    pairs: { a: string; b: string }[];
    excluded: string | null;
  }[];
  /** 勝利の記録（無効なものも含む）。新しい順（最大50件） */
  wins: {
    id: number;
    /** 勝ったチーム */
    teamName: string;
    /** 組分け（試合）の2チーム。対戦枠（日付 × 時刻）の中の、どの組分けかを表す */
    match: { a: string; b: string };
    slotDate: string;
    slotHour: number;
    points: number;
    /** 集計に使われる点数と、そのチームの何試合目か（無効な記録は null） */
    countedPoints: number | null;
    matchNumber: number | null;
    /** 有効か。無効な記録は、得点にも勝数にも数えない */
    active: boolean;
    recordedBy: string;
    createdAt: number;
    hasScreenshot: boolean;
  }[];
  /** cron で実行したジョブの履歴。新しい順（最大30件） */
  jobs: { key: string; createdAt: number }[];
  /** 今日の cron の予定と、いまの状態 */
  schedule: { key: string; label: string; from: string; until: string; state: DevJobState }[];
  dashboard: {
    /** 発行したログインリンク（新しい順） */
    links: { issuedBy: string; createdAt: number; expiresAt: number; usedAt: number | null }[];
    /** 有効なセッションの数 */
    sessions: number;
  };
  /** 保存されている画像の数 */
  screenshots: number;
};
