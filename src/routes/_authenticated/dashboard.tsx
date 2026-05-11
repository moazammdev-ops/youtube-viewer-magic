import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { generateScriptNow, listVideos } from "@/lib/pipeline.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — ShortsForge" }] }),
  component: Dashboard,
});

const STATUS_LABELS: Record<string, { label: string; tone: "default" | "secondary" | "destructive" | "outline" }> = {
  queued: { label: "Queued", tone: "outline" },
  generating_script: { label: "Writing script", tone: "secondary" },
  generating_voice: { label: "Voicing", tone: "secondary" },
  searching_broll: { label: "Finding b-roll", tone: "secondary" },
  rendering: { label: "Rendering", tone: "secondary" },
  pending_approval: { label: "Needs review", tone: "default" },
  approved: { label: "Approved", tone: "default" },
  publishing: { label: "Publishing", tone: "secondary" },
  published: { label: "Published", tone: "default" },
  rejected: { label: "Rejected", tone: "outline" },
  failed: { label: "Failed", tone: "destructive" },
};

function Dashboard() {
  const qc = useQueryClient();
  const list = useServerFn(listVideos);
  const generate = useServerFn(generateScriptNow);

  const videosQ = useQuery({
    queryKey: ["videos"],
    queryFn: () => list(),
    refetchInterval: 5000,
  });

  const gen = useMutation({
    mutationFn: () => generate(),
    onSuccess: () => {
      toast.success("Script generated. Review it now.");
      qc.invalidateQueries({ queryKey: ["videos"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Generation failed"),
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

      {videosQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
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
                  </div>
                  <Badge variant={s.tone}>{s.label}</Badge>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}