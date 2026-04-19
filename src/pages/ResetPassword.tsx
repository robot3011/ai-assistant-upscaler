import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // When users click the email link, Supabase puts the recovery session
    // in the URL hash. The auth client picks it up automatically and fires
    // a PASSWORD_RECOVERY event — at that point we can let the user set a
    // new password.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setReady(true);
      }
    });

    // Also check existing session in case the event already fired
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated! Signing you in…");
      navigate("/", { replace: true });
    } catch (err: any) {
      toast.error(err.message || "Couldn't update password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-cosmic shadow-glow-strong animate-pulse-glow">
            <Sparkles className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold nova-gradient-text">Reset password</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {ready ? "Choose a new password" : "Verifying your reset link…"}
          </p>
        </div>

        {ready ? (
          <form
            onSubmit={submit}
            className="space-y-3 rounded-2xl border border-border bg-card p-6 shadow-elegant"
          >
            <div>
              <label className="mb-1 block text-sm font-medium">New password</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Confirm password</label>
              <input
                type="password"
                required
                minLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-gradient-primary py-2 text-sm font-medium text-primary-foreground shadow-glow transition hover:shadow-glow-strong disabled:opacity-60"
            >
              {busy ? "Updating…" : "Update password"}
            </button>
            <button
              type="button"
              onClick={() => navigate("/auth")}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
            >
              Back to sign in
            </button>
          </form>
        ) : (
          <div className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground shadow-elegant">
            <p>If this page doesn't activate, your reset link may have expired.</p>
            <button
              onClick={() => navigate("/auth")}
              className="mt-3 text-primary hover:underline"
            >
              Request a new reset link
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
