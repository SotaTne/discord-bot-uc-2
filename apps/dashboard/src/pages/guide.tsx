import { Children, isValidElement, type ReactNode } from "react";
import { Anchor, Paper, Stack, Text, Typography } from "@mantine/core";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import guideSource from "../guide/guide.md?raw";
import { CommandsTable } from "../guide/commands-table";
import { MermaidDiagram } from "../guide/mermaid-diagram";
import { PageTitle } from "../components/ui";

/** guide.md の中で、コマンド一覧を差し込む場所 */
export const COMMANDS_MARKER = "{{commands}}";

function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => (typeof child === "string" ? child : isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : ""))
    .join("");
}

/** 見出しの文字から、リンク用の id を作る（日本語のまま使う） */
export function headingId(text: string): string {
  return text.trim().replace(/\s+/g, "-");
}

const components: Components = {
  h2: ({ children }) => <h2 id={headingId(textOf(children))}>{children}</h2>,
  h3: ({ children }) => <h3 id={headingId(textOf(children))}>{children}</h3>,
  // ```mermaid の囲みは、図にする。ほかのコードは、そのまま
  pre: ({ children }) => {
    const code = Children.toArray(children).find(isValidElement<{ className?: string; children?: ReactNode }>);
    if (code?.props.className?.includes("language-mermaid")) return <MermaidDiagram chart={textOf(code.props.children).trim()} />;
    return <pre>{children}</pre>;
  },
};

/** 見出し（## と ###）の一覧。目次に使う */
export function headingsOf(source: string): { level: 2 | 3; text: string }[] {
  return source
    .split("\n")
    .map((line) => /^(##|###) (.+)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ level: match[1] === "##" ? 2 : 3, text: match[2]!.trim() }));
}

function Chunk({ source }: { source: string }) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={components}>
      {source}
    </Markdown>
  );
}

/** 運営向けのガイド。文章は guide.md に書く（{{commands}} の場所には、コマンド一覧が入る） */
export function GuidePage({ source = guideSource }: { source?: string }) {
  const [before = "", after = ""] = source.split(COMMANDS_MARKER);
  const toc = headingsOf(source).filter((heading) => heading.level === 2);
  return (
    <>
      <PageTitle>ガイド</PageTitle>
      <Paper component="nav" aria-label="目次" className="surface" p="md">
        <Stack gap={4}>
          <Text size="sm" c="dimmed">
            目次
          </Text>
          {toc.map((heading) => (
            <Anchor key={heading.text} href={`#${headingId(heading.text)}`} size="sm">
              {heading.text}
            </Anchor>
          ))}
        </Stack>
      </Paper>
      <Paper className="surface" p="lg">
        <Typography>
          <Chunk source={before} />
          {source.includes(COMMANDS_MARKER) && <CommandsTable />}
          <Chunk source={after} />
        </Typography>
      </Paper>
    </>
  );
}
