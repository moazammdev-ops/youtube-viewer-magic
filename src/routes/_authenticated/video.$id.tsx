import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getVideo, updateRefinedScript, rejectVideo, triggerRender, getFinalVideoUrl, cancelRender } from "@/lib/pipeline.functions";
import { generateVoiceover, getVoiceoverUrl } from "@/lib/voiceover.functions";
import { searchBroll } from "@/lib/broll.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ArrowLeft, Mic, Film, Video as VideoIcon, Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/video/$id")({
  head: () => ({ meta: [{ title: "Video — ShortsForge" }] }),
  component: VideoDetail,
});

function VideoDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const fetchVideo = useServerFn(getVideo);
  const updateScript = useServerFn(updateRefinedScript);
  const reject = useServerFn(rejectVideo);
  const genVoice = useServerFn(generateVoiceover);
  const getVoUrl = useServerFn(getVoiceoverUrl);
  const searchClips = useServerFn(searchBroll);
  const trigRender = useServerFn(triggerRender);
  const getFinalUrl = useServerFn(getFinalVideoUrl);
  const cancelRenderFn = useServerFn(cancelRender);
  const [accessToken, setAccessToken] = useState<string | null>(null);

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

  const q = useQuery({
    queryKey: ["video", id],
    queryFn: () =>
      fetchVideo({
        data: { id },
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
      }),
    enabled: !!accessToken,
    refetchInterval: (query) => {
      const status = query.state.data?.video?.status;
      // Poll fast during in-flight work; stop entirely once render completes successfully
      if (status === "rendering") return 3000;
      if (status === "generating_script") return 3000;
      if (status === "pending_publish" || status === "published") return false;
      return 8000;
    },
  });

  const [script, setScript] = useState("");
  useEffect(() => {
    if (q.data?.video?.refined_script != null) setScript(q.data.video.refined_script);
  }, [q.data?.video?.refined_script]);

  const save = useMutation({
    mutationFn: () =>
      updateScript({
        data: { id, script },
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
      }),
    onSuccess: () => {
      toast.success("Script updated");
      qc.invalidateQueries({ queryKey: ["video", id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const rej = useMutation({
    mutationFn: () =>
      reject({
        data: { id },
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
      }),
    onSuccess: () => {
      toast.success("Rejected");
      qc.invalidateQueries({ queryKey: ["video", id] });
    },
  });

  const voMut = useMutation({
    mutationFn: () =>
      genVoice({
        data: { id },
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
      }),
    onSuccess: () => {
      toast.success("Voiceover generated");
      qc.invalidateQueries({ queryKey: ["video", id] });
      qc.invalidateQueries({ queryKey: ["voiceover-url", id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Voiceover failed"),
  });

  const brollMut = useMutation({
    mutationFn: () =>
      searchClips({
        data: { id },
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
      }),
    onSuccess: (r) => {
      toast.success(`Found ${r.count} clips`);
      qc.invalidateQueries({ queryKey: ["video", id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "B-roll failed"),
  });

  const renderMut = useMutation({
    mutationFn: () =>
      trigRender({
        data: { id },
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
      }),
    onSuccess: () => {
      toast.success("Render dispatched");
      qc.invalidateQueries({ queryKey: ["video", id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Render failed"),
  });

  const cancelMut = useMutation({
    mutationFn: () =>
      cancelRenderFn({
        data: { id },
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
      }),
    onSuccess: () => {
      toast.success("Render cancelled");
      qc.invalidateQueries({ queryKey: ["video", id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Cancel failed"),
  });

  const finalUrlQ = useQuery({
    queryKey: ["final-url", id, q.data?.video?.final_video_url],
    queryFn: () =>
      getFinalUrl({
        data: { id },
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
      }),
    enabled: !!q.data?.video?.final_video_url && !!accessToken,
  });

  const voUrlQ = useQuery({
    queryKey: ["voiceover-url", id, q.data?.video?.voiceover_url],
    queryFn: () =>
      getVoUrl({
        data: { id },
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
      }),
    enabled: !!q.data?.video?.voiceover_url && !!accessToken,
  });

  // Wall-clock ticker for live elapsed displays. Started here (before any early
  // return) to satisfy the rules of hooks.
  const [now, setNow] = useState(() => Date.now());
  const runsForTick = (q.data?.runs ?? []) as Array<{ id: string; status: string }>;
  const anyRunning = runsForTick.some((r) => r.status === "running");
  const isRenderingForTick = q.data?.video?.status === "rendering";
  useEffect(() => {
    if (!anyRunning && !isRenderingForTick) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyRunning, isRenderingForTick]);

  if (q.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const v = q.data?.video;
  if (!v) return <div className="p-6">Not found</div>;
  const clips = (v.broll_clips ?? []) as Array<{ thumbnail: string; source: string; query: string; duration: number; url: string; id: string }>;
  const runs = (q.data?.runs ?? []) as Array<{ id: string; step: string; status: string; log: string | null; started_at: string; finished_at: string | null }>;
  const renderRuns = runs.filter((r) => r.step.startsWith("render"));
  const isRendering = v.status === "rendering";
  const lastRenderRun = renderRuns[renderRuns.length - 1];
  const renderError = lastRenderRun?.status === "failed" ? lastRenderRun.log : null;
  const lastRenderFailed = lastRenderRun?.status === "failed";

  // Progress is derived from the most recent render_dispatch start timestamp
  // (server-persisted in pipeline_runs). On reload we re-read the same row, so
  // the estimate naturally resumes from where it left off.
  const dispatchRun = [...renderRuns].reverse().find((r) => r.step === "render_dispatch");
  const expectedSeconds = Math.min(
    300,
    Math.max(30, Math.round(Number(v.voiceover_duration_seconds ?? 45) * 5)),
  );
  let progressPct = 0;
  if (isRendering && dispatchRun) {
    const elapsed = (now - new Date(dispatchRun.started_at).getTime()) / 1000;
    progressPct = Math.min(95, Math.round((elapsed / expectedSeconds) * 100));
  } else if (v.final_video_url) {
    progressPct = 100;
  }

  // Live current step indicator
  const runningRun = [...runs].reverse().find((r) => r.status === "running");
  const runningElapsed = runningRun
    ? Math.max(0, Math.floor((now - new Date(runningRun.started_at).getTime()) / 1000))
    : 0;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Link to="/dashboard" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </Link>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{v.topic ?? "Untitled"}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {new Date(v.created_at).toLocaleString()}
          </p>
        </div>
        <Badge>{v.status}</Badge>
      </div>

      {v.error_log && (
        <Card className="mb-4 border-destructive">
          <CardContent className="pt-6 text-sm text-destructive">{v.error_log}</CardContent>
        </Card>
      )}

      <Card className="mb-4">
        <CardHeader><CardTitle>Refined script</CardTitle></CardHeader>
        <CardContent>
          <Textarea rows={10} value={script} onChange={(e) => setScript(e.target.value)} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending || script === v.refined_script}>
              Save script
            </Button>
            <Button variant="outline" onClick={() => rej.mutate()} disabled={rej.isPending}>
              Reject
            </Button>
            <Button variant="secondary" disabled title="Voiceover, b-roll, render & publish coming in next phases">
              Approve & publish (coming soon)
            </Button>
          </div>
        </CardContent>
      </Card>

      {v.draft_script && (
        <Card className="mb-4">
          <CardHeader><CardTitle>Original draft</CardTitle></CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm text-muted-foreground">{v.draft_script}</CardContent>
        </Card>
      )}
      {v.critique && (
        <Card className="mb-4">
          <CardHeader><CardTitle>AI critique</CardTitle></CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm text-muted-foreground">{v.critique}</CardContent>
        </Card>
      )}

      <Card className="mb-4">
        <CardHeader><CardTitle className="flex items-center gap-2"><Mic className="h-4 w-4" /> Voiceover</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {voUrlQ.data?.url ? (
            <>
              <audio controls src={voUrlQ.data.url} className="w-full" />
              {v.voiceover_duration_seconds != null && (
                <p className="text-xs text-muted-foreground">Duration: {Number(v.voiceover_duration_seconds).toFixed(1)}s</p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No voiceover yet.</p>
          )}
          <Button size="sm" onClick={() => voMut.mutate()} disabled={voMut.isPending || !v.refined_script}>
            {voMut.isPending ? "Generating…" : voUrlQ.data?.url ? "Regenerate voiceover" : "Generate voiceover"}
          </Button>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader><CardTitle className="flex items-center gap-2"><Film className="h-4 w-4" /> B-roll clips</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {clips.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {clips.map((c) => (
                <a key={`${c.source}-${c.id}`} href={c.url} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded border">
                  <img src={c.thumbnail} alt={c.query} className="aspect-[9/16] w-full object-cover transition group-hover:scale-105" loading="lazy" />
                  <div className="p-2 text-xs">
                    <div className="truncate font-medium">{c.query}</div>
                    <div className="text-muted-foreground">{c.source} · {c.duration}s</div>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No b-roll yet.</p>
          )}
          <Button size="sm" onClick={() => brollMut.mutate()} disabled={brollMut.isPending || !v.refined_script}>
            {brollMut.isPending ? "Searching…" : clips.length > 0 ? "Re-search b-roll" : "Search b-roll"}
          </Button>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader><CardTitle className="flex items-center gap-2"><VideoIcon className="h-4 w-4" /> Final render</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {finalUrlQ.data?.url ? (
            <video controls src={finalUrlQ.data.url} className="aspect-[9/16] w-full max-w-xs rounded border bg-black" />
          ) : isRendering ? (
            <div className="space-y-2 rounded border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="font-medium">Rendering on host…</span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">{progressPct}%</span>
              </div>
              <Progress value={progressPct} className="h-2" />
              {runningRun && (
                <div className="flex items-center gap-2 text-xs">
                  <Clock className="h-3 w-3 text-primary" />
                  <span className="font-mono text-foreground">{runningRun.step}</span>
                  <span className="text-muted-foreground">running for {runningElapsed}s</span>
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                Est. {expectedSeconds}s total · auto-refreshing every 3s
                {v.render_job_id ? ` · job ${v.render_job_id}` : ""}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => cancelMut.mutate()}
                disabled={cancelMut.isPending}
              >
                {cancelMut.isPending ? "Cancelling…" : "Cancel render"}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No final video yet.</p>
          )}

          {renderError && (
            <div className="space-y-2 rounded border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              <div className="font-medium">Last render failed</div>
              <pre className="line-clamp-2 whitespace-pre-wrap break-words font-mono">{renderError}</pre>
              <div className="flex flex-wrap gap-2">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline">View error details</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader><DialogTitle>Render failure details</DialogTitle></DialogHeader>
                    <div className="space-y-3 text-xs">
                      <div className="grid grid-cols-2 gap-2 rounded border bg-muted/30 p-2 font-mono">
                        <div><span className="text-muted-foreground">step:</span> {lastRenderRun?.step}</div>
                        <div><span className="text-muted-foreground">status:</span> {lastRenderRun?.status}</div>
                        <div><span className="text-muted-foreground">started:</span> {lastRenderRun ? new Date(lastRenderRun.started_at).toLocaleString() : "—"}</div>
                        <div><span className="text-muted-foreground">finished:</span> {lastRenderRun?.finished_at ? new Date(lastRenderRun.finished_at).toLocaleString() : "—"}</div>
                        <div className="col-span-2"><span className="text-muted-foreground">run id:</span> {lastRenderRun?.id}</div>
                        <div className="col-span-2"><span className="text-muted-foreground">job id:</span> {v.render_job_id ?? "—"}</div>
                      </div>
                      <div>
                        <div className="mb-1 font-medium text-foreground">Failure log</div>
                        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border bg-muted/30 p-2 font-mono">{lastRenderRun?.log ?? "(no log)"}</pre>
                      </div>
                      {v.error_log && v.error_log !== lastRenderRun?.log && (
                        <div>
                          <div className="mb-1 font-medium text-foreground">Video error_log</div>
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border bg-muted/30 p-2 font-mono">{v.error_log}</pre>
                        </div>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
                <Button size="sm" onClick={() => renderMut.mutate()} disabled={renderMut.isPending}>
                  {renderMut.isPending ? "Retrying…" : "Retry render"}
                </Button>
              </div>
            </div>
          )}

          {renderRuns.length > 0 && (
            <div className="rounded border bg-muted/30 p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Render activity</div>
              <ul className="space-y-1.5 text-xs">
                {renderRuns.slice(-6).reverse().map((r) => {
                  const Icon =
                    r.status === "ok" ? CheckCircle2 :
                    r.status === "failed" ? XCircle :
                    r.status === "running" ? Loader2 : Clock;
                  const tone =
                    r.status === "ok" ? "text-emerald-600" :
                    r.status === "failed" ? "text-destructive" :
                    r.status === "running" ? "text-primary" : "text-muted-foreground";
                  return (
                    <li key={r.id} className="flex items-start gap-2">
                      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone} ${r.status === "running" ? "animate-spin" : ""}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono">{r.step}</span>
                          <span className={`uppercase tracking-wide ${tone}`}>{r.status}</span>
                          <span className="text-muted-foreground">
                            {new Date(r.started_at).toLocaleTimeString()}
                          </span>
                        </div>
                        {r.log && (
                          <div className="mt-0.5 truncate text-muted-foreground" title={r.log}>{r.log}</div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <Button
            size="sm"
            onClick={() => renderMut.mutate()}
            disabled={renderMut.isPending || !v.refined_script || !v.voiceover_url || !(clips.length > 0) || isRendering}
          >
            {renderMut.isPending ? "Dispatching…" : isRendering ? "Rendering…" : finalUrlQ.data?.url ? "Re-render" : lastRenderFailed ? "Retry render" : "Trigger render"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
