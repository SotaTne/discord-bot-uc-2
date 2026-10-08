import { Box, Button, Card, Container, Group, Loader, Stack, Text, Title } from "@mantine/core";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { ApiError, unwrap } from "../lib/errors";
import { useMe } from "../lib/queries";
import { ErrorNote } from "../components/ui";

const NAV = [
  { to: "/", label: "枠" },
  { to: "/teams", label: "チーム" },
  { to: "/wins", label: "勝利" },
  { to: "/settings", label: "設定" },
] as const;

/** ログイン済みの画面の枠。ログインしていなければ、入り方を案内する */
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

  const pathname = useRouterState({ select: (state) => state.location.pathname });

  if (me.isPending) return <Loader size="sm" m="xl" mx="auto" display="block" aria-label="読み込み中" />;

  if (me.isError) {
    const unauthorized = me.error instanceof ApiError && me.error.status === 401;
    return (
      <Container size="xs" mt="xl">
        <Card>
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
        </Card>
      </Container>
    );
  }

  return (
    <>
      <Box component="header" py="xs" px="md" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
        <Group justify="space-between" gap="md" maw={1000} mx="auto">
          <Group gap="md">
            <Text fw={700}>UC ダッシュボード</Text>
            <Group component="nav" aria-label="メニュー" gap={4}>
              {NAV.map((item) => {
                const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
                return (
                  <Button key={item.to} component={Link} to={item.to} variant={active ? "light" : "subtle"} color={active ? "indigo" : "gray"} {...(active ? { "aria-current": "page" as const } : {})}>
                    {item.label}
                  </Button>
                );
              })}
            </Group>
          </Group>
          <Button variant="default" onClick={() => logout.mutate()} disabled={logout.isPending}>
            ログアウト
          </Button>
        </Group>
      </Box>
      <Container size={1000} py="md">
        <Stack gap="md" component="main">
          <Outlet />
        </Stack>
      </Container>
    </>
  );
}
