import { AbsoluteFill, Audio, Sequence, Video, useVideoConfig } from "remotion";

export type BrollClip = {
  id: string | number;
  url: string;
  duration: number;
  query?: string;
  source?: string;
  thumbnail?: string;
};

export type ShortVideoProps = {
  script: string;
  voiceoverUrl: string;
  voiceoverDurationSeconds: number;
  brollClips: BrollClip[];
};

/** Distribute clips evenly across the voiceover duration. */
function buildTimeline(clips: BrollClip[], totalSeconds: number) {
  if (!clips.length || totalSeconds <= 0) return [];
  const perClip = totalSeconds / clips.length;
  return clips.map((c, i) => ({
    clip: c,
    startSec: i * perClip,
    durSec: perClip,
  }));
}

export const ShortVideo: React.FC<ShortVideoProps> = ({
  script,
  voiceoverUrl,
  voiceoverDurationSeconds,
  brollClips,
}) => {
  const { fps } = useVideoConfig();
  const total = Math.max(1, voiceoverDurationSeconds);
  const timeline = buildTimeline(brollClips, total);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {timeline.map((t, i) => {
        const fromFrame = Math.floor(t.startSec * fps);
        const durFrames = Math.max(1, Math.floor(t.durSec * fps));
        return (
          <Sequence key={`${t.clip.id}-${i}`} from={fromFrame} durationInFrames={durFrames}>
            <AbsoluteFill>
              <Video
                src={t.clip.url}
                muted
                startFrom={0}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </AbsoluteFill>
          </Sequence>
        );
      })}

      {voiceoverUrl && <Audio src={voiceoverUrl} />}

      {/* Caption bar */}
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "center",
          padding: 60,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            background: "rgba(0,0,0,0.55)",
            color: "#fff",
            padding: "18px 24px",
            borderRadius: 16,
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: 38,
            fontWeight: 700,
            lineHeight: 1.25,
            textAlign: "center",
            maxWidth: "90%",
            textShadow: "0 2px 8px rgba(0,0,0,0.6)",
          }}
        >
          {script}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};