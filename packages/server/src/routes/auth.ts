import type { Context, Hono } from "hono";
import type { AuthStore } from "@openacme/db";
import { SESSION_COOKIE_NAME, resolveMember } from "../middleware/auth.js";

export interface AuthRoutesOptions {
  store: AuthStore;
}

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days

function isSecure(c: Context): boolean {
  const proto = c.req.header("x-forwarded-proto") ?? "";
  return proto === "https" || c.req.url.startsWith("https:");
}

function buildCookie(value: string, secure: boolean): string {
  // HttpOnly: JS can't read it (XSS exfil). SameSite=Lax: top-level
  // navigation back from /login still sets it. Path=/: covers /api + HTML.
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function clearCookie(secure: boolean): string {
  const parts = [`${SESSION_COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Unauthenticated auth surface — mounted BEFORE the gate. login + logout +
 * status + enroll (the one-time-token member creation behind both first-run
 * claim and invites).
 */
export function registerAuthRoutes(app: Hono, opts: AuthRoutesOptions): void {
  const { store } = opts;

  app.post("/api/auth/login", async (c) => {
    let body: { email?: string; password?: string };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const email = (body.email ?? "").trim();
    const password = body.password ?? "";
    if (!email || !password) {
      return c.json({ error: "email and password are required" }, 400);
    }
    const member = store.verifyPassword(email, password);
    if (!member) return c.json({ error: "Invalid email or password" }, 401);
    const { token } = store.createSession(member.id);
    c.header("Set-Cookie", buildCookie(token, isSecure(c)));
    return c.json({ ok: true, token, member });
  });

  // First-run claim AND invites land here — both redeem a one-time enroll
  // token to create a member. Same primitive, different token source.
  app.post("/api/auth/enroll", async (c) => {
    let body: { token?: string; email?: string; password?: string };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const token = (body.token ?? "").trim();
    const email = (body.email ?? "").trim();
    const password = body.password ?? "";
    if (!token) return c.json({ error: "token is required" }, 400);
    if (!isValidEmail(email)) return c.json({ error: "A valid email is required" }, 400);
    if (password.length < 8) {
      return c.json({ error: "Password must be at least 8 characters" }, 400);
    }
    if (store.getMemberByEmail(email)) {
      return c.json({ error: "That email is already registered" }, 409);
    }
    if (!store.consumeEnrollToken(token)) {
      return c.json({ error: "This link is invalid, used, or expired" }, 401);
    }
    const member = store.createMember({ email, password });
    const { token: sessionToken } = store.createSession(member.id);
    c.header("Set-Cookie", buildCookie(sessionToken, isSecure(c)));
    return c.json({ ok: true, token: sessionToken, member }, 201);
  });

  app.post("/api/auth/logout", (c) => {
    const cookie = c.req.header("cookie") ?? "";
    const auth = c.req.header("authorization") ?? "";
    // Drop whichever token the caller presented.
    const bearer = /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "").trim() : null;
    const m = cookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
    const cookieTok = m ? decodeURIComponent(m[1]!.trim()) : null;
    if (cookieTok) store.deleteSession(cookieTok);
    if (bearer) store.deleteSession(bearer);
    c.header("Set-Cookie", clearCookie(isSecure(c)));
    return c.json({ ok: true });
  });

  // Drives the login/setup pages: needsSetup → render the claim form;
  // member present → already authed, skip the form.
  app.get("/api/auth/status", (c) => {
    const member = resolveMember(c, store);
    return c.json({
      needsSetup: store.countMembers() === 0,
      authRequired: true,
      member: member ?? null,
    });
  });
}

/**
 * Authenticated member-management surface — mounted AFTER the gate so every
 * route here already has a valid session. Flat-role: any member can invite
 * or revoke any other.
 */
export function registerMemberRoutes(app: Hono, opts: AuthRoutesOptions): void {
  const { store } = opts;

  app.get("/api/members", (c) => {
    return c.json({ members: store.listMembers() });
  });

  // Mint a one-time enrollment link to hand off out-of-band (no email is
  // sent — the founder shares the URL however they like).
  app.post("/api/members/invite", (c) => {
    const { token } = store.createEnrollToken();
    const proto = c.req.header("x-forwarded-proto") ?? (c.req.url.startsWith("https:") ? "https" : "http");
    const host = c.req.header("host") ?? "localhost";
    const url = `${proto}://${host}/enroll?token=${encodeURIComponent(token)}`;
    return c.json({ token, url }, 201);
  });

  app.delete("/api/members/:id", (c) => {
    const id = c.req.param("id");
    const all = store.listMembers();
    if (!all.some((m) => m.id === id)) {
      return c.json({ error: "Member not found" }, 404);
    }
    // Refuse to delete the last member — that would drop the whole app back
    // into claim mode and lock everyone out until someone reads the boot log.
    if (all.length === 1) {
      return c.json({ error: "Cannot remove the only member" }, 400);
    }
    store.deleteMember(id);
    return c.json({ ok: true });
  });
}
