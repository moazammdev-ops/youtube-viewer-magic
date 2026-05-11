import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chat } from "./ai-gateway";

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

/** Create a new video row and run topic + script + critique + refine. */
export const generateScriptNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context);
    const { supabase } = context;

    // Load settings
    const { data: settings, error: sErr } = await supabase.from("settings").select("*").eq("id", 1).single();
    if (sErr || !settings) throw new Error("Settings not found");

    // Create video row
    const { data: video, error: vErr } = await supabase
      .from("videos")
      .insert({ status: "generating_script" })
      .select()
      .single();
    if (vErr || !video) throw new Error(`Failed to create video: ${vErr?.message}`);

    try {
      // 1. Topic
      await logStep(supabase, video.id, "topic", "running");
      const topicRaw = await chat({
        messages: [
          { role: "system", content: "You return exactly one short topic title (max 10 words), no quotes, no preamble." },
          { role: "user", content: settings.niche_prompt },
        ],
      });
      const topic = topicRaw.trim().replace(/^["'#\-\s]+|["'\s]+$/g, "").slice(0, 200);
      await supabase.from("videos").update({ topic }).eq("id", video.id);
      await logStep(supabase, video.id, "topic", "ok", topic);

      // 2. Draft script (target 130-160 words ≈ 45-60s of voiceover)
      await logStep(supabase, video.id, "draft_script", "running");
      const draft = await chat({
        messages: [
          {
            role: "system",
            content:
              "You write punchy YouTube Shorts voiceover scripts (130-160 words, ~45-55 seconds spoken). " +
              "Hook in the first sentence. Conversational, vivid, no filler. " +
              "Do not include scene directions, camera notes, or speaker labels. Output plain prose only.",
          },
          { role: "user", content: `Topic: ${topic}\n\nWrite the voiceover script.` },
        ],
      });
      await supabase.from("videos").update({ draft_script: draft }).eq("id", video.id);
      await logStep(supabase, video.id, "draft_script", "ok");

      // 3. Critique
      await logStep(supabase, video.id, "critique", "running");
      const critique = await chat({
        model: "google/gemini-2.5-pro",
        messages: [
          {
            role: "system",
            content:
              "You are a brutal short-form video editor. Critique the script for: hook strength, factual accuracy " +
              "(flag anything dubious), pacing, word count (must be 130-160), and ending payoff. Bullet points, terse.",
          },
          { role: "user", content: draft },
        ],
      });
      await supabase.from("videos").update({ critique }).eq("id", video.id);
      await logStep(supabase, video.id, "critique", "ok");

      // 4. Refine
      await logStep(supabase, video.id, "refine", "running");
      const refined = await chat({
        messages: [
          {
            role: "system",
            content:
              "Rewrite the script applying the critique. Keep 130-160 words. Plain prose only — no labels, no scene notes.",
          },
          { role: "user", content: `SCRIPT:\n${draft}\n\nCRITIQUE:\n${critique}\n\nRewrite now:` },
        ],
      });
      await supabase
        .from("videos")
        .update({ refined_script: refined, status: "pending_approval" })
        .eq("id", video.id);
      await logStep(supabase, video.id, "refine", "ok");

      return { videoId: video.id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase.from("videos").update({ status: "failed", error_log: msg }).eq("id", video.id);
      await logStep(supabase, video.id, "error", "failed", msg);
      throw e;
    }
  });

export const listVideos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context);
    const { data, error } = await context.supabase
      .from("videos")
      .select("id, topic, status, created_at, youtube_video_id, final_video_url, thumbnail_url")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { videos: data ?? [] };
  });

export const getVideo = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().uuid() }).parse)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const { data: video, error } = await context.supabase
      .from("videos")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error || !video) throw new Error("Not found");
    const { data: runs } = await context.supabase
      .from("pipeline_runs")
      .select("*")
      .eq("video_id", data.id)
      .order("started_at", { ascending: true });
    return { video, runs: runs ?? [] };
  });

export const updateRefinedScript = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().uuid(), script: z.string().min(10).max(5000) }).parse)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const { error } = await context.supabase
      .from("videos")
      .update({ refined_script: data.script })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const rejectVideo = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().uuid() }).parse)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const { error } = await context.supabase
      .from("videos")
      .update({ status: "rejected" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context);
    const { data, error } = await context.supabase.from("settings").select("*").eq("id", 1).single();
    if (error || !data) throw new Error("Settings not found");
    return { settings: data };
  });

export const updateSettings = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      niche_prompt: z.string().min(10).max(2000),
      voice_id: z.string().min(3).max(100),
      schedule_cron: z.string().min(5).max(50),
      schedule_enabled: z.boolean(),
      default_title_template: z.string().min(1).max(200),
      default_description: z.string().min(1).max(5000),
      default_tags: z.array(z.string().min(1).max(50)).max(20),
      privacy_status: z.enum(["private", "unlisted", "public"]),
    }).parse,
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const { error } = await context.supabase.from("settings").update(data).eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });