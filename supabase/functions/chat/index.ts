// NovaMind chat edge function
// Streaming chat + vision + image generation via Lovable AI Gateway

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TONES: Record<string, string> = {
  balanced: "Be helpful, balanced and precise.",
  professional: "Be formal, structured, and business-oriented. Use professional language.",
  casual: "Be friendly, casual, and conversational. Use informal language.",
  creative: "Be highly creative, use metaphors, vivid language, and think outside the box.",
  technical: "Be precise and technical. Include code examples, technical details, and specifications.",
};

const REASONING: Record<string, string | undefined> = {
  off: undefined,
  low: "low",
  medium: "medium",
  high: "high",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const body = await req.json();
    const {
      messages = [],
      systemPrompt = null,
      tone = "balanced",
      mode = "chat", // 'chat' | 'image'
      reasoning = "off",
    } = body;

    // ---------- IMAGE GENERATION MODE ----------
    if (mode === "image") {
      const lastUser = [...messages].reverse().find((m: any) => m.role === "user");
      const prompt =
        typeof lastUser?.content === "string"
          ? lastUser.content
          : (lastUser?.content || []).find((p: any) => p.type === "text")?.text || "A beautiful image";

      const imgResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-image",
          messages: [{ role: "user", content: prompt }],
          modalities: ["image", "text"],
        }),
      });

      if (!imgResp.ok) {
        if (imgResp.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait a moment." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (imgResp.status === 402) {
          return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds in Lovable Cloud → Usage." }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const t = await imgResp.text();
        return new Response(JSON.stringify({ error: `Image generation failed: ${t}` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const data = await imgResp.json();
      const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      const text = data.choices?.[0]?.message?.content || "";

      return new Response(
        JSON.stringify({ imageUrl, text, prompt }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---------- CHAT (STREAMING) MODE ----------
    const hasImages = messages.some(
      (m: any) => Array.isArray(m.content) && m.content.some((p: any) => p.type === "image_url")
    );

    // Use vision-capable model when images are attached
    const model = hasImages ? "google/gemini-2.5-flash" : "google/gemini-3-flash-preview";

    const toneInstruction = TONES[tone] || TONES.balanced;
    const customPrompt = systemPrompt ? `\n\nAdditional instructions from user: ${systemPrompt}` : "";

    const systemContent =
      `You are NovaMind, a highly capable AI assistant with vision capabilities. ${toneInstruction} ` +
      `You can help with coding, writing, analysis, math, brainstorming, image analysis, and much more. ` +
      `When images are provided, analyze them thoroughly. Format responses using markdown when appropriate. ` +
      `Use fenced code blocks with language identifiers for code.${customPrompt}`;

    const requestBody: Record<string, unknown> = {
      model,
      messages: [{ role: "system", content: systemContent }, ...messages],
      stream: true,
    };
    const reasoningEffort = REASONING[reasoning];
    if (reasoningEffort) requestBody.reasoning = { effort: reasoningEffort };

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds in Lovable Cloud → Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
