import { registerAllCommands } from "../src/register";

try {
  const result = await registerAllCommands(process.env);
  console.log(
    `${result.count} 個のコマンドを登録しました（${result.scope === "guild" ? "指定したサーバーだけ" : "全サーバー。反映に時間がかかることがあります"}）`,
  );
  console.log(result.names.map((name) => `  /${name}`).join("\n"));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
