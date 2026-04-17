import { useCallback, useEffect, useState } from "react";

/** Browser-native text-to-speech (free, works offline, no API key). */
export function useTTS() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis?.getVoices() ?? []);
    load();
    window.speechSynthesis?.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", load);
  }, []);

  const speak = useCallback((text: string, voiceURI?: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const clean = text.replace(/```[\s\S]*?```/g, " code block ").replace(/[*_#`>]/g, "");
    const utter = new SpeechSynthesisUtterance(clean);
    if (voiceURI) {
      const v = voices.find((v) => v.voiceURI === voiceURI);
      if (v) utter.voice = v;
    }
    utter.rate = 1.05;
    utter.pitch = 1;
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utter);
  }, [voices]);

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  return { voices, speak, stop, speaking };
}
