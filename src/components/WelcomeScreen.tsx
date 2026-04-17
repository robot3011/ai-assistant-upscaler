import { Sparkles } from "lucide-react";

const PROMPTS = [
  "Explain quantum entanglement like I'm five",
  "Write a Python script to deduplicate a CSV",
  "Brainstorm 5 startup ideas in climate tech",
  "Draft a polite email declining a meeting",
];

export function WelcomeScreen({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 text-center animate-fade-in">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-cosmic shadow-glow-strong animate-pulse-glow">
        <Sparkles className="h-8 w-8 text-primary-foreground" />
      </div>
      <h1 className="mb-2 text-4xl font-bold nova-gradient-text">NovaMind</h1>
      <p className="mb-8 max-w-md text-muted-foreground">
        Your intelligent AI companion. Ask anything, generate images, analyze visuals, brainstorm ideas.
      </p>
      <div className="grid w-full max-w-2xl gap-2 sm:grid-cols-2">
        {PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => onPick(p)}
            className="rounded-xl border border-border bg-card p-3 text-left text-sm text-foreground transition-all hover:border-primary/50 hover:shadow-glow"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
