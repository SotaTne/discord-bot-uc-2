import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useState } from "react";
import { createAppRouter } from "./router";
import { theme } from "./theme";

/** データ取得の既定の設定。失敗してもやり直さず（403 や 401 を繰り返さない）、画面に戻っても勝手に取り直さない */
export const createQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5_000 } } });

export function App({ router, queryClient }: { router?: ReturnType<typeof createAppRouter>; queryClient?: QueryClient } = {}) {
  const [client] = useState(() => queryClient ?? createQueryClient());
  const [appRouter] = useState(() => router ?? createAppRouter());

  return (
    <MantineProvider defaultColorScheme="auto" theme={theme}>
      <QueryClientProvider client={client}>
        <RouterProvider router={appRouter} />
      </QueryClientProvider>
    </MantineProvider>
  );
}
