import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { App } from "../App";
import { theme } from "../theme";

export function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  return render(
    <MantineProvider theme={theme}>
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>
    </MantineProvider>,
  );
}
