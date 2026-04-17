import { useCallback, useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";

import { ChatSidebar } from "@/components/ChatSidebar";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput, type ChatMode } from "@/components/ChatInput";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { ThinkingIndicator } from "@/components/ThinkingIndicator";
import { ChatSettings } from "@/components/ChatSettings";

import {
  buildApiMessages, createConversationInDb, deleteConversationFromDb,
  deleteLastMessage, exportConversation, generateId, generateImage,
  loadConversationsFromDb, loadMessagesFromDb, saveMessageToDb,
  streamChat, updateConversationTitle,
  type Conversation, type Message, type MessageImage,
} from "@/lib/chat";

import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useRole";

const LS_PREFS = "novamind:prefs";

export default function Index() {
  const { user, loading: authLoading, signOut } = useAuth();
  const { isAdmin } = useIsAdmin(user?.id);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mode, setMode] = useState<ChatMode>("chat");

  const [systemPrompt, setSystemPrompt] = useState("");
  const [tone, setTone] = useState("balanced");
  const [reasoning, setReasoning] = useState("off");
  const [ttsVoice, setTtsVoice] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const active = conversations.find((c) => c.id === activeId) || null;

  // Load prefs
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_PREFS);
      if (raw) {
        const p = JSON.parse(raw);
        setSystemPrompt(p.systemPrompt || "");
        setTone(p.tone || "balanced");
        setReasoning(p.reasoning || "off");
        setTtsVoice(p.ttsVoice || "");
      }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    localStorage.setItem(LS_PREFS, JSON.stringify({ systemPrompt, tone, reasoning, ttsVoice }));
  }, [systemPrompt, tone, reasoning, ttsVoice]);

  // Load conversations
  useEffect(() => {
    if (!user) return;
    loadConversationsFromDb().then(setConversations).catch((e) => {
      console.error(e);
      toast.error("Failed to load conversations");
    });
  }, [user]);

  // Load messages on switch
  useEffect(() => {
    if (!activeId) return;
    const conv = conversations.find((c) => c.id === activeId);
    if (conv && conv.messages.length === 0) {
      loadMessagesFromDb(activeId).then((msgs) => {
        setConversations((prev) =>
          prev.map((c) => (c.id === activeId ? { ...c, messages: msgs } : c))
        );
      }).catch(console.error);
    }
  }, [activeId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.messages, isLoading]);

  // Keyboard shortcut: Cmd/Ctrl + N → new chat
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        setActiveId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const runStream = useCallback(
    async (convId: string, allMsgs: Message[]) => {
      const apiMessages = buildApiMessages(allMsgs);
      const assistantId = generateId();
      let buf = "";
      abortRef.current = new AbortController();

      await streamChat({
        messages: apiMessages,
        systemPrompt: systemPrompt || null,
        tone,
        reasoning,
        signal: abortRef.current.signal,
        onDelta: (chunk) => {
          buf += chunk;
          setConversations((prev) =>
            prev.map((c) => {
              if (c.id !== convId) return c;
              const msgs = [...c.messages];
              const last = msgs[msgs.length - 1];
              if (last?.id === assistantId) {
                msgs[msgs.length - 1] = { ...last, content: buf };
              } else {
                msgs.push({ id: assistantId, role: "assistant", content: buf, timestamp: new Date() });
              }
              return { ...c, messages: msgs };
            })
          );
        },
        onDone: async () => {
          setIsLoading(false);
          if (buf && user) {
            try {
              await saveMessageToDb(convId, user.id, "assistant", buf);
            } catch (e) {
              console.error(e);
            }
          }
        },
        onError: (err) => {
          toast.error(err);
          setIsLoading(false);
        },
      });
    },
    [systemPrompt, tone, reasoning, user]
  );

  const handleSend = useCallback(
    async (input: string, images?: MessageImage[], sendMode: ChatMode = "chat") => {
      if (!user) return;
      let convId = activeId;
      let currentMessages: Message[] = active?.messages || [];

      const userMsg: Message = {
        id: generateId(),
        role: "user",
        content: input,
        images,
        timestamp: new Date(),
      };

      // Create conversation if needed
      if (!convId) {
        try {
          const title = input.slice(0, 50) + (input.length > 50 ? "…" : "");
          const dbConv = await createConversationInDb(title, user.id, tone, systemPrompt || null);
          convId = dbConv.id;
          const newConv: Conversation = {
            id: dbConv.id,
            title,
            messages: [userMsg],
            system_prompt: systemPrompt || null,
            tone,
            createdAt: new Date(dbConv.created_at),
          };
          setConversations((prev) => [newConv, ...prev]);
          setActiveId(convId);
          currentMessages = [];
        } catch (e) {
          console.error(e);
          toast.error("Failed to create conversation");
          return;
        }
      } else {
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, messages: [...c.messages, userMsg] } : c))
        );
      }

      // Save user message (strip image data URLs to keep DB lean)
      try {
        await saveMessageToDb(
          convId,
          user.id,
          "user",
          input,
          images?.map((i) => ({ url: "", name: i.name }))
        );
      } catch (e) {
        console.error(e);
      }

      setSidebarOpen(false);
      setIsLoading(true);

      // Image generation branch
      if (sendMode === "image") {
        try {
          const { imageUrl, text } = await generateImage(input);
          const assistantMsg: Message = {
            id: generateId(),
            role: "assistant",
            content: text || `Generated image: "${input}"`,
            images: imageUrl ? [{ url: imageUrl, name: "generated.png" }] : undefined,
            kind: "generated_image",
            timestamp: new Date(),
          };
          setConversations((prev) =>
            prev.map((c) => (c.id === convId ? { ...c, messages: [...c.messages, assistantMsg] } : c))
          );
          await saveMessageToDb(
            convId,
            user.id,
            "assistant",
            assistantMsg.content,
            imageUrl ? [{ url: imageUrl, name: "generated.png" }] : undefined,
            "generated_image"
          );
        } catch (e: any) {
          toast.error(e.message || "Image generation failed");
        } finally {
          setIsLoading(false);
        }
        return;
      }

      // Text chat
      const allMsgs = [...currentMessages, userMsg];
      try {
        await runStream(convId, allMsgs);
      } catch (e) {
        console.error(e);
        toast.error("Failed to connect");
        setIsLoading(false);
      }
    },
    [activeId, active, user, systemPrompt, tone, runStream]
  );

  const handleStop = () => {
    abortRef.current?.abort();
    setIsLoading(false);
  };

  const handleRegenerate = useCallback(async () => {
    if (!user || !activeId || !active) return;
    // Drop last assistant message from UI + DB
    const msgs = [...active.messages];
    const last = msgs[msgs.length - 1];
    if (last?.role !== "assistant") return;
    msgs.pop();
    setConversations((prev) =>
      prev.map((c) => (c.id === activeId ? { ...c, messages: msgs } : c))
    );
    await deleteLastMessage(activeId);
    setIsLoading(true);
    try {
      await runStream(activeId, msgs);
    } catch (e) {
      console.error(e);
      setIsLoading(false);
    }
  }, [active, activeId, user, runStream]);

  const handleDelete = async (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
    try {
      await deleteConversationFromDb(id);
    } catch {
      /* ignore */
    }
  };

  const handleExport = () => {
    if (!active || active.messages.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    const md = exportConversation(active);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${active.title}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Auth gates
  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }
  if (!user) return <Navigate to="/auth" replace />;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar (desktop) */}
      <div className="hidden md:block">
        <ChatSidebar
          conversations={conversations}
          activeId={activeId}
          onSelect={(id) => setActiveId(id)}
          onNew={() => setActiveId(null)}
          onDelete={handleDelete}
          onOpenSettings={() => setSettingsOpen(true)}
          onSignOut={signOut}
          isAdmin={isAdmin}
          userEmail={user.email}
        />
      </div>

      {/* Sidebar (mobile drawer) */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <div className="absolute left-0 top-0 h-full animate-slide-up">
            <ChatSidebar
              conversations={conversations}
              activeId={activeId}
              onSelect={(id) => { setActiveId(id); setSidebarOpen(false); }}
              onNew={() => { setActiveId(null); setSidebarOpen(false); }}
              onDelete={handleDelete}
              onOpenSettings={() => { setSettingsOpen(true); setSidebarOpen(false); }}
              onSignOut={signOut}
              isAdmin={isAdmin}
              userEmail={user.email}
            />
          </div>
        </div>
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-border bg-background/60 px-3 py-2 backdrop-blur-sm sm:px-4">
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-nova-hover hover:text-foreground md:hidden"
          >
            {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          <div className="min-w-0 flex-1 truncate px-2 text-sm font-medium">
            {active?.title || "New chat"}
          </div>
          {active && (
            <button
              onClick={handleExport}
              className="rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-nova-hover hover:text-foreground"
            >
              Export
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          {!active || active.messages.length === 0 ? (
            <WelcomeScreen onPick={(p) => handleSend(p, undefined, mode)} />
          ) : (
            <div className="mx-auto max-w-3xl">
              {active.messages.map((m, i) => (
                <ChatMessage
                  key={m.id}
                  message={m}
                  isLast={i === active.messages.length - 1}
                  onRegenerate={handleRegenerate}
                />
              ))}
              {isLoading && <ThinkingIndicator />}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <ChatInput
          onSend={handleSend}
          isLoading={isLoading}
          onStop={handleStop}
          mode={mode}
          setMode={setMode}
        />
      </div>

      <ChatSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        systemPrompt={systemPrompt}
        setSystemPrompt={setSystemPrompt}
        tone={tone}
        setTone={setTone}
        reasoning={reasoning}
        setReasoning={setReasoning}
        ttsVoice={ttsVoice}
        setTtsVoice={setTtsVoice}
      />
    </div>
  );
}
