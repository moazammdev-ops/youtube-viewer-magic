
-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "users see own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admins manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users see own profile" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());

-- Auto-create profile + first user becomes admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  user_count INT;
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)));

  SELECT COUNT(*) INTO user_count FROM auth.users;
  IF user_count = 1 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Settings (single row)
CREATE TABLE public.settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  niche_prompt TEXT NOT NULL DEFAULT 'Generate a fascinating, lesser-known fact about science, history, or technology. Topic should be specific, surprising, and easy to explain in 45 seconds.',
  voice_id TEXT NOT NULL DEFAULT 'JBFqnCBsd6RMkjVDRZzb',
  schedule_cron TEXT NOT NULL DEFAULT '0 14 * * *',
  schedule_enabled BOOLEAN NOT NULL DEFAULT false,
  default_title_template TEXT NOT NULL DEFAULT '{topic}',
  default_description TEXT NOT NULL DEFAULT 'Daily bite-sized facts. #shorts',
  default_tags TEXT[] NOT NULL DEFAULT ARRAY['shorts','facts','daily'],
  privacy_status TEXT NOT NULL DEFAULT 'private',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.settings (id) VALUES (1) ON CONFLICT DO NOTHING;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read settings" ON public.settings FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins update settings" ON public.settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Videos
CREATE TABLE public.videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic TEXT,
  draft_script TEXT,
  critique TEXT,
  refined_script TEXT,
  voiceover_url TEXT,
  voiceover_duration_seconds NUMERIC,
  alignment_data JSONB,
  broll_clips JSONB DEFAULT '[]'::jsonb,
  final_video_url TEXT,
  thumbnail_url TEXT,
  youtube_video_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  -- queued | generating_script | generating_voice | searching_broll | rendering | pending_approval | approved | publishing | published | rejected | failed
  error_log TEXT,
  scheduled_for TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins all videos" ON public.videos FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX videos_status_idx ON public.videos(status);
CREATE INDEX videos_created_idx ON public.videos(created_at DESC);

-- Pipeline runs (per-step log)
CREATE TABLE public.pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID REFERENCES public.videos(id) ON DELETE CASCADE NOT NULL,
  step TEXT NOT NULL,
  status TEXT NOT NULL,
  log TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins all runs" ON public.pipeline_runs FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX runs_video_idx ON public.pipeline_runs(video_id);

-- updated_at trigger for videos & settings
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER videos_touch BEFORE UPDATE ON public.videos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER settings_touch BEFORE UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
