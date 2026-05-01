import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ChatInput, type ChatMode } from "./ChatInput";

/**
 * Stress-test the voice-input feature in ChatInput by mocking the
 * Web Speech API. We simulate multiple consecutive recording sessions,
 * each emitting interim results that get re-fired several times before
 * being finalized — which is the exact pattern that previously caused
 * words to be duplicated 2-3x in the textarea.
 *
 * Assertions:
 *  1. After each session ends, the textarea contains each spoken word
 *     exactly once (no duplication).
 *  2. After every session, the mic returns to the non-listening state
 *     (no stuck "listening" UI).
 *  3. Across 5 consecutive sessions the transcript grows monotonically
 *     and never re-introduces an already-committed phrase.
 */

type ResultItem = { transcript: string };
type ResultRow = ResultItem[] & { isFinal: boolean };

function makeResult(transcript: string, isFinal: boolean): ResultRow {
  const row = [{ transcript }] as unknown as ResultRow;
  row.isFinal = isFinal;
  return row;
}

class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  static instances: MockSpeechRecognition[] = [];

  constructor() {
    MockSpeechRecognition.instances.push(this);
  }
  start() {
    this.started = true;
  }
  stop() {
    this.started = false;
    this.onend?.();
  }
  /** Helper used by tests to push a results array. */
  emit(results: ResultRow[], resultIndex = 0) {
    this.onresult?.({ results, resultIndex });
  }
}

function Harness() {
  // We don't care about the parent state machine — just render the input
  // with stable props so we can drive the mic.
  const [mode, setMode] = (
    require("react") as typeof import("react")
  ).useState<ChatMode>("chat");
  return (
    <ChatInput
      onSend={() => {}}
      isLoading={false}
      onStop={() => {}}
      mode={mode}
      setMode={setMode}
    />
  );
}

function getTextarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(/Message NovaMind/i) as HTMLTextAreaElement;
}

function getMicButton(): HTMLButtonElement {
  // The mic button has title "Voice input" or "Stop"
  return (screen.queryByTitle("Voice input") ||
    screen.getByTitle("Stop")) as HTMLButtonElement;
}

function startSession() {
  act(() => {
    getMicButton().click();
  });
  const rec =
    MockSpeechRecognition.instances[MockSpeechRecognition.instances.length - 1];
  expect(rec.started).toBe(true);
  return rec;
}

/**
 * Drives a session that "speaks" the given phrase as a sequence of
 * interim chunks that each get re-fired multiple times before being
 * promoted to final. This mirrors the buggy real-world behavior where
 * the same final result event arrives more than once.
 */
function speakPhrase(rec: MockSpeechRecognition, phrase: string) {
  const words = phrase.split(" ");
  const finals: ResultRow[] = [];

  words.forEach((word, idx) => {
    // Interim fires twice with growing transcript
    act(() => {
      rec.emit([...finals, makeResult(word, false)]);
    });
    act(() => {
      rec.emit([...finals, makeResult(word, false)]);
    });
    // Promote to final
    const finalRow = makeResult(word, true);
    finals.push(finalRow);
    act(() => {
      rec.emit([...finals]);
    });
    // Re-fire the same final event again — this is the duplication trigger
    act(() => {
      rec.emit([...finals], idx);
    });
  });

  // End the session
  act(() => {
    rec.stop();
  });
}

describe("ChatInput voice input — duplication & stuck-state stress test", () => {
  beforeEach(() => {
    MockSpeechRecognition.instances = [];
    (window as any).SpeechRecognition = MockSpeechRecognition;
    (window as any).webkitSpeechRecognition = MockSpeechRecognition;
  });

  it("does not duplicate words within a single session", () => {
    render(<Harness />);
    const rec = startSession();
    speakPhrase(rec, "hello world this is a test");

    const value = getTextarea().value.trim();
    expect(value).toBe("hello world this is a test");

    // Mic should have flipped back to "Voice input" (not stuck on Stop)
    expect(screen.getByTitle("Voice input")).toBeInTheDocument();
  });

  it("survives 5 consecutive recording sessions without duplication or stuck state", () => {
    render(<Harness />);

    const phrases = [
      "first phrase",
      "second one",
      "third short",
      "another four words here",
      "final phrase done",
    ];

    let previous = "";
    for (const phrase of phrases) {
      const rec = startSession();
      speakPhrase(rec, phrase);

      const value = getTextarea().value;

      // Transcript grows monotonically — old content is preserved verbatim
      expect(value.startsWith(previous)).toBe(true);

      // Each word in this phrase appears exactly once across the WHOLE textarea
      // for this session's contribution.
      const newPart = value.slice(previous.length).trim();
      const words = newPart.split(/\s+/).filter(Boolean);
      const seen = new Set<string>();
      for (const w of words) {
        // Words are unique within each test phrase, so any repeat = a bug
        expect(seen.has(w), `word "${w}" duplicated in: ${value}`).toBe(false);
        seen.add(w);
      }
      expect(words).toEqual(phrase.split(" "));

      // Mic must not be stuck listening between sessions
      expect(screen.getByTitle("Voice input")).toBeInTheDocument();

      previous = value.trimEnd();
    }

    // Final transcript contains every phrase exactly once, in order
    expect(getTextarea().value.trim()).toBe(phrases.join(" "));

    // 5 separate recognizer instances were created (one per session)
    expect(MockSpeechRecognition.instances.length).toBe(5);
  });

  it("ignores re-fired final events with the same resultIndex", () => {
    render(<Harness />);
    const rec = startSession();

    const finals = [makeResult("alpha", true), makeResult("beta", true)];
    // Fire the same final batch 4 times — should commit each word once.
    act(() => rec.emit(finals));
    act(() => rec.emit(finals));
    act(() => rec.emit(finals));
    act(() => rec.emit(finals));
    act(() => rec.stop());

    expect(getTextarea().value.trim()).toBe("alpha beta");
    expect(screen.getByTitle("Voice input")).toBeInTheDocument();
  });
});