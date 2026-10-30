import { useMemo, useRef, useState } from "react";
import { BookOpen, Search, X } from "lucide-react";
import { GUIDE_ARTICLES, type GuideArticle } from "../../lib/guide";
import { GuideContent } from "./GuideContent";
import { Modal } from "../ui/Modal";

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(GUIDE_ARTICLES[0]?.id ?? "");
  const search = useRef<HTMLInputElement>(null);
  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      needle
        ? GUIDE_ARTICLES.filter((article) =>
            `${article.title} ${article.group} ${article.summary} ${article.body}`.toLowerCase().includes(needle),
          )
        : GUIDE_ARTICLES,
    [needle],
  );
  const active = visible.find((article) => article.id === activeId) ?? visible[0] ?? null;
  const groups = groupArticles(visible);

  return (
    <Modal label="Help and guide" className="help-modal" onClose={onClose}>
      <header className="modal-header help-head">
        <div className="modal-head-copy">
          <div className="modal-kicker">Fid Coder</div>
          <div className="modal-title">Help &amp; guide</div>
        </div>
        <div className="help-search">
          <Search size={13} aria-hidden="true" />
          <input
            ref={search}
            value={query}
            placeholder="Search the guide"
            aria-label="Search the guide"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button
              type="button"
              className="search-clear"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                window.requestAnimationFrame(() => search.current?.focus());
              }}
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
        <button type="button" className="icon-button" aria-label="Close help" onClick={onClose}>
          <X size={15} />
        </button>
      </header>

      <div className="help-body">
        <nav className="help-nav" aria-label="Guide topics">
          {groups.map(([group, articles]) => (
            <div className="help-nav-group" key={group}>
              <div className="help-nav-label">{group}</div>
              {articles.map((article) => (
                <button
                  key={article.id}
                  type="button"
                  className={`help-nav-item ${active?.id === article.id ? "is-active" : ""}`}
                  title={article.title}
                  aria-label={`${article.title}, ${article.readMinutes} min read`}
                  aria-current={active?.id === article.id ? "page" : undefined}
                  onClick={() => setActiveId(article.id)}
                >
                  <span className="help-nav-mark" aria-hidden="true" />
                  <span className="help-nav-title">{article.title}</span>
                  <span className="help-nav-read" aria-hidden="true">
                    {article.readMinutes} min
                  </span>
                </button>
              ))}
            </div>
          ))}
          {visible.length === 0 ? (
            <div className="help-nav-empty">No articles match “{query.trim()}”. Try “agent” or “workspace”.</div>
          ) : null}
          <div className="help-nav-note">
            <kbd>F1</kbd> opens this guide anywhere.
          </div>
        </nav>

        <article className="help-article" key={active?.id ?? "empty"}>
          {active ? (
            <>
              <div className="help-article-top">
                <span>{active.group}</span>
                <span className="help-crumb">/</span>
                <span>{active.title}</span>
                <span className="help-read">{active.readMinutes} min read</span>
              </div>
              <h2>{active.title}</h2>
              <GuideContent title={active.title} markdown={active.body} />
            </>
          ) : (
            <div className="help-empty">
              <BookOpen size={22} aria-hidden="true" />
              <h2>No article found</h2>
              <p>Clear the search or try a different word.</p>
            </div>
          )}
        </article>
      </div>
    </Modal>
  );
}

function groupArticles(articles: GuideArticle[]): Array<[string, GuideArticle[]]> {
  const groups = new Map<string, GuideArticle[]>();
  for (const article of articles) {
    const list = groups.get(article.group);
    if (list) list.push(article);
    else groups.set(article.group, [article]);
  }
  return [...groups.entries()];
}
