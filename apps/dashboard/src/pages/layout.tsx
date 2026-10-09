import { useEffect, useState } from "react";
import { Box, Button, Container, Group, Loader, Paper, Stack, Text, Title } from "@mantine/core";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { ApiError, unwrap } from "../lib/errors";
import { formatJstNow } from "../lib/format";
import { useMe, useUnrecordedMatches } from "../lib/queries";
import { ErrorNote } from "../components/ui";

const NAV = [
  { to: "/", label: "対戦枠" },
  { to: "/teams", label: "チーム" },
  { to: "/wins", label: "勝利記録" },
  { to: "/settings", label: "設定" },
] as const;

/**
 * いまの日時（JST）。サーバーの時計を基準にして、そこからの経過を足して進める（開発用に時計を動かしているときも、それに従う）。
 * 取得し直したときに、サーバーの時計に合わせ直す。
 */
function Now({ serverNow, fetchedAt }: { serverNow: number; fetchedAt: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 5_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Text size="sm" c="dimmed" aria-label="現在の日時" style={{ whiteSpace: "nowrap" }}>
      {formatJstNow(new Date(serverNow + (Date.now() - fetchedAt)))}
    </Text>
  );
}

/** ログイン済みの画面の枠（レイアウト）。ログインしていなければ、入り方を案内する */
export function AppLayout() {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const logout = useMutation({
    mutationFn: () => unwrap(api.logout.$post()),
    onSuccess: async () => {
      queryClient.clear();
      await navigate({ to: "/login", hash: "" });
    },
  });

  // 勝利を記録しないといけない組分けの数。あれば、「勝利記録」に、赤い丸の印で知らせる
  const unrecorded = useUnrecordedMatches().data?.matches.length ?? 0;

  const pathname = useRouterState({ select: (state) => state.location.pathname });

  if (me.isPending) return <Loader size="sm" m="xl" mx="auto" display="block" aria-label="読み込み中…" />;

  if (me.isError) {
    const unauthorized = me.error instanceof ApiError && me.error.status === 401;
    return (
      <Container size="xs" mt="xl">
        <Paper className="surface" p="md">
          <Stack>
            <Title order={1} size="h3">
              UC ダッシュボード
            </Title>
            {unauthorized ? (
              <Text role="alert">
                ログインしていません。Discord で <code>/uc-admin-dashboard</code> を実行して、発行されたリンクから入ってください。
              </Text>
            ) : (
              <ErrorNote error={me.error} />
            )}
          </Stack>
        </Paper>
      </Container>
    );
  }

  return (
    <>
      <a className="skip-link" href="#main">
        本文へ移動
      </a>
      <Box component="header" px="md" className="surface" style={{ borderRadius: 0, borderWidth: "0 0 1px 0" }}>
        <Group justify="space-between" gap="md" maw={1040} mx="auto" wrap="nowrap">
          <Group gap="lg" wrap="nowrap">
            <Text fw={600} style={{ whiteSpace: "nowrap" }}>
              UC ダッシュボード
            </Text>
            <Group component="nav" aria-label="メニュー" gap={0} wrap="nowrap">
              {NAV.map((item) => {
                const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
                return (
                  <Link key={item.to} to={item.to} className="nav-link" {...(active ? { "aria-current": "page" as const } : {})}>
                    {item.label}
                    {item.to === "/wins" && unrecorded > 0 && (
                      <>
                        <span className="nav-badge" aria-hidden="true">
                          {unrecorded > 99 ? "99+" : unrecorded}
                        </span>
                        <span className="sr-only">（勝利が未記録の組分け {unrecorded}件）</span>
                      </>
                    )}
                  </Link>
                );
              })}
            </Group>
          </Group>
          <Group gap="md" wrap="nowrap">
            <Now serverNow={me.data.now} fetchedAt={me.dataUpdatedAt} />
            <Button variant="subtle" color="gray" onClick={() => logout.mutate()} disabled={logout.isPending}>
              ログアウト
            </Button>
          </Group>
        </Group>
      </Box>
      <Container size={1040} py="lg" component="main" id="main" tabIndex={-1} style={{ outline: "none" }}>
        <Stack gap="lg">
          <Outlet />
        </Stack>
      </Container>
    </>
  );
}
