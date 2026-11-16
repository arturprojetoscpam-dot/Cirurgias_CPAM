grant insert, update on table public.procedimentos to authenticated;

create policy procedimentos_admin_insert
  on public.procedimentos
  for insert
  to authenticated
  with check ((select private.has_any_role(array['administrador']::text[])));

create policy procedimentos_admin_update
  on public.procedimentos
  for update
  to authenticated
  using ((select private.has_any_role(array['administrador']::text[])))
  with check ((select private.has_any_role(array['administrador']::text[])));
