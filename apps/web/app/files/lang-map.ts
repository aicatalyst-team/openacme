// Filename → shiki language id. Deliberately shiki-free so FilePreview
// can dispatch on it without pulling the highlighter into the main
// bundle (CodePreview, the lazy chunk, owns the grammar loaders).

const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  fish: "shellscript",
  sql: "sql",
  json: "json",
  jsonl: "json",
  jsonc: "jsonc",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  conf: "ini",
  cfg: "ini",
  env: "ini",
  properties: "ini",
  md: "markdown",
  markdown: "markdown",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "scss",
  xml: "xml",
  svg: "xml",
  graphql: "graphql",
  dockerfile: "docker",
  diff: "diff",
  patch: "diff",
  lua: "lua",
  r: "r",
  scala: "scala",
  svelte: "svelte",
  vue: "vue",
};

export function langForFilename(filename: string): string | null {
  const base = filename.toLowerCase();
  if (base === "dockerfile") return "docker";
  const ext = base.includes(".") ? base.split(".").pop()! : "";
  // Dotfiles like .env / .gitignore resolve via their suffix.
  return EXT_LANG[ext] ?? null;
}
