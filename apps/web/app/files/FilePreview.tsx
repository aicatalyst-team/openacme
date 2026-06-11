import { Suspense, lazy, useEffect, useState } from "react";
import { Download, ExternalLink, FileIcon } from "lucide-react";
import { Markdown } from "../components/Markdown";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { fileUrl } from "./api";
import { langForFilename } from "./lang-map";
import type { FsRoot } from "./types";

const CodePreview = lazy(() => import("./CodePreview"));

/** Past this size everything gets the download card — no preview fetch. */
const MAX_PREVIEW_BYTES = 50 * 1024 * 1024;
/** Text previews fetch at most this much; a 206 response → truncation banner. */
const TEXT_CAP_BYTES = 256 * 1024;

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "svg"]);
const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "mkv"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "m4a", "flac", "aac"]);

type Category =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "markdown"
  | "html"
  | "text"
  | "probe";

function categorize(relPath: string): Category {
  const base = relPath.split("/").pop() ?? relPath;
  const lower = base.toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop()! : "";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "html" || ext === "htm") return "html";
  if (langForFilename(base) !== null || ext === "txt" || ext === "log") {
    return "text";
  }
  // Unknown extension (or none): a capped fetch tells us via the server's
  // NUL-sniffed Content-Type whether this is text.
  return "probe";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

interface TextState {
  loading: boolean;
  content: string | null;
  truncated: boolean;
  isText: boolean;
  error: string | null;
}

/** Fetch the first TEXT_CAP_BYTES of a file. `isText` reflects the
 *  server's Content-Type (it NUL-sniffs unknown extensions). */
