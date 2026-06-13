import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { LoadingHairline } from "@/app/components/ui/loading-hairline";
import { ScribedRule } from "@/app/components/ui/scribed-rule";
import { Logotype } from "@/app/components/Logotype";
import { setStoredAuthToken } from "@/app/components/auth-fetch";
import { API_BASE } from "../lib/api";

/**
 * Member-creation form behind both /setup (first-run claim) and /enroll
 * (invite). Redeems a one-time token + sets email/password, then lands the
 * new member in the app. The only difference between the two callers is the
 * headline/blurb copy and where the token comes from.
 */
export function EnrollForm(props: {
  headline: string;
  blurb: string;
  initialToken: string;
  /** Shown under the token field when no token came in via the URL —
   *  tells the user where to get one. */
  tokenHelp: string;
}) {
  const [token, setToken] = useState(props.initialToken);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token.trim() || !email.trim() || password.length < 8) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/enroll`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token.trim(),
          email: email.trim(),
          password,
        }),
      });
      if (!res.ok) {
        let message = "Could not create your account";
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          // keep default
        }
        toast.error(message);
        setSubmitting(false);
        return;
      }
      const body = (await res.json()) as { token?: string };
      if (body.token) setStoredAuthToken(body.token);
      window.location.href = "/";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="section-enter w-full max-w-sm border border-paper-rule bg-paper">
        <ScribedRule className="bg-ink" />

        <div className="px-5 pt-4 pb-3">
          <Logotype className="h-7 w-auto text-ink" />
          <h1 className="scribe-in mt-3 font-mono text-[11px] uppercase tracking-[0.08em] text-ink">
            {props.headline}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">{props.blurb}</p>
        </div>

        <ScribedRule delay={300} />

        <form onSubmit={onSubmit} className="space-y-4 px-5 py-4">
          {!props.initialToken && (
            <div className="space-y-2">
              <Label htmlFor="token">Setup token</Label>
              <Input
                id="token"
                type="text"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={submitting}
              />
              <p className="font-mono text-[11px] leading-relaxed text-ink-faint">
                {props.tokenHelp}
              </p>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoFocus
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
            <p className="font-mono text-[11px] text-ink-faint">At least 8 characters.</p>
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={submitting || !token.trim() || !email.trim() || password.length < 8}
          >
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <LoadingHairline inline aria-label="Creating account" />
                Creating account
              </span>
            ) : (
              "Create account"
            )}
          </Button>
        </form>
      </div>
    </main>
  );
}
