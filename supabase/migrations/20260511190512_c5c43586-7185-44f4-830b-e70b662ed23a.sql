
insert into storage.buckets (id, name, public) values ('voiceovers', 'voiceovers', true) on conflict do nothing;

create policy "voiceovers public read" on storage.objects for select using (bucket_id = 'voiceovers');
create policy "voiceovers admin write" on storage.objects for insert to authenticated with check (bucket_id = 'voiceovers' and public.has_role(auth.uid(), 'admin'));
create policy "voiceovers admin update" on storage.objects for update to authenticated using (bucket_id = 'voiceovers' and public.has_role(auth.uid(), 'admin'));
create policy "voiceovers admin delete" on storage.objects for delete to authenticated using (bucket_id = 'voiceovers' and public.has_role(auth.uid(), 'admin'));
