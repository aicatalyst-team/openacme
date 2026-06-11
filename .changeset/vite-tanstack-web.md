---
"@openacme/server": minor
---

Web UI migrated from Next.js to a Vite + TanStack Router SPA. The bundled static UI is now a single index.html with hashed assets under /assets/ (the auth middleware whitelist follows it), the SPA fallback no longer probes per-route .html files, and in workspace dev the server embeds Vite in middleware mode — one process, one port, no proxy.
