const MODEL = "gemini-3.8-flash";
const PROMPT =
  "An artist searched a 3D asset library, then refined the results line by line. Write a short title for what is on screen now: a plain noun phrase in sentence case, at most 8 words, using only what the lines say. Keep counts, order and people they name. No quotes, no trailing period.";

const titles = new Map<string, string>();

export const titleEnabled = () => !!process.env.GEMINI_API_KEY?.trim();

/** A plain-English name for a thread's result, rewritten from the artist's own lines. Null without a key or on any failure: the caller keeps the first line. */
export async function threadTitle(lines: string[]): Promise<string | null> {
  const key = lines.join("\n").toLowerCase();
  const hit = titles.get(key);
  if (hit) return hit;
  if (!titleEnabled()) return null;
  const ask = () =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY!.trim() },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: PROMPT }] },
        contents: [{ role: "user", parts: [{ text: lines.map((l, i) => `${i + 1}. ${l}`).join("\n") }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 400, thinkingConfig: { thinkingLevel: "low" } },
      }),
    });
  let res = await ask();
  if (res.status >= 500) res = await new Promise((r) => setTimeout(r, 600)).then(ask);
  if (!res.ok) return null;
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim().replace(/^["“]|["”.]$/g, "");
  if (!text || text.split(/\s+/).length > 12) return null;
  titles.set(key, text);
  return text;
}
