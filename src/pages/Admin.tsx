import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useRole";
import { getAdminStats } from "@/lib/chat";
import { ArrowLeft, MessageSquare, Shield, Sparkles, Users } from "lucide-react";

interface Stats {
  users: number;
  conversations: number;
  messages: number;
  generatedImages: number;
}

export default function Admin() {
  const { user, loading } = useAuth();
  const { isAdmin, checked } = useIsAdmin(user?.id);
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        const data = await getAdminStats();
        setStats({
          users: data.users,
          conversations: data.conversations,
          messages: data.messages,
          generatedImages: data.generatedImages,
        });
        setRecent(data.recent || []);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [isAdmin]);

  if (loading || !checked) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading...</div>;
  }
  if (!user) return <Navigate to="/auth" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;

  const cards = [
    { label: "Users", value: stats?.users ?? "—", icon: Users },
    { label: "Conversations", value: stats?.conversations ?? "—", icon: MessageSquare },
    { label: "Messages", value: stats?.messages ?? "—", icon: Sparkles },
    { label: "Images generated", value: stats?.generatedImages ?? "—", icon: Sparkles },
  ];

  return (
    <div className="min-h-screen px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <button
          onClick={() => navigate("/")}
          className="mb-6 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to chat
        </button>

        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-cosmic shadow-glow">
            <Shield className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold nova-gradient-text">Admin Dashboard</h1>
            <p className="text-xs text-muted-foreground">Full access to NovaMind data (MongoDB)</p>
          </div>
        </div>

        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {cards.map((c) => (
            <div key={c.label} className="rounded-xl border border-border bg-card p-4 shadow-elegant">
              <c.icon className="mb-2 h-4 w-4 text-primary" />
              <div className="text-2xl font-bold">{c.value}</div>
              <div className="text-xs text-muted-foreground">{c.label}</div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-border bg-card shadow-elegant">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold">
            Recent conversations (all users)
          </div>
          <div className="divide-y divide-border">
            {recent.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No conversations yet</p>
            )}
            {recent.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1 truncate">{c.title}</div>
                <div className="text-xs text-muted-foreground font-mono">{String(c.user_id).slice(0, 8)}…</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(c.updated_at).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Data is stored in your <span className="text-primary">MongoDB Atlas</span> cluster (database <code>novamind</code>).
        </p>
      </div>
    </div>
  );
}
