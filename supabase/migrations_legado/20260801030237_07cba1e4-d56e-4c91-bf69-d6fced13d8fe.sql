create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated, service_role;

create or replace function app_private.perfil_atual()
returns text language sql stable security definer set search_path = public as $$
  select perfil from public.user_profiles where user_id = auth.uid()
$$;

create or replace function app_private.pode_tipo(_tipo text)
returns boolean language sql stable security definer set search_path = public as $$
  select case app_private.perfil_atual()
    when 'administrador' then true
    when 'agricola' then _tipo in ('caminhao','caixa','prateleira')
    when 'industria' then _tipo in ('caixa_industria','prateleira_industria')
    else false
  end
$$;

create or replace function app_private.pode_unidade(_unidade_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.unidades u where u.id = _unidade_id and app_private.pode_tipo(u.tipo))
$$;

create or replace function app_private.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

revoke all on function app_private.perfil_atual(), app_private.pode_tipo(text), app_private.pode_unidade(uuid), app_private.has_role(uuid, public.app_role) from public;
grant execute on function app_private.perfil_atual(), app_private.pode_tipo(text), app_private.pode_unidade(uuid), app_private.has_role(uuid, public.app_role) to authenticated, service_role;

drop policy if exists user_profiles_select_own on public.user_profiles;
create policy user_profiles_select_own on public.user_profiles for select to authenticated
  using ((user_id = auth.uid()) or (app_private.perfil_atual() = 'administrador'));

drop policy if exists user_profiles_insert_admin on public.user_profiles;
create policy user_profiles_insert_admin on public.user_profiles for insert to authenticated
  with check (app_private.perfil_atual() = 'administrador');

drop policy if exists user_profiles_update_admin on public.user_profiles;
create policy user_profiles_update_admin on public.user_profiles for update to authenticated
  using (app_private.perfil_atual() = 'administrador')
  with check (app_private.perfil_atual() = 'administrador');

drop policy if exists user_profiles_delete_admin on public.user_profiles;
create policy user_profiles_delete_admin on public.user_profiles for delete to authenticated
  using (app_private.perfil_atual() = 'administrador');

drop policy if exists unidades_select on public.unidades;
create policy unidades_select on public.unidades for select to authenticated
  using (app_private.pode_tipo(tipo));

drop policy if exists materiais_select on public.materiais;
create policy materiais_select on public.materiais for select to authenticated
  using (app_private.pode_unidade(unidade_id));

drop policy if exists conferencias_select on public.conferencias;
create policy conferencias_select on public.conferencias for select to authenticated
  using (app_private.pode_unidade(unidade_id));

drop policy if exists conferencia_itens_select on public.conferencia_itens;
create policy conferencia_itens_select on public.conferencia_itens for select to authenticated
  using (exists (select 1 from public.conferencias c where c.id = conferencia_itens.conferencia_id and app_private.pode_unidade(c.unidade_id)));

drop function if exists public.perfil_atual();
drop function if exists public.pode_tipo(text);
drop function if exists public.pode_unidade(uuid);

drop policy if exists material_imagens_select on public.material_imagens;
create policy material_imagens_select on public.material_imagens for select to authenticated
  using (exists (select 1 from public.materiais m where m.id = material_imagens.material_id and app_private.pode_unidade(m.unidade_id)));