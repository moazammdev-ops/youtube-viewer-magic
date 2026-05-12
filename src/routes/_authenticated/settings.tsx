import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getSettings, updateSettings } from "@/lib/pipeline.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — ShortsForge" }] }),
  component: SettingsPage,
});

type Form = {
  niche_prompt: string;
  voice_id: string;
  schedule_cron: string;
  schedule_enabled: boolean;
  default_title_template: string;
  default_description: string;
  default_tags: string;
  privacy_status: "private" | "unlisted" | "public";
};

function SettingsPage() {
  const qc = useQueryClient();
  const get = useServerFn(getSettings);
  const update = useServerFn(updateSettings);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["settings"],
    queryFn: () =>
      get({
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
      }),
    enabled: !!accessToken,
  });
  const [form, setForm] = useState<Form | null>(null);

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

  useEffect(() => {
    if (q.data?.settings && !form) {
      const s = q.data.settings;
      setForm({
        niche_prompt: s.niche_prompt,
        voice_id: s.voice_id,
        schedule_cron: s.schedule_cron,
        schedule_enabled: s.schedule_enabled,
        default_title_template: s.default_title_template,
        default_description: s.default_description,
        default_tags: (s.default_tags ?? []).join(", "),
        privacy_status: s.privacy_status as Form["privacy_status"],
      });
    }
  }, [q.data, form]);

  const save = useMutation({
    mutationFn: (f: Form) =>
      update({
        data: {
          ...f,
          default_tags: f.default_tags.split(",").map((t) => t.trim()).filter(Boolean),
        },
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
      }),
    onSuccess: () => {
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  if (q.isError) {
    return (
      <div className="p-6 text-sm text-destructive">
        Failed to load settings: {q.error instanceof Error ? q.error.message : "Unknown error"}
      </div>
    );
  }

  if (!form) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-2 text-3xl font-bold">Settings</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Configure your daily generation pipeline.
      </p>

      <Card>
        <CardHeader><CardTitle>Content</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Topic prompt (what the AI generates each day)</Label>
            <Textarea
              rows={4}
              value={form.niche_prompt}
              onChange={(e) => setForm({ ...form, niche_prompt: e.target.value })}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>ElevenLabs voice ID</Label>
              <Input
                value={form.voice_id}
                onChange={(e) => setForm({ ...form, voice_id: e.target.value })}
              />
              <p className="mt-1 text-xs text-muted-foreground">Default: George (JBFqnCBsd6RMkjVDRZzb)</p>
            </div>
            <div>
              <Label>Privacy status on upload</Label>
              <select
                className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={form.privacy_status}
                onChange={(e) =>
                  setForm({ ...form, privacy_status: e.target.value as Form["privacy_status"] })
                }
              >
                <option value="private">Private</option>
                <option value="unlisted">Unlisted</option>
                <option value="public">Public</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader><CardTitle>Schedule</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Daily auto-generation</Label>
              <p className="text-xs text-muted-foreground">
                Runs the full pipeline on the cron below. Videos still wait for your approval.
              </p>
            </div>
            <Switch
              checked={form.schedule_enabled}
              onCheckedChange={(v) => setForm({ ...form, schedule_enabled: v })}
            />
          </div>
          <div>
            <Label>Cron (UTC)</Label>
            <Input
              value={form.schedule_cron}
              onChange={(e) => setForm({ ...form, schedule_cron: e.target.value })}
            />
            <p className="mt-1 text-xs text-muted-foreground">e.g. <code>0 14 * * *</code> = 14:00 UTC daily</p>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader><CardTitle>YouTube defaults</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Title template</Label>
            <Input
              value={form.default_title_template}
              onChange={(e) => setForm({ ...form, default_title_template: e.target.value })}
            />
            <p className="mt-1 text-xs text-muted-foreground">Use <code>{"{topic}"}</code> as a placeholder.</p>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              rows={3}
              value={form.default_description}
              onChange={(e) => setForm({ ...form, default_description: e.target.value })}
            />
          </div>
          <div>
            <Label>Tags (comma-separated)</Label>
            <Input
              value={form.default_tags}
              onChange={(e) => setForm({ ...form, default_tags: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 flex justify-end">
        <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
