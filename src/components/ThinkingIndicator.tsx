export function ThinkingIndicator() {
  return (
    <div className="flex gap-4 px-4 py-6 animate-fade-in">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-primary shadow-glow">
        <span className="text-sm">✨</span>
      </div>
      <div className="flex items-center gap-1 pt-2">
        <span className="h-2 w-2 rounded-full bg-primary animate-typing" style={{ animationDelay: "0ms" }} />
        <span className="h-2 w-2 rounded-full bg-primary animate-typing" style={{ animationDelay: "200ms" }} />
        <span className="h-2 w-2 rounded-full bg-primary animate-typing" style={{ animationDelay: "400ms" }} />
      </div>
    </div>
  );
}
