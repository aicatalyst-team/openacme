---
"@openacme/server": minor
---

Release 0.8.0 — a large batch of work since 0.7.0 across the whole workforce
platform. All `@openacme/*` packages move together (fixed group).

Highlights:

- **Per-member authentication.** Replaces the single shared access-secret with
  email/password accounts (flat-role admins), stateful sessions, first-run
  claim via a one-time setup link, and out-of-band invite links. No loopback
  bypass; `/api/health` stays unauthenticated. CLI: `claim`, `invite`,
  `members list|revoke`. **Breaking:** existing installs re-onboard once (the
  old `secret` file is ignored; first boot prints a claim link).
- **Usage ledger** — per-call token/cost metering, `/api/usage`, and a `/usage`
  page (overview, breakdown, activity, forecast).
- **Teams org chart** and a tasks-board UX overhaul (searchable filters,
  smoother kanban drag, humanized times, board-mode detail sheet).
- **Inline markdown editing** (TipTap) across web panes.
- **Landing page + docs site** (Fumadocs static export), including the
  remote-access and self-hosting guides.
- **Latest model presets** refresh.
- Real end-to-end test suite (HTTP + browser) behind a no-mock model seam.
- Default server port changed `3210` → `3456`.
- Tool-host scaling fixes: lazy worker spawn, cached stdio MCP discovery,
  bounded per-session shells.
