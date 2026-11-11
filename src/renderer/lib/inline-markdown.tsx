import type { ReactNode } from "react";
import {
  citationPattern,
  collectCitations,
  parseCitation,
  type Citation,
} from "../../shared/citations";

type Classes = { code: string; link: string };
export type CitationHandler = (
  path: string,
  line: number,
  endLine: number | null,
  related: Citation[],
) => void;

export function renderInlineMarkdown(
  text: string,
  keyPrefix: string,
  classes: Classes,
  onCitation?: CitationHandler,
): ReactNode[] {
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\(https?:\/\/[^\s)]+\))|(\*[^*\n]+\*)/g;
  const nodes: ReactNode[] = [];
  const related = onCitation ? collectCitations(text) : [];
  let last = 0;
  let count = 0;

  const pushPlain = (value: string) => {
    if (!value) return;
    if (!onCitation) {
      nodes.push(value);
      return;
    }
    let cursor = 0;
    let index = 0;
    for (const match of value.matchAll(citationPattern())) {
      const raw = match[0];
      const citation = parseCitation(raw);
      if (!citation) continue;
      const at = match.index ?? 0;
      if (at > cursor) nodes.push(value.slice(cursor, at));
      nodes.push(
        citationLink(raw, citation, `${keyPrefix}-cite-${last}-${index}`, onCitation, related),
      );
      cursor = at + raw.length;
      index += 1;
    }
    if (cursor < value.length) nodes.push(value.slice(cursor));
  };

  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > last) pushPlain(text.slice(last, start));
    const key = `${keyPrefix}-${count}`;
    count += 1;
    if (token.startsWith("`")) {
      const inner = token.slice(1, -1);
      const citation = onCitation ? parseCitation(inner) : null;
      if (citation && onCitation) {
        nodes.push(
          citationLink(
            inner,
            citation,
            key,
            onCitation,
            related,
            `${classes.code} md-citation md-citation-code`,
          ),
        );
      } else {
        nodes.push(
          <code key={key} className={classes.code}>
            {inner}
          </code>,
        );
      }
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token);
      if (link) {
        nodes.push(
          <a key={key} href={link[2]} target="_blank" rel="noreferrer" className={classes.link}>
            {link[1]}
          </a>,
        );
      }
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = start + token.length;
  }
  if (last < text.length) pushPlain(text.slice(last));
  return nodes;
}

function citationLink(
  raw: string,
  citation: Citation,
  key: string,
  onCitation: CitationHandler,
  related: Citation[],
  className = "md-citation",
): ReactNode {
  const range =
    citation.endLine === null ? `line ${citation.line}` : `lines ${citation.line}-${citation.endLine}`;
  return (
    <button
      key={key}
      type="button"
      className={className}
      title={`Read ${citation.path} at ${range}`}
      onClick={() => onCitation(citation.path, citation.line, citation.endLine, related)}
    >
      {raw}
    </button>
  );
}
