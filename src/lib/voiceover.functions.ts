import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function ensureAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error || !data) throw new Error("Admin access required");
}

async function logStep(supabase: any, videoId: string, step: string, status: string, log?: string) {
  await supabase.from("pipeline_runs").insert({
    video_id: videoId,
    step,
    status,
    log: log ?? null,
    finished_at: status === "running" ? null : new Date().toISOString(),
  });
}

function mapElevenLabsError(status: number, raw: string) {
  const text = raw.toLowerCase();
  const isAbuseBlock =
    status === 401 &&
    (text.includes("unusual activity") ||
      text.includes("free tier usage disabled") ||
      text.includes("abuse detectors") ||
      text.includes("proxy/vpn"));
  if (isAbuseBlock) {
    return "ElevenLabs blocked this request (unusual activity / Free tier disabled). Use a paid ElevenLabs plan or a clean non-VPN/proxy network, then retry.";
  }
  if (status === 401) return "ElevenLabs authentication failed. Verify ELEVENLABS_API_KEY and retry.";
  if (status === 429) return "ElevenLabs rate limit reached. Wait a moment and retry.";
  return `ElevenLabs ${status}: ${raw}`;
}

export const generateVoiceover = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().uuid() }).parse)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const { supabase } = context;
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured");

    const { data: video, error: vErr } = await supabase
      .from("videos")
      .select("id, refined_script")
      .eq("id", data.id)
      .single();
    if (vErr || !video) throw new Error("Video not found");
    if (!video.refined_script) throw new Error("Refined script missing — generate script first");

    const { data: settings } = await supabase.from("settings").select("voice_id").eq("id", 1).single();
    const voiceId = settings?.voice_id ?? "JBFqnCBsd6RMkjVDRZzb";

    await supabase.from("videos").update({ status: "generating_voiceover" }).eq("id", data.id);
    await logStep(supabase, data.id, "voiceover", "running");

    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            text: video.refined_script,
            model_id: "eleven_multilingual_v2",
            voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.4, use_speaker_boost: true },
          }),
        },
      );
      if (!res.ok) {
        const raw = await res.text();
        const userMsg = mapElevenLabsError(res.status, raw);
        throw new Error(userMsg);
      }
      const json = (await res.json()) as {
        audio_base64: string;
        alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
        normalized_alignment?: any;
      };

      const audioBuffer = Buffer.from(json.audio_base64, "base64");
      const path = `${data.id}/voiceover.mp3`;
      const { error: upErr } = await supabase.storage
        .from("voiceovers")
        .upload(path, audioBuffer, { contentType: "audio/mpeg", upsert: true });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

      const duration =
        json.alignment?.character_end_times_seconds?.slice(-1)[0] ?? null;

      await supabase
        .from("videos")
        .update({
          voiceover_url: path,
          voiceover_duration_seconds: duration,
          alignment_data: json.alignment ?? null,
          status: "pending_approval",
        })
        .eq("id", data.id);
      await logStep(supabase, data.id, "voiceover", "ok", `${duration?.toFixed(1)}s`);
      return { ok: true, duration };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase.from("videos").update({ status: "failed", error_log: msg }).eq("id", data.id);
      await logStep(supabase, data.id, "voiceover", "failed", msg);
      throw e;
    }
  });

export const getVoiceoverUrl = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().uuid() }).parse)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const { data: v } = await context.supabase
      .from("videos")
      .select("voiceover_url")
      .eq("id", data.id)
      .single();
    if (!v?.voiceover_url) return { url: null };
    const { data: signed, error } = await context.supabase.storage
      .from("voiceovers")
      .createSignedUrl(v.voiceover_url, 3600);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });

/**
 * Test-mode voiceover using Google Translate's free TTS endpoint.
 * Lower quality, no timestamps, but no API key and not rate-limited per account.
 * Use only to validate the render pipeline when ElevenLabs is unavailable.
 */
export const generateTestVoiceover = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().uuid() }).parse)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const { supabase } = context;

    const { data: video, error: vErr } = await supabase
      .from("videos")
      .select("id, refined_script")
      .eq("id", data.id)
      .single();
    if (vErr || !video) throw new Error("Video not found");
    if (!video.refined_script) throw new Error("Refined script missing — generate script first");

    await supabase.from("videos").update({ status: "generating_voiceover" }).eq("id", data.id);
    await logStep(supabase, data.id, "voiceover", "running", "test mode (google translate tts)");

    try {
      // Chunk script into <=180-char pieces at sentence/word boundaries.
      const chunks: string[] = [];
      const sentences = video.refined_script
        .replace(/\s+/g, " ")
        .split(/(?<=[.!?])\s+/);
      let current = "";
      for (const s of sentences) {
        if ((current + " " + s).trim().length <= 180) {
          current = (current + " " + s).trim();
        } else {
          if (current) chunks.push(current);
          if (s.length <= 180) {
            current = s;
          } else {
            // Hard wrap by words
            const words = s.split(" ");
            let buf = "";
            for (const w of words) {
              if ((buf + " " + w).trim().length > 180) {
                if (buf) chunks.push(buf);
                buf = w;
              } else {
                buf = (buf + " " + w).trim();
              }
            }
            current = buf;
          }
        }
      }
      if (current) chunks.push(current);

      const buffers: Buffer[] = [];
      for (const chunk of chunks) {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=en&client=tw-ob`;
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        if (!res.ok) throw new Error(`Google TTS ${res.status}: ${await res.text().catch(() => "")}`);
        buffers.push(Buffer.from(await res.arrayBuffer()));
      }
      const audioBuffer = Buffer.concat(buffers);

      const path = `${data.id}/voiceover.mp3`;
      const { error: upErr } = await supabase.storage
        .from("voiceovers")
        .upload(path, audioBuffer, { contentType: "audio/mpeg", upsert: true });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

      // Google TTS returns ~32 kbps mono MP3. duration ≈ bytes / 4000.
      const duration = Math.max(1, Math.round((audioBuffer.byteLength / 4000) * 10) / 10);

      await supabase
        .from("videos")
        .update({
          voiceover_url: path,
          voiceover_duration_seconds: duration,
          alignment_data: null,
          status: "pending_approval",
        })
        .eq("id", data.id);
      await logStep(supabase, data.id, "voiceover", "ok", `test mode · ${duration}s · ${chunks.length} chunks`);
      return { ok: true, duration, chunks: chunks.length };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase.from("videos").update({ status: "failed", error_log: msg }).eq("id", data.id);
      await logStep(supabase, data.id, "voiceover", "failed", msg);
      throw e;
    }
  });
