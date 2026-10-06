
create type public.app_role as enum ('admin','conferente','visualizador');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text,
  email text,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "profiles_read" on public.profiles for select to authenticated using (true);
create policy "profiles_write" on public.profiles for update to authenticated using (auth.uid() = id);
create policy "profiles_insert" on public.profiles for insert to authenticated with check (auth.uid() = id);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null default 'conferente',
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
create policy "roles_read" on public.user_roles for select to authenticated using (true);

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nome, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)), new.email)
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'conferente') on conflict do nothing;
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create table public.unidades (
  id uuid primary key default gen_random_uuid(),
  tipo text not null default 'caminhao',
  nome text not null,
  placa text,
  modelo text,
  frota text,
  ano text,
  setor text,
  matricula text,
  gestor text,
  observacoes text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.unidades to authenticated;
grant all on public.unidades to service_role;
alter table public.unidades enable row level security;
create policy "unidades_all" on public.unidades for all to authenticated using (true) with check (true);

create table public.materiais (
  id uuid primary key default gen_random_uuid(),
  unidade_id uuid not null references public.unidades(id) on delete cascade,
  codigo text not null,
  descricao text not null default '',
  quantidade_esperada numeric not null default 0,
  locacao text,
  funcionario_nome text,
  funcionario_codigo text,
  imagem_principal text,
  created_at timestamptz not null default now()
);
create index on public.materiais(unidade_id);
grant select, insert, update, delete on public.materiais to authenticated;
grant all on public.materiais to service_role;
alter table public.materiais enable row level security;
create policy "materiais_all" on public.materiais for all to authenticated using (true) with check (true);

create table public.material_imagens (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materiais(id) on delete cascade,
  url_imagem text not null,
  descricao text,
  created_at timestamptz not null default now()
);
create index on public.material_imagens(material_id);
grant select, insert, update, delete on public.material_imagens to authenticated;
grant all on public.material_imagens to service_role;
alter table public.material_imagens enable row level security;
create policy "material_imagens_all" on public.material_imagens for all to authenticated using (true) with check (true);

create table public.conferencias (
  id uuid primary key default gen_random_uuid(),
  unidade_id uuid not null references public.unidades(id) on delete cascade,
  tipo text not null default 'caminhao',
  data date not null default current_date,
  hora_inicio timestamptz not null default now(),
  hora_fim timestamptz,
  conferente text,
  responsavel text,
  almoxarife text,
  codigo_almoxarife text,
  assinatura text,
  assinatura_gestor text,
  observacoes text,
  status text not null default 'em_andamento',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.conferencias(unidade_id);
grant select, insert, update, delete on public.conferencias to authenticated;
grant all on public.conferencias to service_role;
alter table public.conferencias enable row level security;
create policy "conferencias_all" on public.conferencias for all to authenticated using (true) with check (true);

create table public.conferencia_itens (
  id uuid primary key default gen_random_uuid(),
  conferencia_id uuid not null references public.conferencias(id) on delete cascade,
  material_id uuid references public.materiais(id) on delete set null,
  codigo text,
  descricao text,
  locacao text,
  quantidade_esperada numeric not null default 0,
  quantidade_contada numeric,
  observacoes text,
  fotos jsonb not null default '[]'::jsonb,
  status text not null default 'pendente',
  updated_at timestamptz not null default now()
);
create index on public.conferencia_itens(conferencia_id);
grant select, insert, update, delete on public.conferencia_itens to authenticated;
grant all on public.conferencia_itens to service_role;
alter table public.conferencia_itens enable row level security;
create policy "conferencia_itens_all" on public.conferencia_itens for all to authenticated using (true) with check (true);

create table public.auditoria (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid(),
  usuario text,
  acao text not null,
  detalhe text,
  created_at timestamptz not null default now()
);
grant select, insert on public.auditoria to authenticated;
grant all on public.auditoria to service_role;
alter table public.auditoria enable row level security;
create policy "auditoria_read" on public.auditoria for select to authenticated using (true);
create policy "auditoria_insert" on public.auditoria for insert to authenticated with check (true);
