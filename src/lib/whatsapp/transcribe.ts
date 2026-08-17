/**
 * Voice note -> text for the WhatsApp bot.
 *
 * WhatsApp voice notes arrive as audio/ogg (opus). Anthropic's API does not
 * take audio, so transcription goes through Groq's OpenAI-compatible Whisper
 * endpoint (whisper-large-v3, strong on Hebrew). Groq's free tier covers this
 * bot's volume; Asaf chose Groq over Gemini on 2026-08-17 (privacy: Groq does
 * not train on API data). Env: GROQ_API_KEY. When it is missing the bot tells
 * the user voice is unavailable instead of failing silently.
 *
 * The transcript is then handed to the SAME text pipeline (handleText), so a
 * spoken "תוציא קבלה לדני על 1200 שקל" behaves exactly like the typed one,
 * including the confirm-before-issue step.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL = "whisper-large-v3";
// Whisper caps at 25MB; WhatsApp voice notes are ~1MB/min. Anything above a
// few MB is not a voice note anyone meant to send to an invoicing bot.
const MAX_BYTES = 6_000_000;

export function transcriptionConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

export type TranscribeResult =
  | { ok: true; text: string }
  | { ok: false; reason: "unconfigured" | "too_large" | "empty" | "error" };

export async function transcribeAudio(base64: string, mimeType: string): Promise<TranscribeResult> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { ok: false, reason: "unconfigured" };

  const bytes = Buffer.from(base64, "base64");
  if (bytes.byteLength > MAX_BYTES) return { ok: false, reason: "too_large" };

  // "audio/ogg; codecs=opus" -> "ogg"; the filename extension is what the
  // endpoint uses to pick a decoder.
  const ext = /ogg/i.test(mimeType) ? "ogg" : /mp4|m4a|aac/i.test(mimeType) ? "m4a" : /mpeg|mp3/i.test(mimeType) ? "mp3" : /amr/i.test(mimeType) ? "amr" : "ogg";
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType.split(";")[0] || "audio/ogg" }), `voice.${ext}`);
  form.append("model", MODEL);
  form.append("response_format", "json");
  form.append("temperature", "0");
  // No fixed language: users may mix Hebrew and English (client names, product
  // names). Whisper auto-detects; a Hebrew prompt biases it toward Hebrew
  // vocabulary and the domain without forcing the language.
  form.append("prompt", "הודעה קולית לבוט חשבוניות: קבלה, חשבונית, לקוח, סכום בשקלים, העברה בנקאית, ביט, מזומן.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[whatsapp] transcription failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return { ok: false, reason: "error" };
    }
    const data = (await res.json()) as { text?: string };
    const text = (data.text || "").trim();
    if (!text) return { ok: false, reason: "empty" };
    return { ok: true, text };
  } catch (e) {
    console.error("[whatsapp] transcription error:", e instanceof Error ? e.message : e);
    return { ok: false, reason: "error" };
  } finally {
    clearTimeout(timer);
  }
}
