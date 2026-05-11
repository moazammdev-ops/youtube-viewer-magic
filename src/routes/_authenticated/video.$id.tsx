import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getVideo, updateRefinedScript, rejectVideo, triggerRender, getFinalVideoUrl } from "@/lib/pipeline.functions";
import { generateVoiceover, getVoiceoverUrl } from "@/lib/voiceover.functions";
import { searchBroll } from "@/lib/broll.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Mic, Film, Video as VideoIcon } from "lucide-react";
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

  const q = useQuery({
    queryKey: ["video", id],
    queryFn: () => fetchVideo({ data: { id } }),
    refetchInterval: 5000,
  });

  const [script, setScript] = useState("");
  useEffect(() => {
    if (q.data?.video?.refined_script != null) setScript(q.data.video.refined_script);
  }, [q.data?.video?.refined_script]);

  const save = useMutation({
    mutationFn: () => updateScript({ data: { id, script } }),
    onSuccess: () => {
      toast.success("Script updated");
      qc.invalidateQueries({ queryKey: ["video", id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const rej = useMutation({
    mutationFn: () => reject({ data: { id } }),
    onSuccess: () => {
      toast.success("Rejected");
      qc.invalidateQueries({ queryKey: ["video", id] });
    },
  });

  const voMut = useMutation({
    mutationFn: () => genVoice({ data: { id } }),
    onSuccess: () => {
      toast.success("Voiceover generated");
      qc.invalidateQueries({ queryKey: ["video", id] });
      qc.invalidateQueries({ queryKey: ["voiceover-url", id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Voiceover failed"),
  });

  const brollMut = useMutation({
    mutationFn: () => searchClips({ data: { id } }),
    onSuccess: (r) => {
      toast.success(`Found ${r.count} clips`);
      qc.invalidateQueries({ queryKey: ["video", id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "B-roll failed"),
  });

  const renderMut = useMutation({
    mutationFn: () => trigRender({ data: { id } }),
    onSuccess: () => {
      toast.success("Render dispatched");
      qc.invalidateQueries({ queryKey: ["video", id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Render failed"),
  });

  const finalUrlQ = useQuery({
    queryKey: ["final-url", id, q.data?.video?.final_video_url],
    queryFn: () => getFinalUrl({ data: { id } }),
    enabled: !!q.data?.video?.final_video_url,
  });

  const voUrlQ = useQuery({
    queryKey: ["voiceover-url", id, q.data?.video?.voiceover_url],
    queryFn: () => getVoUrl({ data: { id } }),
    enabled: !!q.data?.video?.voiceover_url,
  });

  if (q.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const v = q.data?.video;
  if (!v) return <div className="p-6">Not found</div>;
  const clips = (v.broll_clips ?? []) as Array<{ thumbnail: string; source: string; query: string; duration: number; url: string; id: string }>;

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
          ) : v.status === "rendering" ? (
            <p className="text-sm text-muted-foreground">Rendering on host… this page auto-refreshes.</p>
          ) : (
            <p className="text-sm text-muted-foreground">No final video yet.</p>
          )}
          <Button
            size="sm"
            onClick={() => renderMut.mutate()}
            disabled={renderMut.isPending || !v.refined_script || !v.voiceover_url || !(clips.length > 0) || v.status === "rendering"}
          >
            {renderMut.isPending ? "Dispatching…" : v.status === "rendering" ? "Rendering…" : finalUrlQ.data?.url ? "Re-render" : "Trigger render"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}