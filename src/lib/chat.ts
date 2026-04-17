import { supabase } from "@/integrations/supabase/client";

export type MessageImage = { url: string; name: string };

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  images?: MessageImage[];
  kind?: "text" | "generated_image";
  timestamp: Date;
};

export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  system_prompt?: string | null;
  tone: string;
  createdAt: Date;
};

export const TONES = [
  { id: "balanced", label: "⚖️ Balanced" },
  { id: "professional", label: "💼 Professional" },
  { id: "casual", label: "😊 Casual" },
  { id: "creative", label: "🎨 Creative" },
  { id: "technical", label: "🔧 Technical" },
] as const;

export const REASONING_LEVELS = [
  { id: "off", label: "Off — fastest" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High — most thorough" },
] as const;

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const CHAT_URL = `${SUPABASE_URL}/functions/v1/chat`;
const MONGO_URL = `${SUPABASE_URL}/functions/v1/mongo-api`;

// Helper: invoke mongo-api with the user's JWT
async function mongo<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || ANON_KEY;
  const resp = await fetch(MONGO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, payload }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error || `mongo-api ${action} failed`);
  return data as T;
}

type ApiMessageContent =
  | string
  | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

export function buildApiMessages(messages: Message[]) {
  return messages.map((m) => {
    if (m.images && m.images.length > 0 && m.images.some((i) => i.url)) {
      const parts: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [];
      if (m.content) parts.push({ type: "text", text: m.content });
      for (const img of m.images) if (img.url) parts.push({ type: "image_url", image_url: { url: img.url } });
      return { role: m.role, content: parts as ApiMessageContent };
    }
    return { role: m.role, content: m.content as ApiMessageContent };
  });
}

export async function streamChat({
  messages,
  systemPrompt,
  tone,
  reasoning,
  signal,
  onDelta,
  onDone,
  onError,
}: {
  messages: { role: string; content: ApiMessageContent }[];
  systemPrompt?: string | null;
  tone?: string;
  reasoning?: string;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}) {
  let resp: Response;
  try {
    resp = await fetch(CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ messages, systemPrompt, tone, reasoning, mode: "chat" }),
      signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") { onDone(); return; }
    onError("Network error contacting NovaMind");
    return;
  }

  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    onError(data.error || `Failed (${resp.status})`);
    return;
  }
  if (!resp.body) { onError("No response stream"); return; }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;

  while (!done) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (e: any) {
      if (e?.name === "AbortError") break;
      throw e;
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.startsWith(":") || line.trim() === "") continue;
      if (!line.startsWith("data: ")) continue;
      const json = line.slice(6).trim();
      if (json === "[DONE]") { done = true; break; }
      try {
        const parsed = JSON.parse(json);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) onDelta(delta);
      } catch {
        buffer = line + "\n" + buffer;
        break;
      }
    }
  }

  onDone();
}

export async function generateImage(prompt: string): Promise<{ imageUrl: string; text: string }> {
  const resp = await fetch(CHAT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify({
      mode: "image",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!resp.ok) {
    const d = await resp.json().catch(() => ({}));
    throw new Error(d.error || `Image generation failed (${resp.status})`);
  }
  return resp.json();
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- MongoDB-backed data access ----------

export async function loadConversationsFromDb(): Promise<Conversation[]> {
  const { items } = await mongo<{ items: any[] }>("listConversations");
  return (items || []).map((c) => ({
    id: c.id,
    title: c.title,
    system_prompt: c.system_prompt,
    tone: c.tone || "balanced",
    messages: [],
    createdAt: new Date(c.created_at),
  }));
}

export async function loadMessagesFromDb(conversationId: string): Promise<Message[]> {
  const { items } = await mongo<{ items: any[] }>("listMessages", { conversationId });
  return (items || []).map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    images: m.images as MessageImage[] | undefined,
    kind: m.kind,
    timestamp: new Date(m.created_at),
  }));
}

export async function createConversationInDb(
  title: string,
  _userId: string,
  tone = "balanced",
  systemPrompt?: string | null
) {
  const { item } = await mongo<{ item: any }>("createConversation", {
    title,
    tone,
    system_prompt: systemPrompt ?? null,
  });
  return { id: item.id, created_at: item.created_at };
}

export async function saveMessageToDb(
  conversationId: string,
  _userId: string,
  role: "user" | "assistant",
  content: string,
  images?: MessageImage[],
  kind: "text" | "generated_image" = "text"
) {
  const { item } = await mongo<{ item: any }>("addMessage", {
    conversationId,
    role,
    content,
    images: images ?? null,
    kind,
  });
  return item;
}

export async function updateConversationTitle(id: string, title: string) {
  await mongo("updateConversation", { id, updates: { title } });
}

export async function updateConversationSettings(
  id: string,
  updates: { system_prompt?: string | null; tone?: string }
) {
  await mongo("updateConversation", { id, updates });
}

export async function deleteConversationFromDb(id: string) {
  await mongo("deleteConversation", { id });
}

export async function deleteLastMessage(conversationId: string) {
  await mongo("deleteLastMessage", { conversationId });
}

export async function getAdminStats() {
  return mongo<{
    users: number;
    conversations: number;
    messages: number;
    generatedImages: number;
    recent: any[];
  }>("getStats");
}

export function exportConversation(conversation: Conversation): string {
  const header = `# ${conversation.title}\n\nExported from NovaMind\nDate: ${new Date().toLocaleString()}\n\n---\n\n`;
  const msgs = conversation.messages
    .map((m) => {
      const role = m.role === "user" ? "**You**" : "**NovaMind**";
      return `${role}:\n\n${m.content}\n`;
    })
    .join("\n---\n\n");
  return header + msgs;
}
