import { createFileRoute } from "@tanstack/react-router";

const MEM0_BASE = "https://api.mem0.ai/v1";
const SYSTEM = `You are Glow, a warm, concise voice assistant living inside a glowing ribbon of light.
Speak like a person, not a document: 1-3 short sentences, no markdown, no lists, no emoji.
Use the remembered facts when they are relevant, and never mention that you have a memory system.`;

type Mem = { memory?: string; text?: string };

async function recall(userId: string, query: string): Promise<string[]> {
  const key = process.env["MEM0_API_KEY"];
  if (!key) return [];
  try {
    const res = await fetch(`${MEM0_BASE}/memories/search/`, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, user_id: userId, limit: 6 }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Mem[] | { results?: Mem[] };
    const list = Array.isArray(data) ? data : (data.results ?? []);
    return list.map((m) => m.memory ?? m.text ?? "").filter(Boolean);
  } catch {
    return [];
  }
}

async function remember(userId: string, userText: string, replyText: string) {
  const key = process.env["MEM0_API_KEY"];
  if (!key) return;
  try {
    await fetch(`${MEM0_BASE}/memories/`, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        messages: [
          { role: "user", content: userText },
          { role: "assistant", content: replyText },
        ],
      }),
    });
  } catch {
    /* memory is best-effort */
  }
}

async function transcribe(audio: ArrayBuffer, contentType: string): Promise<string> {
  const key = process.env["DEEPGRAM_API_KEY"];
  if (!key) throw new Response("Deepgram key is not configured", { status: 503 });

  const url =
    "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true&language=en";
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": contentType },
    body: audio,
  });
  if (!res.ok) {
    throw new Response(`Transcription failed: ${await res.text().catch(() => res.statusText)}`, {
      status: res.status,
    });
  }
  const data = (await res.json()) as {
    results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
  };
  return data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
}

async function reply(
  transcript: string,
  memories: string[],
  history: { role: "user" | "assistant"; content: string }[],
): Promise<string> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Response("AI is not configured", { status: 503 });

  const memoryBlock = memories.length
    ? `\n\nThings you remember about this person:\n- ${memories.join("\n- ")}`
    : "";

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3.7-flash",
      messages: [
        { role: "system", content: SYSTEM + memoryBlock },
        ...history.slice(-8),
        { role: "user", content: transcript },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Response(
      res.status === 402
        ? "AI credits are exhausted — add credits in Lovable to keep talking."
        : `AI request failed: ${detail}`,
      { status: res.status },
    );
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

export const Route = createFileRoute("/api/agent/turn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const form = await request.formData();
          const file = form.get("audio");
          const userId = String(form.get("userId") ?? "").slice(0, 64) || "anon";
          let history: { role: "user" | "assistant"; content: string }[] = [];
          try {
            history = JSON.parse(String(form.get("history") ?? "[]"));
          } catch {
            history = [];
          }

          if (!(file instanceof File) || file.size < 2048) {
            return Response.json({ error: "That recording was empty." }, { status: 400 });
          }
          if (file.size > 20 * 1024 * 1024) {
            return Response.json({ error: "That recording is too long." }, { status: 413 });
          }

          const transcript = await transcribe(
            await file.arrayBuffer(),
            file.type || "audio/webm",
          );
          if (!transcript) {
            return Response.json({ transcript: "", reply: "", empty: true });
          }

          const memories = await recall(userId, transcript);
          const text = await reply(transcript, memories, history);
          await remember(userId, transcript, text);

          return Response.json({ transcript, reply: text, memories });
        } catch (error) {
          if (error instanceof Response) {
            return Response.json({ error: await error.text() }, { status: error.status });
          }
          console.error(error);
          return Response.json({ error: "Something went wrong." }, { status: 500 });
        }
      },
    },
  },
});
