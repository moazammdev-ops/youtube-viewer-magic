import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/render-callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.REMOTION_HOST_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });

        const sig = request.headers.get("x-signature") ?? "";
        const raw = await request.text();
        const expected = createHmac("sha256", secret).update(raw).digest("hex");
        const ok =
          sig.length === expected.length &&
          timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
        if (!ok) return new Response("Invalid signature", { status: 401 });

        let body: {
          videoId?: string;
          status?: "completed" | "failed";
          mp4Url?: string;
          mp4Base64?: string;
          error?: string;
          thumbnailUrl?: string;
        };
        try {
          body = JSON.parse(raw);
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }

        if (!body.videoId) return new Response("Missing videoId", { status: 400 });

        if (body.status === "failed") {
          await supabaseAdmin
            .from("videos")
            .update({ status: "failed", error_log: body.error ?? "Render failed" })
            .eq("id", body.videoId);
          await supabaseAdmin.from("pipeline_runs").insert({
            video_id: body.videoId,
            step: "render",
            status: "failed",
            log: body.error ?? null,
            finished_at: new Date().toISOString(),
          });
          return new Response("ok");
        }

        // Get bytes either from a remote URL or inline base64
        let bytes: Uint8Array | null = null;
        if (body.mp4Url) {
          const r = await fetch(body.mp4Url);
          if (!r.ok) return new Response("Failed to fetch mp4Url", { status: 502 });
          bytes = new Uint8Array(await r.arrayBuffer());
        } else if (body.mp4Base64) {
          bytes = Uint8Array.from(Buffer.from(body.mp4Base64, "base64"));
        } else {
          return new Response("Missing mp4Url or mp4Base64", { status: 400 });
        }

        const path = `${body.videoId}/final.mp4`;
        const { error: upErr } = await supabaseAdmin.storage
          .from("final-videos")
          .upload(path, bytes, { contentType: "video/mp4", upsert: true });
        if (upErr) return new Response(`Upload failed: ${upErr.message}`, { status: 500 });

        await supabaseAdmin
          .from("videos")
          .update({
            final_video_url: path,
            status: "pending_publish",
            error_log: null,
            ...(body.thumbnailUrl ? { thumbnail_url: body.thumbnailUrl } : {}),
          })
          .eq("id", body.videoId);

        await supabaseAdmin.from("pipeline_runs").insert({
          video_id: body.videoId,
          step: "render",
          status: "ok",
          finished_at: new Date().toISOString(),
        });

        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});