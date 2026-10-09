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
// 見ている日付は、URL（?date=YYYY-MM-DD）に持つ。再読み込みしても、同じ日が開く。省略は、今日
const boardRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: BoardPage,
  validateSearch: (search: Record<string, unknown>): { date?: string } =>
    typeof search.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.date) ? { date: search.date } : {},
});
// 詳細を開いているチーム（いくつでも）は、URL（?team=[チームの ID, …]）に持つ。再読み込みや、リンクの共有で、同じ画面が開く
const teamsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/teams",
  component: TeamsPage,
  validateSearch: (search: Record<string, unknown>): { team?: number[] } => {
    // ?team=3（1 つ）も、?team=[1,3]（いくつか）も受ける。正の整数だけを残し、重複は除く
    const values = Array.isArray(search.team) ? search.team : [search.team];
    const team = [...new Set(values.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    return team.length > 0 ? { team } : {};
  },
});
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
