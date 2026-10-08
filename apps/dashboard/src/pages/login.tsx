import { Alert, Button, Container, Paper, Stack, Text, Title } from "@mantine/core";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { unwrap } from "../lib/errors";
import { parseLoginToken } from "../lib/login-token";
import { ErrorNote } from "../components/ui";

/**
 * ログインリンク（/login#token=...）の確認画面。
 * リンクを開いただけでは、トークンは消費されない（Discord のプレビューなどの先読みで、使えなくなるのを防ぐ）。
 * 「ダッシュボードへ入る」を押して初めて、トークンを送って、ログインする。
 */
export function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const token = parseLoginToken(location.hash);

  const login = useMutation({
    mutationFn: (value: string) => unwrap(api.login.$post({ json: { token: value } })),
    // 成功したら、トークンが入った URL を履歴に残さず、トップへ移る
    onSuccess: () => navigate({ to: "/", hash: "", replace: true }),
  });

  return (
    <Container size="xs" mt="xl">
      <Paper className="surface" p="md">
        <Stack>
          <Title order={1} size="h3">
            UC ダッシュボード
          </Title>
          {token ? (
            <>
              <Text>管理者用のダッシュボードにログインします。</Text>
              <Button disabled={login.isPending} onClick={() => login.mutate(token)}>
                ダッシュボードへ入る
              </Button>
              <ErrorNote error={login.error} />
            </>
          ) : (
            <Alert color="red" role="alert">
              ログインリンクが正しくありません。Discord で <code>/uc-admin-dashboard</code> を実行して、新しいリンクを発行してください。
            </Alert>
          )}
        </Stack>
      </Paper>
    </Container>
  );
}
