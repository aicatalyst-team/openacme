/**
 * Usage-ledger enums. Standalone module (not in usage-store.ts) so
 * `schema.ts` can import them without a schema ↔ store import cycle.
 *
 * `UsageKind` answers "what spent these tokens": the two turn kinds
 * (interactive chat, dispatcher-driven autonomous) plus the per-turn
 * overhead subagents. Adding a kind: extend here, stamp it at the call
 * site in agent-core, and the ledger/UI pick it up — no migration
 * (drizzle text enums are TS hints, not CHECK constraints).
 */
export const USAGE_KINDS = [
  "interactive",
  "autonomous",
  "extractor",
  "title",
  "selector",
  "summarizer",
] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

export const USAGE_AUTH_MODES = ["api_key", "oauth", "local"] as const;
export type UsageAuthMode = (typeof USAGE_AUTH_MODES)[number];

/**
 * Where `cost_usd` came from. `estimated` = registry list price;
 * `provider_reported` = actual cost returned by the provider
 * (OpenRouter usage accounting); `subscription` = OAuth-billed, no
 * marginal dollar cost (cost_usd null, equivalent still computed);
 * `free` = local models (ollama).
 */
export const USAGE_COST_SOURCES = [
  "estimated",
  "provider_reported",
  "subscription",
  "free",
] as const;
export type UsageCostSource = (typeof USAGE_COST_SOURCES)[number];
