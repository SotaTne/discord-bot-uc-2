import type { Seed } from "./state";

/** 動作確認用の初期データ。ID は本物の Discord の ID に似せた数字の文字列 */
export function defaultSeed(): Seed {
  const role = (n: number, name: string) => ({
    id: String(400_000_000_000_000_000n + BigInt(n)),
    name,
    position: n,
  });
  const roles = [role(1, "KMU"), role(2, "UT"), role(3, "NGT"), role(4, "ITF")];
  const [kmu, ut, ngt] = roles;
  if (!kmu || !ut || !ngt) throw new Error("seed の作成に失敗しました");

  const user = (n: number, username: string, roleIds: string[], isAdmin = false) => ({
    id: String(500_000_000_000_000_000n + BigInt(n)),
    username,
    roleIds,
    isAdmin,
  });

  return {
    guildId: "200000000000000001",
    channelId: "300000000000000001",
    roles,
    users: [
      user(1, "alice (KMU)", [kmu.id]),
      user(2, "bob (KMU)", [kmu.id]),
      user(3, "carol (UT)", [ut.id]),
      user(4, "dave (NGT)", [ngt.id]),
      user(5, "admin", [], true),
    ],
  };
}
