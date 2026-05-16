import { Player } from "@remotion/player";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Download } from "lucide-react";
import { toast } from "sonner";
import { ShortVideo, type BrollClip } from "@/remotion/ShortVideo";

type Props = {
  script: string;
  voiceoverUrl: string;
  voiceoverDurationSeconds: number;
  brollClips: BrollClip[];
};

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;

export function PreviewExport({ script, voiceoverUrl, voiceoverDurationSeconds, brollClips }: Props) {
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const cancelRef = useRef(false);

  const durationInFrames = Math.max(1, Math.floor(voiceoverDurationSeconds * FPS));

  const inputProps = useMemo(
    () => ({ script, voiceoverUrl, voiceoverDurationSeconds, brollClips }),
    [script, voiceoverUrl, voiceoverDurationSeconds, brollClips],
  );

  async function handleExport() {
    if (!brollClips.length || !voiceoverUrl) {
      toast.error("Need voiceover and b-roll clips first");
      return;
    }
    setExporting(true);
    setProgress(0);
    cancelRef.current = false;

    try {
      // Preload b-roll videos
      const videoEls: HTMLVideoElement[] = await Promise.all(
        brollClips.map(
          (c) =>
            new Promise<HTMLVideoElement>((resolve, reject) => {
              const v = document.createElement("video");
              v.crossOrigin = "anonymous";
              v.src = c.url;
              v.muted = true;
              v.playsInline = true;
              v.preload = "auto";
              v.onloadeddata = () => resolve(v);
              v.onerror = () => reject(new Error(`Failed to load ${c.url}`));
            }),
        ),
      );

      // Voiceover element
      const audio = new Audio();
      audio.crossOrigin = "anonymous";
      audio.src = voiceoverUrl;
      await new Promise<void>((res, rej) => {
        audio.oncanplaythrough = () => res();
        audio.onerror = () => rej(new Error("Failed to load voiceover"));
      });

      // Canvas + caption rendering
      const canvas = document.createElement("canvas");
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const ctx = canvas.getContext("2d")!;

      // Build per-clip timing
      const perClip = voiceoverDurationSeconds / brollClips.length;

      // Audio routing — combine audio + canvas streams
      const AudioCtor: typeof AudioContext =
        (window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext: typeof AudioContext }).AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtor();
      const dest = audioCtx.createMediaStreamDestination();
      const srcNode = audioCtx.createMediaElementSource(audio);
      srcNode.connect(dest);
      srcNode.connect(audioCtx.destination);

      const canvasStream = canvas.captureStream(FPS);
      const combined = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...dest.stream.getAudioTracks(),
      ]);

      // Pick best supported mime
      const mimeCandidates = [
        "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ];
      const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      if (!mimeType) throw new Error("MediaRecorder not supported in this browser");

      const recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: 5_000_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });

      // Reset all clips
      for (const v of videoEls) {
        v.currentTime = 0;
      }
      audio.currentTime = 0;

      recorder.start();
      const startTime = performance.now();
      await audio.play();

      let currentClipIdx = -1;
      const drawFrame = async () => {
        if (cancelRef.current) {
          recorder.stop();
          return;
        }
        const elapsed = (performance.now() - startTime) / 1000;
        if (elapsed >= voiceoverDurationSeconds) {
          recorder.stop();
          return;
        }

        const idx = Math.min(brollClips.length - 1, Math.floor(elapsed / perClip));
        if (idx !== currentClipIdx) {
          currentClipIdx = idx;
          const v = videoEls[idx];
          v.currentTime = 0;
          v.play().catch(() => {});
        }
        const activeVideo = videoEls[idx];

        // Draw video covering canvas
        const vw = activeVideo.videoWidth || WIDTH;
        const vh = activeVideo.videoHeight || HEIGHT;
        const scale = Math.max(WIDTH / vw, HEIGHT / vh);
        const dw = vw * scale;
        const dh = vh * scale;
        const dx = (WIDTH - dw) / 2;
        const dy = (HEIGHT - dh) / 2;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        try {
          ctx.drawImage(activeVideo, dx, dy, dw, dh);
        } catch {
          /* not ready yet */
        }

        // Caption
        drawCaption(ctx, script);

        setProgress(Math.round((elapsed / voiceoverDurationSeconds) * 100));
        requestAnimationFrame(drawFrame);
      };
      requestAnimationFrame(drawFrame);

      await stopped;
      audio.pause();
      audioCtx.close();

      const blob = new Blob(chunks, { type: mimeType });
      const ext = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `short-${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${(blob.size / 1024 / 1024).toFixed(1)} MB`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
      setProgress(0);
      cancelRef.current = false;
    }
  }

  function drawCaption(ctx: CanvasRenderingContext2D, text: string) {
    const padding = 60;
    const maxWidth = WIDTH - padding * 2;
    ctx.font = "700 38px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";

    // Word-wrap
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxWidth - 48) {
        if (line) lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    const visible = lines.slice(-3);
    const lineHeight = 48;
    const boxH = visible.length * lineHeight + 36;
    const boxW = maxWidth;
    const boxX = (WIDTH - boxW) / 2;
    const boxY = HEIGHT - padding - boxH;

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    roundRect(ctx, boxX, boxY, boxW, boxH, 16);
    ctx.fill();
    ctx.fillStyle = "#fff";
    visible.forEach((l, i) => {
      ctx.fillText(l, WIDTH / 2, boxY + 18 + (i + 1) * lineHeight - 8);
    });
  }

  function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  return (
    <div className="space-y-3">
      <div className="mx-auto max-w-xs overflow-hidden rounded border bg-black">
        <Player
          component={ShortVideo}
          inputProps={inputProps}
          durationInFrames={durationInFrames}
          fps={FPS}
          compositionWidth={WIDTH}
          compositionHeight={HEIGHT}
          controls
          style={{ width: "100%", aspectRatio: "9 / 16" }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={handleExport} disabled={exporting}>
          {exporting ? (
            <>
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Exporting… {progress}%
            </>
          ) : (
            <>
              <Download className="mr-1 h-3.5 w-3.5" /> Export MP4
            </>
          )}
        </Button>
        {exporting && (
          <Button size="sm" variant="outline" onClick={() => (cancelRef.current = true)}>
            Cancel
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          Records in real-time in your browser. Keep this tab focused.
        </span>
      </div>
    </div>
  );
}