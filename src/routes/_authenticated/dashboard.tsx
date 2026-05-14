import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { generateScriptNow, getLatestVideo, listVideos, deleteVideo } from "@/lib/pipeline.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — ShortsForge" }] }),
  component: Dashboard,
});

const STATUS_LABELS: Record<string, { label: string; tone: "default" | "secondary" | "destructive" | "outline" }> = {
  queued: { label: "Queued", tone: "outline" },
  generating_script: { label: "Writing script", tone: "secondary" },
  generating_voiceover: { label: "Voicing", tone: "secondary" },
  searching_broll: { label: "Finding b-roll", tone: "secondary" },
  rendering: { label: "Rendering", tone: "secondary" },
  pending_approval: { label: "Needs review", tone: "default" },
  pending_publish: { label: "Ready to publish", tone: "default" },
  approved: { label: "Approved", tone: "default" },
  publishing: { label: "Publishing", tone: "secondary" },
  published: { label: "Published", tone: "default" },
  rejected: { label: "Rejected", tone: "outline" },
  failed: { label: "Failed", tone: "destructive" },
};

const PIPELINE_STEPS = [
  { key: "topic", label: "Topic" },
  { key: "draft_script", label: "Script draft" },
  { key: "critique", label: "Script critique" },
  { key: "refine", label: "Script refine" },
  { key: "voiceover", label: "Voiceover" },
  { key: "broll", label: "Video fetching" },
  { key: "render_dispatch", label: "Render dispatch" },
  { key: "render", label: "Video generation" },
] as const;

function getPipelineState(runs: Array<{ step: string; status: string }>) {
  const byStep = new Map<string, "ok" | "running" | "failed" | "pending">();
  for (const step of PIPELINE_STEPS) byStep.set(step.key, "pending");

  for (const run of runs) {
    if (!byStep.has(run.step)) continue;
    if (run.status === "failed") byStep.set(run.step, "failed");
    else if (run.status === "running") byStep.set(run.step, "running");
    else if (run.status === "ok") byStep.set(run.step, "ok");
  }

  const completed = PIPELINE_STEPS.filter((s) => byStep.get(s.key) === "ok").length;
  const failed = PIPELINE_STEPS.some((s) => byStep.get(s.key) === "failed");
  const running = PIPELINE_STEPS.find((s) => byStep.get(s.key) === "running");
  const nextPending = PIPELINE_STEPS.find((s) => byStep.get(s.key) === "pending");

  return {
    pct: Math.round((completed / PIPELINE_STEPS.length) * 100),
    failed,
    runningLabel: running?.label ?? null,
    nextLabel: nextPending?.label ?? null,
    byStep,
  };
}

function Dashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [latestCreatedId, setLatestCreatedId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const list = useServerFn(listVideos);
  const latest = useServerFn(getLatestVideo);
  const generate = useServerFn(generateScriptNow);
  const deleteVideoFn = useServerFn(deleteVideo);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setAccessToken(data.session?.access_token ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAccessToken(session?.access_token ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const openReview = (id: string) => {
    navigate({ to: "/video/$id", params: { id } });
    setTimeout(() => {
      if (window.location.pathname !== `/video/${id}`) {
        window.location.assign(`/video/${id}`);
      }
    }, 150);
  };

  const videosQ = useQuery({
    queryKey: ["videos"],
    queryFn: () =>
      list({
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
      }),
    enabled: !!accessToken,
    refetchInterval: 5000,
  });

  const gen = useMutation({
    mutationFn: () =>
      generate({
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
      }),
    onSuccess: async (result) => {
      toast.success("Script generated. Review it now.");
      if (result?.videoId) {
        setLatestCreatedId(result.videoId);
        openReview(result.videoId);
        return;
      }
      const newest = await latest({
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
      });
      const newestId = newest?.video?.id;
      if (newestId) {
        setLatestCreatedId(newestId);
        openReview(newestId);
      } else {
        toast.error("Generated, but could not find the video record. Refresh and try again.");
      }
      qc.invalidateQueries({ queryKey: ["videos"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Generation failed"),
  });
  const del = useMutation({
    mutationFn: (id: string) =>
      deleteVideoFn({
        data: { id },
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
      }),
    onSuccess: () => {
      toast.success("Video deleted");
      qc.invalidateQueries({ queryKey: ["videos"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const videos = videosQ.data?.videos ?? [];

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Generated videos pending your review.</p>
        </div>
        <Button onClick={() => gen.mutate()} disabled={gen.isPending}>
          {gen.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          Generate now
        </Button>
      </header>

      {latestCreatedId && (
        <div className="mb-4">
          <Button variant="outline" size="sm" onClick={() => openReview(latestCreatedId)}>
            Open latest generated script
          </Button>
        </div>
      )}

      {videosQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : videosQ.isError ? (
        <Card className="border-destructive">
          <CardContent className="py-6 text-sm text-destructive">
            Failed to load videos: {videosQ.error instanceof Error ? videosQ.error.message : "Unknown error"}
          </CardContent>
        </Card>
      ) : videos.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No videos yet. Click <strong>Generate now</strong> to create your first script.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {videos.map((v) => {
            const s = STATUS_LABELS[v.status] ?? { label: v.status, tone: "outline" as const };
            const p = getPipelineState((v.runs ?? []) as Array<{ step: string; status: string }>);
            return (
              <Link
                key={v.id}
                to="/video/$id"
                params={{ id: v.id }}
                className="block rounded-lg border bg-card p-4 transition-colors hover:bg-secondary/40"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{v.topic ?? "Untitled"}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(v.created_at).toLocaleString()}
                    </p>
                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>
                          {p.failed
                            ? "Pipeline failed"
                            : p.runningLabel
                              ? `In progress: ${p.runningLabel}`
                              : p.nextLabel
                                ? `Next: ${p.nextLabel}`
                                : "Pipeline complete"}
                        </span>
                        <span>{p.pct}%</span>
                      </div>
                      <Progress value={p.pct} className="h-1.5" />
                      <div className="mt-2 flex flex-wrap gap-1">
                        {PIPELINE_STEPS.map((step) => {
                          const state = p.byStep.get(step.key);
                          const tone =
                            state === "ok"
                              ? "bg-emerald-100 text-emerald-700"
                              : state === "running"
                                ? "bg-blue-100 text-blue-700"
                                : state === "failed"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-muted text-muted-foreground";
                          return (
                            <span key={step.key} className={`rounded px-1.5 py-0.5 text-[10px] ${tone}`}>
                              {step.label}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={s.tone}>{s.label}</Badge>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 px-2 text-xs"
                      disabled={del.isPending}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!window.confirm("Delete this render from the list? This cannot be undone.")) return;
                        del.mutate(v.id);
                      }}
                    >
                      <Trash2 className="mr-1 h-3 w-3" />
                      Delete
                    </Button>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
