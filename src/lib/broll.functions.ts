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

type BrollClip = {
  source: "pexels" | "pixabay";
  id: string;
  url: string;
  thumbnail: string;
  duration: number;
  width: number;
  height: number;
  query: string;
};

async function searchPexels(query: string, apiKey: string): Promise<BrollClip[]> {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&size=medium&per_page=5`;
  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) return [];
  const json = (await res.json()) as any;
  return (json.videos ?? []).slice(0, 3).map((v: any): BrollClip => {
    const file =
      v.video_files?.find((f: any) => f.quality === "hd" && f.height >= f.width) ??
      v.video_files?.find((f: any) => f.height >= f.width) ??
      v.video_files?.[0];
    return {
      source: "pexels",
      id: String(v.id),
      url: file?.link ?? "",
      thumbnail: v.image,
      duration: v.duration ?? 0,
      width: file?.width ?? v.width,
      height: file?.height ?? v.height,
      query,
    };
  });
}

async function searchPixabay(query: string, apiKey: string): Promise<BrollClip[]> {
  const url = `https://pixabay.com/api/videos/?key=${apiKey}&q=${encodeURIComponent(query)}&per_page=5&orientation=vertical`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = (await res.json()) as any;
  return (json.hits ?? []).slice(0, 3).map((v: any): BrollClip => {
    const file = v.videos?.medium ?? v.videos?.small ?? v.videos?.tiny;
    return {
      source: "pixabay",
      id: String(v.id),
      url: file?.url ?? "",
      thumbnail: `https://i.vimeocdn.com/video/${v.picture_id}_295x166.jpg`,
      duration: v.duration ?? 0,
      width: file?.width ?? 0,
      height: file?.height ?? 0,
      query,
    };
  });
}

export const searchBroll = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().uuid() }).parse)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const { supabase } = context;
    const pexelsKey = process.env.PEXELS_API_KEY;
    const pixabayKey = process.env.PIXABAY_API_KEY;
    if (!pexelsKey) throw new Error("PEXELS_API_KEY not configured");
    if (!pixabayKey) throw new Error("PIXABAY_API_KEY not configured");

    const { data: video, error: vErr } = await supabase
      .from("videos")
      .select("id, topic, refined_script")
      .eq("id", data.id)
      .single();
    if (vErr || !video) throw new Error("Video not found");
    if (!video.refined_script) throw new Error("Refined script missing");

    await logStep(supabase, data.id, "broll", "running");

    try {
      // Ask AI for 6 visual search queries
      const raw = await chat({
        messages: [
          {
            role: "system",
            content:
              "Output ONLY a JSON array of 6 short visual search queries (1-3 words each, concrete nouns/visuals) " +
              "suitable for stock-footage search to illustrate the script. No prose, no markdown.",
          },
          { role: "user", content: `Topic: ${video.topic}\n\nScript:\n${video.refined_script}` },
        ],
      });
      const cleaned = raw.replace(/```json|```/g, "").trim();
      let queries: string[] = [];
      try {
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) queries = parsed.filter((q) => typeof q === "string").slice(0, 6);
      } catch {
        queries = cleaned
          .split(/[\n,]+/)
          .map((s) => s.replace(/^[\-\d.\s"']+|["'\s]+$/g, ""))
          .filter(Boolean)
          .slice(0, 6);
      }
      if (queries.length === 0) queries = [video.topic ?? "abstract"];

      const results = await Promise.all(
        queries.flatMap((q) => [searchPexels(q, pexelsKey), searchPixabay(q, pixabayKey)]),
      );
      const clips = results.flat().filter((c) => c.url);

      await supabase
        .from("videos")
        .update({ broll_clips: clips })
        .eq("id", data.id);
      await logStep(supabase, data.id, "broll", "ok", `${clips.length} clips for ${queries.length} queries`);
      return { count: clips.length, queries };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logStep(supabase, data.id, "broll", "failed", msg);
      throw e;
    }
  });