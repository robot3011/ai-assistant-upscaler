import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Mic, MicOff, Send, Sparkles, Square, X } from "lucide-react";
import { fileToDataUrl, type MessageImage } from "@/lib/chat";
import { toast } from "sonner";

export type ChatMode = "chat" | "image";

interface Props {
  onSend: (message: string, images?: MessageImage[], mode?: ChatMode) => void;
  isLoading: boolean;
  onStop?: () => void;
  mode: ChatMode;
  setMode: (m: ChatMode) => void;
}

export function ChatInput({ onSend, isLoading, onStop, mode, setMode }: Props) {
  const [input, setInput] = useState("");
  const [images, setImages] = useState<MessageImage[]>([]);
  const [isListening, setIsListening] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px";
    }
  }, [input]);

  const submit = () => {
    if ((!input.trim() && images.length === 0) || isLoading) return;
    const text = input.trim() || (mode === "image" ? "Generate an image" : "Analyze this image");
    onSend(text, images.length ? images : undefined, mode);
    setInput("");
    setImages([]);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const toggleVoice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error("Voice input not supported in this browser");
      return;
    }
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    // Snapshot text already in the textarea before voice starts.
    // We only ever append NEW finalized segments (results after this resultIndex)
    // so each word is committed exactly once.
    const baseText = input;
    let committed = ""; // finalized text from this voice session only

    rec.onresult = (e: any) => {
      let interim = "";
      let newlyFinal = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) newlyFinal += t;
        else interim += t;
      }
      if (newlyFinal) {
        committed += (committed && !committed.endsWith(" ") ? " " : "") + newlyFinal.trim();
      }
      const joiner = baseText && !baseText.endsWith(" ") ? " " : "";
      setInput(
        baseText +
          (committed ? joiner + committed : "") +
          (interim ? (committed || baseText ? " " : "") + interim.trim() : "")
      );
    };
    rec.onerror = (ev: any) => {
      setIsListening(false);
      if (ev?.error !== "no-speech" && ev?.error !== "aborted") {
        toast.error("Voice recognition error");
      }
    };
    rec.onend = () => setIsListening(false);
    rec.start();
    recognitionRef.current = rec;
    setIsListening(true);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    if (images.length + files.length > 4) {
      toast.error("Maximum 4 images");
      return;
    }
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) {
        toast.error(`${f.name} is not an image`);
        continue;
      }
      if (f.size > 10 * 1024 * 1024) {
        toast.error(`${f.name} too large (max 10MB)`);
        continue;
      }
      const url = await fileToDataUrl(f);
      setImages((p) => [...p, { url, name: f.name }]);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="border-t border-border bg-background/80 p-3 backdrop-blur-sm sm:p-4">
      <div className="mx-auto max-w-3xl">
        {/* Mode pills */}
        <div className="mb-2 flex gap-1">
          <button
            onClick={() => setMode("chat")}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
              mode === "chat"
                ? "bg-primary text-primary-foreground shadow-glow"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            💬 Chat
          </button>
          <button
            onClick={() => setMode("image")}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
              mode === "image"
                ? "bg-gradient-cosmic text-primary-foreground shadow-glow"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            <Sparkles className="mr-1 inline h-3 w-3" />
            Image
          </button>
        </div>

        {images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {images.map((img, i) => (
              <div key={i} className="group relative">
                <img src={img.url} alt={img.name} className="h-16 w-16 rounded-lg border border-border object-cover" />
                <button
                  onClick={() => setImages((p) => p.filter((_, j) => j !== i))}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 rounded-2xl border border-border bg-secondary/40 p-2 transition-all focus-within:border-primary/50 focus-within:shadow-glow">
          {mode === "chat" && (
            <button
              onClick={() => fileRef.current?.click()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-nova-hover hover:text-foreground"
              title="Attach image"
            >
              <ImageIcon className="h-4 w-4" />
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleUpload} />

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder={mode === "image" ? "Describe the image to generate..." : "Message NovaMind..."}
            rows={1}
            className="max-h-[200px] min-h-[24px] flex-1 resize-none bg-transparent px-1 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />

          <button
            onClick={toggleVoice}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition ${
              isListening ? "bg-primary/20 text-primary animate-pulse-glow" : "text-muted-foreground hover:bg-nova-hover hover:text-foreground"
            }`}
            title={isListening ? "Stop" : "Voice input"}
          >
            {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>

          {isLoading ? (
            <button
              onClick={onStop}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive text-destructive-foreground transition hover:bg-destructive/80"
              title="Stop"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!input.trim() && images.length === 0}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-primary text-primary-foreground shadow-glow transition hover:shadow-glow-strong disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none"
              title="Send"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground sm:text-xs">
          NovaMind can make mistakes. Verify important information.
        </p>
      </div>
    </div>
  );
}
