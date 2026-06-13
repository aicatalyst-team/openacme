import type { Context, MiddlewareHandler } from "hono";
import type { AuthStore, MemberPublic } from "@openacme/db";

const SESSION_COOKIE = "openacme_session";

export interface AuthOptions {
  store: AuthStore;
}

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/** Pull the bearer/cookie token off a request, cookie first. */
export function extractToken(c: Context): string | null {
  const cookie = parseCookie(c.req.header("cookie"), SESSION_COOKIE);
  if (cookie) return cookie;
  const auth = c.req.header("authorization") ?? "";
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  return null;
}

/** Resolve the member behind a request, or null if unauthenticated. */
export function resolveMember(c: Context, store: AuthStore): MemberPublic | null {
  const token = extractToken(c);
  if (!token) return null;
  return store.resolveSession(token);
}

/**
 * Auth middleware. There is no loopback bypass — every request (local or
 * remote) needs a valid session, the price of per-member identity. Two
 * gates skip it:
 *
 *  - `/login`, `/setup`, `/api/auth/*` — the login + enrollment surface,
 *    reachable without a session by definition.
 *  - static assets + PWA discovery files — referenced by the login page
 *    itself, so they must render pre-auth.
 *
 * While zero members exist (fresh install / post-upgrade) the whole app is
 * in claim mode: HTML routes redirect to /setup, /api/* returns a
 * `needs_setup` 401. Once a member exists, normal login is required.
 */
export function authMiddleware(opts: AuthOptions): MiddlewareHandler {
  return async (c: Context, next) => {
    const path = c.req.path;
    // Health is unauthenticated — `pollHealth` (CLI) and external monitors
    // must reach it without a session, including in claim mode.
    if (path === "/api/health") return next();
    if (
      path === "/login" ||
      path === "/setup" ||
      path === "/enroll" ||
      path.startsWith("/api/auth/")
    ) {
      return next();
    }
    // Static assets referenced by the login/setup pages must bypass auth,
    // otherwise the HTML loads but its CSS/JS get redirected and the page
    // never hydrates. Vite emits hashed assets under /assets/.
    if (
      path.startsWith("/assets/") ||
      path === "/favicon.ico" ||
      path.startsWith("/favicon")
    ) {
      return next();
    }
    // PWA discovery assets must be reachable pre-login — exact filenames
    // only so a prefix match can't be abused.
    if (
      path === "/manifest.webmanifest" ||
      path === "/sw.js" ||
      path === "/apple-touch-icon.png" ||
      path === "/icon-192.png" ||
      path === "/icon-512.png" ||
      path === "/icon-maskable-512.png"
    ) {
      return next();
    }

    // Fresh install: no members yet → claim mode.
    if (opts.store.countMembers() === 0) {
      if (path.startsWith("/api/")) {
        return c.json({ error: "needs_setup" }, 401);
      }
      return c.redirect("/setup");
    }

    if (resolveMember(c, opts.store)) return next();

    if (path.startsWith("/api/")) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const next_ = encodeURIComponent(
      path + (c.req.url.includes("?") ? c.req.url.slice(c.req.url.indexOf("?")) : "")
    );
    return c.redirect(`/login?next=${next_}`);
  };
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
