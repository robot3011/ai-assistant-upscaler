import { Bot, Copy, RefreshCw, User, Volume2, VolumeX } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Message } from "@/lib/chat";
import { toast } from "sonner";
import { useTTS } from "@/hooks/useTTS";

interface Props {
  message: Message;
  onRegenerate?: () => void;
  isLast?: boolean;
}

export function ChatMessage({ message, onRegenerate, isLast }: Props) {
  const isUser = message.role === "user";
  const { speak, stop, speaking } = useTTS();

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    toast.success("Copied to clipboard");
  };

  return (
    <div className={`group animate-fade-in flex gap-4 px-4 py-6 ${isUser ? "" : "nova-surface"}`}>
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          isUser ? "bg-secondary" : "bg-gradient-primary shadow-glow"
        }`}
      >
        {isUser ? (
          <User className="h-4 w-4 text-secondary-foreground" />
        ) : (
          <Bot className="h-4 w-4 text-primary-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          {isUser ? "You" : "NovaMind"}
        </p>

        {message.images && message.images.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {message.images.map((img, i) =>
              img.url ? (
                <img
                  key={i}
                  src={img.url}
                  alt={img.name}
                  className="max-h-72 max-w-sm rounded-lg border border-border object-contain"
                />
              ) : (
                <div
                  key={i}
                  className="rounded-lg border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground"
                >
                  📎 {img.name}
                </div>
              )
            )}
          </div>
        )}

        {message.kind === "generated_image" && message.images?.[0]?.url ? (
          <div className="text-sm text-muted-foreground italic">{message.content}</div>
        ) : (
          <div className="prose-nova text-sm">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}

        {!isUser && message.content && (
          <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={copy}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-nova-hover hover:text-foreground"
              title="Copy"
            >
              <Copy className="h-3 w-3" />
            </button>
            <button
              onClick={() => (speaking ? stop() : speak(message.content))}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-nova-hover hover:text-foreground"
              title={speaking ? "Stop speaking" : "Read aloud"}
            >
              {speaking ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
            </button>
            {isLast && onRegenerate && (
              <button
                onClick={onRegenerate}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-nova-hover hover:text-foreground"
                title="Regenerate"
              >
                <RefreshCw className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
