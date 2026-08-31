import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/agent/speak")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return new Response("AI is not configured", { status: 503 });

        const { text } = (await request.json()) as { text?: string };
        if (!text?.trim()) return new Response("Nothing to speak", { status: 400 });

        const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "openai/gpt-4o-mini-tts",
            input: text.slice(0, 4000),
            voice: "alloy",
            instructions: "Speak warmly and calmly, with an unhurried, conversational pace.",
            stream_format: "sse",
            response_format: "pcm",
          }),
        });

        if (!res.ok) {
          return new Response(await res.text().catch(() => "Speech failed"), {
            status: res.status,
          });
        }

        return new Response(res.body, { headers: { "Content-Type": "text/event-stream" } });
      },
    },
  },
});
