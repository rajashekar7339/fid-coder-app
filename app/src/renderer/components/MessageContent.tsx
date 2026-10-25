import { useState, type ReactNode } from "react";

type Block =
  | { type: "code"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string }
  | { type: "paragraph"; text: string };

function parseBlocks(source: string): Block[] {
  const lines = source.split(/\r?\n/);
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const fence = /^```([^`]*)$/.exec(line);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]?.startsWith("```")) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1]?.length ?? 1, text: heading[2] ?? "" });
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "list", ordered: true, items });
      continue;
    }

    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (index < lines.length && (lines[index] ?? "").startsWith(">")) {
        quote.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", text: quote.join("\n") });
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (
      index < lines.length &&
      (lines[index] ?? "").trim() &&
      !/^```/.test(lines[index] ?? "") &&
      !/^#{1,3}\s+/.test(lines[index] ?? "") &&
      !/^[-*]\s+/.test(lines[index] ?? "") &&
      !/^\d+\.\s+/.test(lines[index] ?? "") &&
      !(lines[index] ?? "").startsWith(">")
    ) {
      paragraph.push(lines[index] ?? "");
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
  }

  return blocks;
}

function renderInline(text: string, keyPrefix: string) {
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\(https?:\/\/[^\s)]+\))|(\*[^*\n]+\*)/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let count = 0;
  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const key = `${keyPrefix}-${count}`;
    count += 1;
    if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-accent px-1 py-0.5 font-mono text-[0.85em] text-foreground">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token);
      if (link) {
        nodes.push(
          <a key={key} href={link[2]} target="_blank" rel="noreferrer" className="text-link underline underline-offset-2">
            {link[1]}
          </a>,
        );
      }
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = start + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function CodeBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="relative my-3 overflow-hidden rounded-[14px] bg-background text-foreground">
      <button
        type="button"
        className="absolute right-2 top-2 rounded-lg px-2 py-1 text-[12px] text-muted-foreground hover:bg-accent"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className="overflow-x-auto px-4 py-3 pr-16 font-mono text-[13px] leading-6">
        <code>{text}</code>
      </pre>
    </div>
  );
}

export function MessageContent({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-3 break-words">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === "code") return <CodeBlock key={key} text={block.text} />;
        if (block.type === "heading") {
          const className = block.level === 1 ? "text-[1.35em] font-medium" : block.level === 2 ? "text-[1.2em] font-medium" : "text-[1.05em] font-medium";
          return (
            <p key={key} className={className}>
              {renderInline(block.text, key)}
            </p>
          );
        }
        if (block.type === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag key={key} className={`space-y-1 pl-5 ${block.ordered ? "list-decimal" : "list-disc"}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
              ))}
            </ListTag>
          );
        }
        if (block.type === "quote") {
          return (
            <blockquote key={key} className="border-l-2 border-border pl-3 text-muted-foreground">
              {renderInline(block.text, key)}
            </blockquote>
          );
        }
        return (
          <p key={key} className="whitespace-pre-wrap">
            {renderInline(block.text, key)}
          </p>
        );
      })}
    </div>
  );
}