function useTextContent(url: string, enabled: boolean): TextState {
  const [state, setState] = useState<TextState>({
    loading: enabled,
    content: null,
    truncated: false,
    isText: true,
    error: null,
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState({ loading: true, content: null, truncated: false, isText: true, error: null });
    void (async () => {
      try {
        const res = await fetch(url, {
          headers: { range: `bytes=0-${TEXT_CAP_BYTES - 1}` },
        });
        if (!res.ok && res.status !== 206) {
          throw new Error(res.statusText);
        }
        const contentType = res.headers.get("content-type") ?? "";
        const isText =
          contentType.startsWith("text/") ||
          contentType.includes("json") ||
          contentType.includes("yaml") ||
          contentType.includes("xml") ||
          contentType.includes("svg");
        const content = isText ? await res.text() : null;
        // A 206 covering the whole file isn't a truncation — compare the
        // served end against the total in Content-Range (bytes s-e/total).
        const rangeMatch = /bytes \d+-(\d+)\/(\d+)/.exec(
          res.headers.get("content-range") ?? ""
        );
        const truncated =
          res.status === 206 &&
          rangeMatch !== null &&
          Number(rangeMatch[1]) + 1 < Number(rangeMatch[2]);
        if (cancelled) return;
        setState({
          loading: false,
          content,
          truncated,
          isText,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          loading: false,
          content: null,
          truncated: false,
          isText: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, enabled]);

  return state;
}

function DownloadCard({
  root,
  relPath,
  size,
}: {
  root: FsRoot;
  relPath: string;
  size: number;
}) {
  const name = relPath.split("/").pop() ?? relPath;
  return (
    <div className="m-6 flex flex-col items-center gap-3 border border-dashed border-paper-rule px-6 py-10 text-center">
      <FileIcon className="size-8 text-ink-faint" aria-hidden />
      <div>
        <p className="break-all font-mono text-[13px] text-ink">{name}</p>
        <p className="mt-1 font-mono text-[11px] tabular-nums text-ink-faint">
          {formatBytes(size)} · no inline preview
        </p>
      </div>
      <Button size="sm" variant="outline" asChild>
        <a href={fileUrl(root, relPath, { download: true })}>
          <Download className="size-4" />
          Download
        </a>
      </Button>
    </div>
  );
}

function TruncationBanner() {
  return (
    <p className="border-b border-paper-rule bg-paper-sunk px-3 py-1.5 font-mono text-[11px] text-ink-soft">
      Showing the first {formatBytes(TEXT_CAP_BYTES)} — download for the full file.
    </p>
  );
}

function SourceToggle({
  mode,
  onChange,
  labels,
}: {
  mode: "rendered" | "source";
  onChange: (m: "rendered" | "source") => void;
  labels?: { rendered: string; source: string };
}) {
  const l = labels ?? { rendered: "Rendered", source: "Source" };
  return (
    <div className="flex gap-1">
      {(["rendered", "source"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={cn(
            "px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors",
            mode === m
              ? "bg-paper-sunk text-ink"
              : "text-ink-faint hover:text-ink"
          )}
        >
          {l[m]}
        </button>
      ))}
    </div>
  );
}

/**
 * Type-dispatched preview for a file under an /api/fs root. Media and
 * PDF render natively off the bytes URL (the server supports Range, so
 * video seeks); markdown/code/text fetch capped content; everything
 * else gets a download card.
 */
export function FilePreview({
  root,
  relPath,
  size,
  headerClassName,
}: {
  root: FsRoot;
  relPath: string;
  size: number;
  /** Extra header classes — the preview dialog pads right so the row
   *  clears Radix's absolute close button. */
  headerClassName?: string;
}) {
  const category = categorize(relPath);
  const url = fileUrl(root, relPath);
  const filename = relPath.split("/").pop() ?? relPath;
  const tooBig = size > MAX_PREVIEW_BYTES;
  const wantsText =
    !tooBig &&
    (category === "markdown" ||
      category === "html" ||
      category === "text" ||
      category === "probe");
  const text = useTextContent(url, wantsText);
  // Markdown defaults to rendered; HTML defaults to source (the rendered
  // iframe is sandboxed script-less, but source is the honest default).
  const [mode, setMode] = useState<"rendered" | "source">(
    category === "markdown" ? "rendered" : "source"
  );
  useEffect(() => {
    setMode(category === "markdown" ? "rendered" : "source");
  }, [relPath, category]);

  const header = (
    <div
      className={cn(
        "flex shrink-0 items-center gap-3 border-b border-paper-rule px-3 py-2",
        headerClassName
      )}
    >
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">
        {relPath}
      </span>
      {(category === "markdown" || (category === "html" && text.content !== null)) && (
        <SourceToggle
          mode={mode}
          onChange={setMode}
          labels={
            category === "html"
              ? { rendered: "Rendered", source: "Source" }
              : undefined
          }
        />
      )}
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-faint">
        {formatBytes(size)}
      </span>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        aria-label="Open in new tab"
        title="Open in new tab"
        className="text-ink-soft hover:text-plot-red"
      >
        <ExternalLink className="size-3.5" />
      </a>
      <a
        href={fileUrl(root, relPath, { download: true })}
        aria-label="Download"
        title="Download"
        className="text-ink-soft hover:text-plot-red"
      >
        <Download className="size-3.5" />
      </a>
    </div>
  );

  let body: React.ReactNode;
  if (tooBig) {
    body = <DownloadCard root={root} relPath={relPath} size={size} />;
  } else if (category === "image") {
    body = (
      <div className="flex items-start justify-center p-4">
        <img
          src={url}
          alt={filename}
          className="max-h-full max-w-full border border-paper-rule"
        />
      </div>
    );
  } else if (category === "video") {
    body = (
      <div className="p-4">
        <video src={url} controls className="max-h-full w-full bg-black" />
      </div>
    );
  } else if (category === "audio") {
    body = (
      <div className="p-4">
        <audio src={url} controls className="w-full" />
      </div>
    );
  } else if (category === "pdf") {
    body = (
      <object
        data={url}
        type="application/pdf"
        className="h-full min-h-[24rem] w-full bg-paper-sunk"
      >
        <div className="p-4 text-[12px] text-ink-soft">
          Inline PDF preview unavailable in this browser.{" "}
          <a href={url} target="_blank" rel="noreferrer" className="underline">
            Open in new tab
          </a>
          .
        </div>
      </object>
    );
  } else if (text.loading) {
    body = (
      <p className="p-3 font-mono text-[12px] text-ink-faint">Loading…</p>
    );
  } else if (text.error) {
    body = (
      <p className="p-3 font-mono text-[12px] text-plot-red">{text.error}</p>
    );
  } else if (text.content === null) {
    // Probe came back binary.
    body = <DownloadCard root={root} relPath={relPath} size={size} />;
  } else if (category === "markdown" && mode === "rendered") {
    body = (
      <>
        {text.truncated && <TruncationBanner />}
        <div className="p-4 text-[13px] leading-relaxed text-ink">
          <Markdown>{text.content}</Markdown>
        </div>
      </>
    );
  } else if (category === "html" && mode === "rendered") {
    body = (
      // Script-less sandbox on purpose: CORS is wide open on the API, so
      // an allow-scripts frame could still call it. Inert markup only.
      <iframe
        sandbox=""
        srcDoc={text.content}
        title={filename}
        className="h-full min-h-[24rem] w-full bg-white"
      />
    );
  } else {
    body = (
      <>
        {text.truncated && <TruncationBanner />}
        <Suspense
          fallback={
            <pre className="overflow-x-auto whitespace-pre-wrap p-3 font-mono text-[12px] leading-relaxed text-ink">
              {text.content}
            </pre>
          }
        >
          <CodePreview code={text.content} lang={langForFilename(filename)} />
        </Suspense>
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-auto">{body}</div>
    </div>
  );
}
