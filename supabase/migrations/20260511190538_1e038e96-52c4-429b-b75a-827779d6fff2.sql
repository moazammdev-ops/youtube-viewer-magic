
update storage.buckets set public = false where id = 'voiceovers';
drop policy if exists "voiceovers public read" on storage.objects;
create policy "voiceovers admin read" on storage.objects for select to authenticated using (bucket_id = 'voiceovers' and public.has_role(auth.uid(), 'admin'));
