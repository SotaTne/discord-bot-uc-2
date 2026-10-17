import { useEffect, useId, useState } from "react";
import { Text, useComputedColorScheme } from "@mantine/core";

/**
 * Mermaid の図。ガイドを開いたときにだけ、ライブラリを読み込む（ほかのページは、重くならない）。
 * 書き方が間違っていたときは、図の代わりに、元の文字を出す。
 */
export function MermaidDiagram({ chart }: { chart: string }) {
  const id = "mermaid-" + useId().replace(/:/g, "");
  const scheme = useComputedColorScheme("light");
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: scheme === "dark" ? "dark" : "default" });
        const result = await mermaid.render(id, chart);
        if (!cancelled) setSvg(result.svg);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [chart, id, scheme]);

  if (failed) return <pre>{chart}</pre>;
  if (svg === null) return <Text size="sm" c="dimmed">図を読み込み中…</Text>;
  return <div className="mermaid-diagram" role="img" aria-label="図" dangerouslySetInnerHTML={{ __html: svg }} />;
}
