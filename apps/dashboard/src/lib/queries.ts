import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { api } from "./api";
import { unwrap } from "./errors";

/** データの取得に使うキー。更新したあと、同じキー（の先頭）を無効にして、取り直す */
export const keys = {
  me: ["me"],
  settings: ["settings"],
  roles: ["roles"],
  slotHours: ["slot-hours"],
  teams: ["teams"],
  board: (date: string | undefined) => ["board", date ?? "today"],
  scores: ["scores"],
  // 「得点」の一部として、得点・勝利を変えたときに、いっしょに取り直される（キーの先頭が scores）
  teamHistory: (teamId: number) => ["scores", "team", teamId],
  wins: ["wins"],
  // 勝利を変えたときに、いっしょに取り直される（キーの先頭が wins）
  unrecordedMatches: ["wins", "unrecorded"],
  sessions: ["sessions"],
} as const;

export const useMe = () =>
  // 1 分ごとに取り直して、ヘッダーの日時を、サーバーの時計に合わせ直す
  useQuery({ queryKey: keys.me, queryFn: () => unwrap(api.me.$get()), refetchInterval: 60_000 });

export const useSettings = () =>
  useQuery({ queryKey: keys.settings, queryFn: () => unwrap(api.settings.$get()) });

export const useRoles = () =>
  useQuery({ queryKey: keys.roles, queryFn: () => unwrap(api.roles.$get()) });

export const useSlotHours = () =>
  useQuery({ queryKey: keys.slotHours, queryFn: () => unwrap(api["slot-hours"].$get()) });

export const useTeams = () =>
  useQuery({ queryKey: keys.teams, queryFn: () => unwrap(api.teams.$get()) });

/** 対戦枠の画面（日付ごと）。日付を省略すると、今日。5秒ごとに、自動で取り直す（誰かが挙手すると、すぐ出る） */
export const useBoard = (date: string | undefined) =>
  useQuery({
    queryKey: keys.board(date),
    queryFn: () => unwrap(api.board.$get({ query: date ? { date } : {} })),
    refetchInterval: 5000,
    // 日付を移すあいだも、前の日の画面を出したままにする（日付のボタンが、消えない）
    placeholderData: keepPreviousData,
  });

export const useScores = () =>
  useQuery({ queryKey: keys.scores, queryFn: () => unwrap(api.scores.$get()) });

/**
 * 勝利が未記録の組分け（マッチング済み + 試合の開始時刻を過ぎている）。時間が過ぎると増えるので、30 秒ごとに取り直す。
 * 取れなかったとき（ログイン前など）は、印も一覧も出さない。
 */
export const useUnrecordedMatches = () =>
  useQuery({
    queryKey: keys.unrecordedMatches,
    queryFn: () => unwrap(api["unrecorded-matches"].$get()),
    refetchInterval: 30_000,
  });

export const useWins = () => useQuery({ queryKey: keys.wins, queryFn: () => unwrap(api.wins.$get()) });

export const useSessions = () =>
  useQuery({ queryKey: keys.sessions, queryFn: () => unwrap(api.sessions.$get()) });

/** 更新（POST / PUT / DELETE）して、成功したら、関連するデータを取り直す */
export function useInvalidatingMutation<TVariables, TData>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  invalidate: QueryKey[],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all(invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
  });
}

/** チームごとの、全組分けと結果（チームの行を押したときの詳細）。チームを選んでいないときは、取らない */
export const useTeamHistory = (teamId: number | undefined) =>
  useQuery({
    queryKey: keys.teamHistory(teamId ?? 0),
    queryFn: () => unwrap(api.teams[":id"].history.$get({ param: { id: String(teamId) } })),
    enabled: teamId !== undefined,
  });
