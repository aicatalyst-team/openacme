import { useEffect, useState } from "react";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

/**
 * Lazy-loaded code renderer (the heavy shiki chunk lives behind a
 * React.lazy boundary in FilePreview). Grammars load on demand per
 * language; explicit import thunks so Vite splits each into its own
 * chunk. Unknown languages fall back to an unhighlighted <pre>.
 */

const LANG_LOADERS: Record<string, () => Promise<unknown>> = {
  typescript: () => import("@shikijs/langs/typescript"),
  tsx: () => import("@shikijs/langs/tsx"),
  javascript: () => import("@shikijs/langs/javascript"),
  jsx: () => import("@shikijs/langs/jsx"),
  python: () => import("@shikijs/langs/python"),
  go: () => import("@shikijs/langs/go"),
  rust: () => import("@shikijs/langs/rust"),
  java: () => import("@shikijs/langs/java"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  swift: () => import("@shikijs/langs/swift"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  csharp: () => import("@shikijs/langs/csharp"),
  ruby: () => import("@shikijs/langs/ruby"),
  php: () => import("@shikijs/langs/php"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  sql: () => import("@shikijs/langs/sql"),
  json: () => import("@shikijs/langs/json"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  yaml: () => import("@shikijs/langs/yaml"),
  toml: () => import("@shikijs/langs/toml"),
  ini: () => import("@shikijs/langs/ini"),
  markdown: () => import("@shikijs/langs/markdown"),
  html: () => import("@shikijs/langs/html"),
  css: () => import("@shikijs/langs/css"),
  scss: () => import("@shikijs/langs/scss"),
  xml: () => import("@shikijs/langs/xml"),
  graphql: () => import("@shikijs/langs/graphql"),
  docker: () => import("@shikijs/langs/docker"),
  diff: () => import("@shikijs/langs/diff"),
  lua: () => import("@shikijs/langs/lua"),
  r: () => import("@shikijs/langs/r"),
  scala: () => import("@shikijs/langs/scala"),
  svelte: () => import("@shikijs/langs/svelte"),
  vue: () => import("@shikijs/langs/vue"),
};

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<string>();

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [
      import("@shikijs/themes/github-light"),
      import("@shikijs/themes/github-dark"),
    ],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighterPromise;
}

async function highlight(code: string, lang: string): Promise<string | null> {
  const loader = LANG_LOADERS[lang];
  if (!loader) return null;
  const highlighter = await getHighlighter();
  if (!loadedLangs.has(lang)) {
    await highlighter.loadLanguage(
      (await loader()) as Parameters<HighlighterCore["loadLanguage"]>[0]
    );
    loadedLangs.add(lang);
  }
  return highlighter.codeToHtml(code, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  });
}

export default function CodePreview({
  code,
  lang,
}: {
  code: string;
  lang: string | null;
}) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    if (!lang) return;
    void highlight(code, lang)
      .then((out) => {
        if (!cancelled) setHtml(out);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  if (html) {
    return (
      <div
        className="file-code-preview overflow-x-auto p-3 font-mono text-[12px] leading-relaxed"
        // shiki output is generated locally from file text — no untrusted markup.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap p-3 font-mono text-[12px] leading-relaxed text-ink">
      {code}
    </pre>
  );
}
