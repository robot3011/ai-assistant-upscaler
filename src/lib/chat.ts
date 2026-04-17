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

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

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

// ---------- DB ----------

export async function loadConversationsFromDb(): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((c: any) => ({
    id: c.id,
    title: c.title,
    system_prompt: c.system_prompt,
    tone: c.tone || "balanced",
    messages: [],
    createdAt: new Date(c.created_at),
  }));
}

export async function loadMessagesFromDb(conversationId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map((m: any) => ({
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
  userId: string,
  tone = "balanced",
  systemPrompt?: string | null
) {
  const { data, error } = await supabase
    .from("conversations")
    .insert({ title, user_id: userId, tone, system_prompt: systemPrompt ?? null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function saveMessageToDb(
  conversationId: string,
  userId: string,
  role: "user" | "assistant",
  content: string,
  images?: MessageImage[],
  kind: "text" | "generated_image" = "text"
) {
  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      user_id: userId,
      role,
      content,
      images: (images as any) ?? null,
      kind,
    })
    .select()
    .single();
  if (error) throw error;
  // bump conversation updated_at
  await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
  return data;
}

export async function updateConversationTitle(id: string, title: string) {
  await supabase.from("conversations").update({ title }).eq("id", id);
}

export async function updateConversationSettings(
  id: string,
  updates: { system_prompt?: string | null; tone?: string }
) {
  await supabase.from("conversations").update(updates).eq("id", id);
}

export async function deleteConversationFromDb(id: string) {
  await supabase.from("conversations").delete().eq("id", id);
}

export async function deleteLastMessage(conversationId: string) {
  const { data } = await supabase
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (data && data[0]) {
    await supabase.from("messages").delete().eq("id", data[0].id);
  }
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
