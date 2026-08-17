import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribeAudio, transcriptionConfigured } from "@/lib/whatsapp/transcribe";

const OGG_B64 = Buffer.from("fake-opus-bytes").toString("base64");

describe("whatsapp transcribe (Groq Whisper)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GROQ_API_KEY;
  });

  it("reports unconfigured when GROQ_API_KEY is absent (bot must say voice is unavailable, not crash)", async () => {
    delete process.env.GROQ_API_KEY;
    expect(transcriptionConfigured()).toBe(false);
    expect(await transcribeAudio(OGG_B64, "audio/ogg; codecs=opus")).toEqual({ ok: false, reason: "unconfigured" });
  });

  it("rejects oversized audio before calling the API", async () => {
    process.env.GROQ_API_KEY = "k";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const big = Buffer.alloc(6_000_001).toString("base64");
    expect(await transcribeAudio(big, "audio/ogg")).toEqual({ ok: false, reason: "too_large" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts multipart to Groq with the whisper model and returns the trimmed text", async () => {
    process.env.GROQ_API_KEY = "test-key";
    let captured: { url: string; init: RequestInit } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        captured = { url, init };
        return new Response(JSON.stringify({ text: "  תוציא קבלה לדני על 1200 שקל  " }), { status: 200 });
      }),
    );
    const r = await transcribeAudio(OGG_B64, "audio/ogg; codecs=opus");
    expect(r).toEqual({ ok: true, text: "תוציא קבלה לדני על 1200 שקל" });
    expect(captured!.url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect((captured!.init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    const form = captured!.init.body as FormData;
    expect(form.get("model")).toBe("whisper-large-v3");
    const file = form.get("file") as File;
    expect(file.name).toBe("voice.ogg");
  });

  it("maps an empty transcript and an HTTP error to distinct reasons", async () => {
    process.env.GROQ_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ text: "   " }), { status: 200 })));
    expect(await transcribeAudio(OGG_B64, "audio/ogg")).toEqual({ ok: false, reason: "empty" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    expect(await transcribeAudio(OGG_B64, "audio/ogg")).toEqual({ ok: false, reason: "error" });
  });
});
