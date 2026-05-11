
-- Add render tracking column
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS render_job_id text;

-- Final videos bucket (private; signed URLs only)
INSERT INTO storage.buckets (id, name, public)
VALUES ('final-videos', 'final-videos', false)
ON CONFLICT (id) DO NOTHING;

-- Only admins can read/write final-videos
CREATE POLICY "admins read final-videos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'final-videos' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins write final-videos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'final-videos' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins update final-videos"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'final-videos' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins delete final-videos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'final-videos' AND public.has_role(auth.uid(), 'admin'));
