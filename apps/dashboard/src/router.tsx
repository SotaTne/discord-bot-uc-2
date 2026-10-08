import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, type RouterHistory } from "@tanstack/react-router";
import { BoardPage } from "./pages/board";
import { AppLayout } from "./pages/layout";
import { LoginPage } from "./pages/login";
import { SettingsPage } from "./pages/settings";
import { TeamsPage } from "./pages/teams";
import { WinsPage } from "./pages/wins";

const rootRoute = createRootRoute({ component: Outlet });

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: LoginPage });

// ログイン済みの画面は、共通の枠（AppLayout）の中に表示する。
// path は、Link の型チェックのために、1つずつ文字列リテラルで書く（ヘルパーにまとめると、型が string に広がる）
const appRoute = createRoute({ getParentRoute: () => rootRoute, id: "app", component: AppLayout });
const boardRoute = createRoute({ getParentRoute: () => appRoute, path: "/", component: BoardPage });
const teamsRoute = createRoute({ getParentRoute: () => appRoute, path: "/teams", component: TeamsPage });
const winsRoute = createRoute({ getParentRoute: () => appRoute, path: "/wins", component: WinsPage });
const settingsRoute = createRoute({ getParentRoute: () => appRoute, path: "/settings", component: SettingsPage });

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([boardRoute, teamsRoute, winsRoute, settingsRoute]),
]);

export function createAppRouter(options: { initialPath?: string; history?: RouterHistory } = {}) {
  const history = options.history ?? (options.initialPath ? createMemoryHistory({ initialEntries: [options.initialPath] }) : undefined);
  return createRouter({ routeTree, ...(history ? { history } : {}) });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
