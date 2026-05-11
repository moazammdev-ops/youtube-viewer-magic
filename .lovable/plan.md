# YouTube Shorts Automation Platform

Daily, scheduled pipeline that generates a topic, writes & refines a script, produces voiceover, fetches royalty-free b-roll, renders a 30–60s vertical video with Remotion, and queues it for your approval before publishing to YouTube.

## Architecture

```
[pg_cron daily] -> /api/public/cron/daily-job
       |
       v
1. Topic gen (Lovable AI)
2. Script gen -> Critique -> Refine (Lovable AI, multi-step)
3. Voiceover (ElevenLabs) -> upload mp3 to Cloud Storage
4. B-roll search (Pexels + Pixabay APIs) -> store clip URLs
5. Trigger render on external Remotion host (Render/Railway)
       |
       v
[Remotion Node host] composes 9:16 video w/ captions + voiceover + clips
       |
       v
6. Webhook back to /api/public/render-callback -> store final mp4 URL
7. Status = "pending_approval"
       |
       v
[You open dashboard] -> review script + preview video
       |
       v
8. Approve -> server fn uploads to YouTube Data API v3 (resumable upload)
   Reject -> mark rejected (optionally regenerate)
```

## Stack & Components

**Lovable Cloud** (enabled in build): Postgres, Storage, Auth (email + Google for you, the channel owner).

**Tables:**
- `videos` — id, topic, script, refined_script, voiceover_url, broll_clips (jsonb), final_video_url, thumbnail_url, status (`generating | rendering | pending_approval | approved | published | rejected | failed`), youtube_video_id, scheduled_for, created_at, error_log
- `pipeline_runs` — id, video_id, step, status, log, started_at, finished_at
- `settings` — single row: niche/topic_prompt, voice_id, schedule_cron, default_tags, channel_branding
- `user_roles` — `app_role` enum (admin), separate from profiles (security best practice)

**Secrets needed:**
- `LOVABLE_API_KEY` (auto)
- `ELEVENLABS_API_KEY`
- `PEXELS_API_KEY`, `PIXABAY_API_KEY`
- `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` (your channel)
- `REMOTION_HOST_URL`, `REMOTION_HOST_SECRET` (HMAC to authenticate render server)
- `CRON_SECRET` (protects /api/public/cron)

## Server Functions & Routes

`src/lib/pipeline.functions.ts`
- `generateScript({videoId})` — topic → draft → critique → refined script (3 AI calls)
- `generateVoiceover({videoId})` — ElevenLabs TTS → upload to storage
- `searchBroll({videoId, keywords})` — Pexels + Pixabay vertical clips, ranked by duration
- `triggerRender({videoId})` — POST signed payload (script segments, voiceover URL, clip URLs, captions) to Remotion host
- `approveAndPublish({videoId})` — admin only, calls YouTube uploader
- `rejectVideo({videoId})`, `regenerate({videoId, fromStep})`

`src/lib/youtube.server.ts` — OAuth refresh + resumable upload

`src/routes/api/public/cron/daily-job.ts` — header-auth via `CRON_SECRET`; orchestrates steps 1–5
`src/routes/api/public/render-callback.ts` — HMAC-verified; receives final mp4, updates row to `pending_approval`

## Dashboard (UI)

- `/login` — email + Google (you only)
- `/_authenticated/dashboard` — queue: cards grouped by status, badges, thumbnails
- `/_authenticated/video/$id` — script viewer, voiceover player, b-roll preview, **embedded mp4 preview**, Approve / Reject / Regenerate buttons, edit script + re-render
- `/_authenticated/settings` — niche prompt, voice selection, daily schedule time, default tags/description template
- `/_authenticated/history` — published videos with YouTube links + basic stats

## Remotion Host (separate repo, NOT in this Lovable project)

Provided as a starter repo + deploy guide:
- Express server with `POST /render` (HMAC-verified) returning job id
- Remotion composition: 1080×1920, ducks voiceover audio, auto-generates word-level captions (using voiceover transcript timestamps from ElevenLabs alignment API), cuts b-roll every 3–4s synced to script segments
- On finish: uploads mp4 to Cloud Storage signed URL, calls back to `/api/public/render-callback`
- Deploy target: Render.com or Railway ($5–7/mo)

## Daily Schedule

- pg_cron extension enabled; cron job hits `/api/public/cron/daily-job` at the time set in `settings.schedule_cron`
- Cron secret in header; settings UI lets you change time/timezone

## YouTube Setup (one-time, guided in-app)

A `/setup/youtube` page walks you through:
1. Create Google Cloud project + enable YouTube Data API v3
2. OAuth consent screen (External, with your email as test user)
3. Create OAuth client (Web), redirect to `https://<your-project>.lovable.app/api/public/youtube-callback`
4. Click "Connect channel" → exchanges code for refresh token → stored as secret

**Quota note**: 10k units/day default; 1 upload ≈ 1,600 units → ~6/day max. The dashboard shows remaining quota.

## Build Order (phases)

1. **Foundation** — Cloud, auth (you only), tables, RLS, settings UI
2. **Generation pipeline** — topic + script + critique/refine, manual "Run now" button
3. **Voiceover + b-roll** — ElevenLabs, Pexels, Pixabay
4. **Remotion host repo + integration** — provide starter repo, wire HMAC, render callback, mp4 storage
5. **Approval dashboard** — preview, approve/reject/regenerate, script editing
6. **YouTube uploader** — OAuth setup wizard, resumable upload, store video id
7. **Scheduling** — pg_cron, settings for time/timezone, history view

## Technical Details

- All AI calls use Lovable AI Gateway (`google/gemini-3-flash-preview` for drafts, `gemini-2.5-pro` for critique)
- Captions: ElevenLabs returns character-level alignment → group into 2–4 word caption chunks
- Storage: separate buckets for `voiceovers/`, `final-videos/`, `thumbnails/`; signed URLs for Remotion host
- Roles: `admin` in `user_roles` table via `has_role()` security-definer function
- All public routes (`/api/public/*`) use HMAC or shared secret verification
- Errors per step logged to `pipeline_runs` so the dashboard can show "what failed and why"

## Out of Scope (explicit, for your safety)

- No view manipulation, no scraping copyrighted videos, no fake engagement
- No multi-account / channel farming
- Shutterstock excluded per your choice (can be added later as paid module)

## What You Need to Have Ready Before Build

1. ElevenLabs account + API key (free tier works to start)
2. Pexels API key (free), Pixabay API key (free)
3. A YouTube channel you own
4. A Render.com or Railway account for the Remotion host (I'll give you the repo + 1-click deploy instructions)

Confirm and I'll start with Phase 1 (Cloud + auth + tables + settings).
