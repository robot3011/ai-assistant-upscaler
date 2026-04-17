import { LogOut, MessageSquarePlus, Search, Settings, Shield, Sparkles, Trash2 } from "lucide-react";
import type { Conversation } from "@/lib/chat";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
  isAdmin: boolean;
  userEmail?: string;
}

export function ChatSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onOpenSettings,
  onSignOut,
  isAdmin,
  userEmail,
}: Props) {
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  const filtered = useMemo(() => {
    if (!q.trim()) return conversations;
    const t = q.toLowerCase();
    return conversations.filter((c) => c.title.toLowerCase().includes(t));
  }, [q, conversations]);

  return (
    <div className="flex h-full w-64 flex-col bg-sidebar border-r border-sidebar-border">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-4 border-b border-sidebar-border">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-cosmic shadow-glow">
          <Sparkles className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="text-lg font-bold nova-gradient-text">NovaMind</span>
      </div>

      {/* New chat */}
      <div className="p-3">
        <button
          onClick={onNew}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-glow transition hover:shadow-glow-strong"
        >
          <MessageSquarePlus className="h-4 w-4" />
          New chat
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search chats..."
            className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2">
        {filtered.length === 0 && (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">
            {q ? "No matches" : "No conversations yet"}
          </p>
        )}
        {filtered.map((c) => (
          <div
            key={c.id}
            className={`group mb-1 flex items-center gap-1 rounded-lg px-2 py-2 text-sm transition ${
              activeId === c.id
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/60"
            }`}
          >
            <button onClick={() => onSelect(c.id)} className="flex-1 truncate text-left">
              {c.title}
            </button>
            <button
              onClick={() => onDelete(c.id)}
              className="opacity-0 transition group-hover:opacity-100 hover:text-destructive"
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-2">
        {isAdmin && (
          <button
            onClick={() => navigate("/admin")}
            className="mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-sidebar-foreground transition hover:bg-sidebar-accent"
          >
            <Shield className="h-4 w-4 text-primary" />
            Admin dashboard
          </button>
        )}
        <button
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-sidebar-foreground transition hover:bg-sidebar-accent"
        >
          <Settings className="h-4 w-4" />
          Settings
        </button>
        <button
          onClick={onSignOut}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-sidebar-foreground transition hover:bg-sidebar-accent"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
        {userEmail && (
          <p className="px-2 pt-2 text-[10px] text-muted-foreground truncate">{userEmail}</p>
        )}
      </div>
    </div>
  );
}
