import { guideImage } from "../guide";
import { renderInlineMarkdown } from "../inline-markdown";

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string }
  | { type: "image"; alt: string; src: string }
  | { type: "code"; text: string; language: string };

const FENCE = /^```([^`]*)$/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const IMAGE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;
const INLINE_CLASSES = { code: "guide-code-inline", link: "guide-link" };

export function GuideContent({ title, markdown }: { title: string; markdown: string }) {
  const blocks = parseGuide(markdown);
  const first = blocks[0];
  const visible =
    first?.type === "heading" && first.level === 1 && first.text.trim() === title.trim()
      ? blocks.slice(1)
      : blocks;

  return (
    <div className="guide-body">
      {visible.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === "heading") {
          return (
            <h3 key={key} className="guide-heading">
              {inline(block.text, key)}
            </h3>
          );
        }
        if (block.type === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={key} className={block.ordered ? "guide-steps" : "guide-bullets"}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>{inline(item, `${key}-${itemIndex}`)}</li>
              ))}
            </List>
          );
        }
        if (block.type === "quote") {
          const tip = block.text.trim().startsWith("**Tip:**");
          return (
            <blockquote key={key} className={tip ? "guide-tip" : "guide-quote"}>
              {inline(block.text, key)}
            </blockquote>
          );
        }
        if (block.type === "image") {
          return (
            <figure key={key} className="guide-figure">
              <img src={guideImage(block.src)} alt={block.alt} />
              <figcaption>{block.alt}</figcaption>
            </figure>
          );
        }
        if (block.type === "code") {
          return (
            <div key={key} className="guide-code">
              <div className="guide-code-bar">{block.language || "Code"}</div>
              <pre>
                <code>{block.text}</code>
              </pre>
            </div>
          );
        }
        return (
          <p key={key} className={index === 0 ? "guide-lead" : undefined}>
            {inline(block.text, key)}
          </p>
        );
      })}
    </div>
  );
}

function inline(text: string, keyPrefix: string) {
  return renderInlineMarkdown(text, keyPrefix, INLINE_CLASSES);
}

function parseGuide(source: string): Block[] {
  const lines = source.split(/\r?\n/);
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const language = fence[1]?.trim() ?? "";
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", text: body.join("\n"), language });
      continue;
    }

    const image = IMAGE.exec(line);
    if (image) {
      blocks.push({ type: "image", alt: image[1] ?? "", src: image[2] ?? "" });
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1]?.length ?? 1, text: heading[2] ?? "" });
      index += 1;
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

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }

    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (index < lines.length && (lines[index] ?? "").startsWith(">")) {
        quote.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", text: quote.join(" ") });
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && (lines[index] ?? "").trim() && !startsBlock(lines[index] ?? "")) {
      paragraph.push((lines[index] ?? "").trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
  }

  return blocks;
}

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || IMAGE.test(line) || /^(\d+\.|[-*])\s+/.test(line) || line.startsWith(">");
}
