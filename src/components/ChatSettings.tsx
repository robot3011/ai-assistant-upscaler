import { X } from "lucide-react";
import { REASONING_LEVELS, TONES } from "@/lib/chat";
import { useTTS } from "@/hooks/useTTS";

interface Props {
  open: boolean;
  onClose: () => void;
  systemPrompt: string;
  setSystemPrompt: (s: string) => void;
  tone: string;
  setTone: (t: string) => void;
  reasoning: string;
  setReasoning: (r: string) => void;
  ttsVoice: string;
  setTtsVoice: (v: string) => void;
}

export function ChatSettings({
  open, onClose,
  systemPrompt, setSystemPrompt,
  tone, setTone,
  reasoning, setReasoning,
  ttsVoice, setTtsVoice,
}: Props) {
  const { voices, speak } = useTTS();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-elegant animate-slide-up">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold nova-gradient-text">Settings</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-nova-hover hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-sm font-medium">Tone</label>
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm focus:border-primary focus:outline-none"
            >
              {TONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Reasoning effort</label>
            <select
              value={reasoning}
              onChange={(e) => setReasoning(e.target.value)}
              className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm focus:border-primary focus:outline-none"
            >
              {REASONING_LEVELS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Higher reasoning = better answers on hard problems, but slower.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Voice (read aloud)</label>
            <div className="flex gap-2">
              <select
                value={ttsVoice}
                onChange={(e) => setTtsVoice(e.target.value)}
                className="flex-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm focus:border-primary focus:outline-none"
              >
                <option value="">Default</option>
                {voices.filter((v) => v.lang.startsWith("en")).map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>
                ))}
              </select>
              <button
                onClick={() => speak("Hello, I am NovaMind. Ready to help.", ttsVoice)}
                className="rounded-lg bg-secondary px-3 text-sm hover:bg-nova-hover"
              >
                Test
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Custom system prompt</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={4}
              placeholder="e.g. Always reply in French. Keep answers under 200 words."
              className="w-full resize-none rounded-lg border border-border bg-secondary px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
            <p className="mt-1 text-xs text-muted-foreground">Applied to new conversations.</p>
          </div>
        </div>

        <div className="flex justify-end border-t border-border px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg bg-gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:shadow-glow-strong"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
