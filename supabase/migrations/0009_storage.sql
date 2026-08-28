insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'contracts',
  'contracts',
  false,
  52428800,
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do nothing;

-- Objects are uploaded to `{org_id}/{contract_id}/{filename}`. The org_id in
-- the path is the only thing these policies trust -- it's checked against the
-- caller's JWT, the same source every other table's RLS reads from, so a
-- member of org A can never read or write into org B's folder.
create policy contracts_bucket_read on storage.objects
  for select using (
    bucket_id = 'contracts'
    and (storage.foldername(name))[1] = public.jwt_org_id()::text
  );

create policy contracts_bucket_write on storage.objects
  for insert with check (
    bucket_id = 'contracts'
    and (storage.foldername(name))[1] = public.jwt_org_id()::text
  );

create policy contracts_bucket_delete on storage.objects
  for delete using (
    bucket_id = 'contracts'
    and (storage.foldername(name))[1] = public.jwt_org_id()::text
  );
