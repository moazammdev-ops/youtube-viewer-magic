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
      if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
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