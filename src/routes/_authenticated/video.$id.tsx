import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getVideo, updateRefinedScript, rejectVideo } from "@/lib/pipeline.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
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

  if (q.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const v = q.data?.video;
  if (!v) return <div className="p-6">Not found</div>;

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
        <Card>
          <CardHeader><CardTitle>AI critique</CardTitle></CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm text-muted-foreground">{v.critique}</CardContent>
        </Card>
      )}
    </div>
  );
}