import type { WasmDatabase } from "../wasm/adapter.js";
import { drizzle } from "../wasm/drizzle.js";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import {
  members,
  authSessions,
  enrollTokens,
  type MemberRow,
} from "../schema.js";

export type { MemberRow } from "../schema.js";

/** Public member shape — never carries the password hash/salt. */
export interface MemberPublic {
  id: string;
  email: string;
  createdAt: number;
}

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days — matches the cookie
const ENROLL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function publicShape(row: MemberRow): MemberPublic {
  return { id: row.id, email: row.email, createdAt: row.createdAt };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** scrypt a password against a salt → hex. Slow by design. */
function scryptHex(password: string, salt: string): string {
  return scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
}

function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/** SHA-256 hex — used for high-entropy session/enroll tokens (no KDF
 *  needed: the token itself is 32 random bytes). */
function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Authentication store: members, login sessions, and one-time enrollment
 * tokens. Members are flat-role admins distinguished by email; the single
 * shared-secret model this replaces is gone (see schema comments).
 */
export function createAuthStore(db: WasmDatabase) {
  const orm = drizzle(db);

  return {
    // ── Members ──

    countMembers(): number {
      const row = orm
        .select({ n: sql<number>`count(*)` })
        .from(members)
        .get();
      return row?.n ?? 0;
    },

    /** Create a member with a freshly-salted scrypt password hash. Throws
     *  on a duplicate email (unique constraint). */
    createMember(input: { email: string; password: string }): MemberPublic {
      const email = normalizeEmail(input.email);
      const salt = randomBytes(16).toString("hex");
      const passwordHash = scryptHex(input.password, salt);
      const row = orm
        .insert(members)
        .values({
          id: randomUUID(),
          email,
          passwordHash,
          passwordSalt: salt,
        })
        .returning()
        .get();
      return publicShape(row);
    },

    getMemberByEmail(email: string): MemberRow | null {
      return (
        orm
          .select()
          .from(members)
          .where(eq(members.email, normalizeEmail(email)))
          .get() ?? null
      );
    },

    listMembers(): MemberPublic[] {
      return orm
        .select()
        .from(members)
        .orderBy(members.createdAt)
        .all()
        .map(publicShape);
    },

    /** Delete a member; their auth_sessions cascade via FK. */
    deleteMember(id: string): void {
      orm.delete(members).where(eq(members.id, id)).run();
    },

    /** Verify email + password. Returns the public member on success,
     *  null otherwise. Constant-time on the hash compare. */
    verifyPassword(email: string, password: string): MemberPublic | null {
      const row = this.getMemberByEmail(email);
      if (!row) return null;
      const candidate = scryptHex(password, row.passwordSalt);
      if (!timingSafeHexEqual(candidate, row.passwordHash)) return null;
      return publicShape(row);
    },

    // ── Sessions ──

    /** Mint a login session for a member. Returns the raw token (set as the
     *  cookie / stored as the bearer fallback); only its hash is persisted. */
    createSession(memberId: string): { token: string } {
      const token = randomBytes(32).toString("hex");
      const now = Math.floor(Date.now() / 1000);
      orm
        .insert(authSessions)
        .values({
          tokenHash: sha256Hex(token),
          memberId,
          expiresAt: now + SESSION_TTL_SECONDS,
        })
        .run();
      return { token };
    },

    /** Resolve a session token to its member. Returns null when unknown or
     *  expired; lazily reaps an expired row on the way out. */
    resolveSession(token: string): MemberPublic | null {
      const tokenHash = sha256Hex(token);
      const session = orm
        .select()
        .from(authSessions)
        .where(eq(authSessions.tokenHash, tokenHash))
        .get();
      if (!session) return null;
      const now = Math.floor(Date.now() / 1000);
      if (session.expiresAt <= now) {
        orm.delete(authSessions).where(eq(authSessions.tokenHash, tokenHash)).run();
        return null;
      }
      const member = orm
        .select()
        .from(members)
        .where(eq(members.id, session.memberId))
        .get();
      return member ? publicShape(member) : null;
    },

    /** Logout — drop a single session token. */
    deleteSession(token: string): void {
      orm
        .delete(authSessions)
        .where(eq(authSessions.tokenHash, sha256Hex(token)))
        .run();
    },

    // ── Enrollment tokens (first-run claim + invites) ──

    /** Create a single-use enrollment token. Returns the raw token (goes
     *  in the boot-log claim line or the invite link). */
    createEnrollToken(opts?: { ttlSeconds?: number }): { token: string } {
      const token = randomBytes(24).toString("base64url");
      const now = Math.floor(Date.now() / 1000);
      orm
        .insert(enrollTokens)
        .values({
          tokenHash: sha256Hex(token),
          expiresAt: now + (opts?.ttlSeconds ?? ENROLL_TTL_SECONDS),
        })
        .run();
      return { token };
    },

    /** Consume an enrollment token: valid iff unused and unexpired. Marks it
     *  used atomically so a token can't be redeemed twice. */
    consumeEnrollToken(token: string): boolean {
      const tokenHash = sha256Hex(token);
      const now = Math.floor(Date.now() / 1000);
      const res = orm
        .update(enrollTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(enrollTokens.tokenHash, tokenHash),
            isNull(enrollTokens.usedAt),
            sql`${enrollTokens.expiresAt} > ${now}`
          )
        )
        .run();
      return res.changes > 0;
    },
  };
}

export type AuthStore = ReturnType<typeof createAuthStore>;
