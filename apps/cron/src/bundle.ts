import { build } from "esbuild";

/** Apps Script に置く関数の名前（main.ts が export するもの） */
export const ENTRY_FUNCTIONS = ["tick", "installTrigger", "removeTrigger"] as const;

const NAMESPACE = "__uc";

/** main.ts を 1 つの JavaScript にする。トップレベルに、ENTRY_FUNCTIONS と同じ名前の関数の宣言を足す */
export async function bundleScript(): Promise<string> {
  const result = await build({
    entryPoints: ["src/main.ts"],
    bundle: true,
    format: "iife",
    globalName: NAMESPACE,
    target: "es2022",
    write: false,
    footer: { js: ENTRY_FUNCTIONS.map((name) => `function ${name}() { return ${NAMESPACE}.${name}(); }`).join("\n") },
  });
  return result.outputFiles[0]!.text;
}
