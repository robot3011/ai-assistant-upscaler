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

const cleanSpeechText = (value: string) => value.replace(/\s+/g, " ").trim();

const wordsMatch = (a: string, b: string) =>
  a.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "") === b.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

const compactDuplicateSpeech = (value: string) => {
  let words = cleanSpeechText(value).split(" ").filter(Boolean);
  let changed = true;

  while (changed) {
    changed = false;
    for (let i = 0; i < words.length; i++) {
      const maxPhraseLength = Math.floor((words.length - i) / 2);
      // Only collapse phrases of length >= 2. Single-word repeats like
      // "very very good" or "bye bye" are legitimate speech and must be kept.
      for (let len = maxPhraseLength; len >= 2; len--) {
        const left = words.slice(i, i + len);
        const right = words.slice(i + len, i + len * 2);
        if (left.length === right.length && left.every((word, idx) => wordsMatch(word, right[idx]))) {
          words = [...words.slice(0, i + len), ...words.slice(i + len * 2)];
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }

  return words.join(" ");
};

const joinTypedAndSpokenText = (baseText: string, speechText: string) => {
  const cleanedSpeech = compactDuplicateSpeech(speechText);
  if (!cleanedSpeech) return baseText;
  return baseText + (baseText && !/\s$/.test(baseText) ? " " : "") + cleanedSpeech;
};

export function ChatInput({ onSend, isLoading, onStop, mode, setMode }: Props) {
  const [input, setInput] = useState("");
  const [images, setImages] = useState<MessageImage[]>([]);
  const [isListening, setIsListening] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const inputRef = useRef(input);
  const voiceSessionRef = useRef(0);

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  useEffect(() => {
    return () => {
      voiceSessionRef.current += 1;
      recognitionRef.current?.abort?.();
      recognitionRef.current = null;
    };
  }, []);

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
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      toast.error("Voice input requires a secure (https) connection");
      return;
    }
    if (isListening && recognitionRef.current) {
      voiceSessionRef.current += 1;
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
      setIsListening(false);
      return;
    }
    try { recognitionRef.current?.abort?.(); } catch {}
    const sessionId = voiceSessionRef.current + 1;
    voiceSessionRef.current = sessionId;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    // Snapshot of typed text when this voice segment started. We refresh
    // it on every final result so that anything the user types into the
    // textarea while the mic is on is preserved (and not overwritten by
    // the recognized speech).
    let baseText = inputRef.current;
    const finalByIndex = new Map<number, string>();

    rec.onresult = (e: any) => {
      if (voiceSessionRef.current !== sessionId) return;
      let interim = "";
      let gotNewFinal = false;
      for (let i = e.resultIndex ?? 0; i < e.results.length; i++) {
        const result = e.results[i];
        const t = cleanSpeechText(result[0]?.transcript || "");
        if (!t) continue;
        if (result.isFinal) {
          if (finalByIndex.get(i) !== t) {
            finalByIndex.set(i, t);
            gotNewFinal = true;
          }
        } else {
          interim += (interim ? " " : "") + t;
        }
      }
      const finalized = Array.from(finalByIndex.entries())
        .sort(([a], [b]) => a - b)
        .map(([, text]) => text)
        .join(" ");
      const combined = [finalized, interim].filter(Boolean).join(" ");
      setInput(joinTypedAndSpokenText(baseText, combined));
      // Once a chunk is final, "commit" it into baseText so the user can
      // keep typing in the textarea without losing characters on the next
      // interim event.
      if (gotNewFinal) {
        baseText = joinTypedAndSpokenText(baseText, finalized);
        finalByIndex.clear();
      }
    };
    rec.onerror = (ev: any) => {
      if (voiceSessionRef.current !== sessionId) return;
      setIsListening(false);
      recognitionRef.current = null;
      switch (ev?.error) {
        case "no-speech":
        case "aborted":
          break;
        case "not-allowed":
        case "service-not-allowed":
          toast.error("Microphone blocked. Allow mic access in your browser settings.");
          break;
        case "audio-capture":
          toast.error("No microphone found. Please connect one and try again.");
          break;
        case "network":
          toast.error("Voice input needs an internet connection.");
          break;
        case "language-not-supported":
          toast.error("Selected language is not supported for voice input.");
          break;
        default:
          toast.error("Voice recognition error. Please try again.");
      }
    };
    rec.onend = () => {
      if (voiceSessionRef.current !== sessionId) return;
      setIsListening(false);
      recognitionRef.current = null;
    };
    try {
      rec.start();
      recognitionRef.current = rec;
      setIsListening(true);
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      toast.error("Voice input could not start");
    }
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
