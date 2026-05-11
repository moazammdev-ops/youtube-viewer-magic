import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Sparkles, Wand2, Mic, Film, Youtube } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ShortsForge — Daily YouTube Shorts on autopilot" },
      {
        name: "description",
        content:
          "Daily AI-generated YouTube Shorts: topic, script, voiceover, royalty-free b-roll, and one-click publishing.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="container mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 font-semibold">
            <Film className="h-5 w-5" />
            ShortsForge
          </div>
          <Link to="/login">
            <Button size="sm">Sign in</Button>
          </Link>
        </div>
      </header>
      <main className="container mx-auto max-w-6xl px-6 py-20">
        <section className="max-w-3xl">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" /> Automated daily Shorts pipeline
          </p>
          <h1 className="text-5xl font-bold tracking-tight md:text-6xl">
            Your channel, on autopilot.
          </h1>
          <p className="mt-6 text-lg text-muted-foreground">
            Generate a topic, write and refine the script, voice it, find royalty-free b-roll,
            stitch a vertical video, and publish to YouTube — every day, on schedule.
            You stay in the loop with one-click approval.
          </p>
          <div className="mt-8 flex gap-3">
            <Link to="/login">
              <Button size="lg">Get started</Button>
            </Link>
          </div>
        </section>
        <section className="mt-24 grid gap-6 md:grid-cols-4">
          {[
            { icon: Wand2, title: "AI script", body: "Topic → draft → critique → refined script." },
            { icon: Mic, title: "Voiceover", body: "Natural ElevenLabs narration." },
            { icon: Film, title: "B-roll", body: "Royalty-free clips from Pexels & Pixabay." },
            { icon: Youtube, title: "Publish", body: "One-click upload to your channel." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-lg border p-6">
              <Icon className="mb-3 h-5 w-5" />
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
