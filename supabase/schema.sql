-- =====================================================================================
--  REX - Center of Excellence :: banco de dados (Supabase / Postgres)
--
--  Como usar: no painel do Supabase abra "SQL Editor" → "New query", cole este arquivo
--  inteiro, troque o e-mail e o nome do owner no FINAL do arquivo (passo 9) e clique em Run.
--  Pode rodar mais de uma vez: tudo usa "if not exists" / "or replace".
-- =====================================================================================

create extension if not exists pgcrypto;

-- -------------------------------------------------------------------------------------
-- 1) Perfis: quem pode entrar no REX e com qual papel
--    owner  → tudo (adiciona admins e viewers, remove pessoas)
--    admin  → atribui, revisa complexidade, edita, exclui, configura, notifica
--    viewer → vê tudo e muda o status das tarefas atribuídas a ele
-- -------------------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  name        text not null,
  role        text not null default 'viewer' check (role in ('owner','admin','viewer')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create or replace function public.normalize_email() returns trigger
language plpgsql as $$
begin
  new.email := lower(trim(new.email));
  return new;
end $$;

drop trigger if exists profiles_normalize_email on public.profiles;
create trigger profiles_normalize_email
  before insert or update on public.profiles
  for each row execute function public.normalize_email();

-- -------------------------------------------------------------------------------------
-- 2) Funções auxiliares usadas pelas políticas de acesso (quem sou eu?)
-- -------------------------------------------------------------------------------------
create or replace function public.my_email() returns text
language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.my_profile_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.profiles where email = public.my_email() and active limit 1
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where email = public.my_email() and active limit 1
$$;

create or replace function public.is_member() returns boolean
language sql stable as $$ select public.my_role() is not null $$;

create or replace function public.is_mgr() returns boolean
language sql stable as $$ select public.my_role() in ('owner','admin') $$;

-- -------------------------------------------------------------------------------------
-- 3) Só quem está em profiles consegue criar login.
--    O formulário público NÃO usa login; isso vale só para a tela do REX.
--    Quando um e-mail desconhecido pede o código, o Supabase devolve
--    "Database error saving new user" e o site mostra "Este e-mail não tem acesso".
-- -------------------------------------------------------------------------------------
create or replace function public.only_registered_emails() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where email = lower(new.email) and active) then
    raise exception 'email_nao_autorizado';
  end if;
  return new;
end $$;

drop trigger if exists only_registered_emails on auth.users;
create trigger only_registered_emails
  before insert on auth.users
  for each row execute function public.only_registered_emails();

-- -------------------------------------------------------------------------------------
-- 4) Solicitações (tasks)
-- -------------------------------------------------------------------------------------
create sequence if not exists public.tasks_number_seq;

create table if not exists public.tasks (
  id                   uuid primary key default gen_random_uuid(),
  number               integer not null unique default nextval('public.tasks_number_seq'),
  name                 text not null,
  requester_email      text not null,
  impacted_structures  text not null,
  project_type         text not null,
  needs_interaction    boolean not null default false,
  report_frequency     text not null default 'Não',
  report_channels      text[] not null default '{}',
  description          text not null,
  attachments          jsonb not null default '[]'::jsonb,
  status               text not null default 'nova'  check (status in ('nova','em_analise','em_andamento','em_validacao','concluida')),
  complexity           text not null default 'baixa' check (complexity in ('baixa','media','alta')),
  assignee_id          uuid references public.profiles(id) on delete set null,
  seatalk_group_id     text,
  created_at           timestamptz not null default now(),
  due_at               timestamptz not null default now() + interval '24 hours',
  completed_at         timestamptz,
  updated_at           timestamptz not null default now()
);
alter table public.tasks add column if not exists seatalk_group_id text;

-- SLA por complexidade: baixa 24h, média 1 semana, alta 1 mês
create or replace function public.sla_interval(cx text) returns interval
language sql immutable as $$
  select case cx when 'alta' then interval '30 days' when 'media' then interval '7 days' else interval '24 hours' end
$$;

create or replace function public.tasks_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- quem envia pelo formulário não escolhe status, complexidade, prazo nem responsável
    new.status := 'nova';
    new.complexity := 'baixa';
    new.assignee_id := null;
    new.completed_at := null;
    new.created_at := now();
    new.updated_at := now();
    new.due_at := now() + public.sla_interval(new.complexity);
    new.requester_email := lower(trim(new.requester_email));
    new.number := nextval('public.tasks_number_seq');
    return new;
  end if;

  -- UPDATE: viewer logado só pode mudar o status (a política de acesso garante que a tarefa é dele)
  if auth.role() = 'authenticated' and not public.is_mgr() then
    if row(new.name, new.requester_email, new.impacted_structures, new.project_type, new.needs_interaction,
           new.report_frequency, new.report_channels, new.description, new.attachments, new.complexity,
           new.assignee_id, new.seatalk_group_id)
       is distinct from
       row(old.name, old.requester_email, old.impacted_structures, old.project_type, old.needs_interaction,
           old.report_frequency, old.report_channels, old.description, old.attachments, old.complexity,
           old.assignee_id, old.seatalk_group_id) then
      raise exception 'Você só pode alterar o status desta tarefa';
    end if;
  end if;

  new.number := old.number;
  new.created_at := old.created_at;
  new.requester_email := lower(trim(new.requester_email));
  if new.complexity is distinct from old.complexity then
    new.due_at := old.created_at + public.sla_interval(new.complexity);
  end if;
  if new.status = 'concluida' and old.status <> 'concluida' then new.completed_at := now(); end if;
  if new.status <> 'concluida' then new.completed_at := null; end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists tasks_before_write on public.tasks;
create trigger tasks_before_write
  before insert or update on public.tasks
  for each row execute function public.tasks_before_write();

create index if not exists tasks_status_idx on public.tasks (status);
create index if not exists tasks_assignee_idx on public.tasks (assignee_id);

-- -------------------------------------------------------------------------------------
-- 5) Preferências (tela de Configurações). Uma única linha, id = 1.
-- -------------------------------------------------------------------------------------
create table if not exists public.settings (
  id          integer primary key check (id = 1),
  max_alta    integer not null default 3  check (max_alta  >= 0),
  max_media   integer not null default 5  check (max_media >= 0),
  max_total   integer not null default 10 check (max_total >= 0),
  burnout     boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

create or replace function public.settings_touch() returns trigger
language plpgsql as $$
begin
  new.id := 1;
  new.updated_at := now();
  new.updated_by := nullif(public.my_email(), '');
  return new;
end $$;

drop trigger if exists settings_touch on public.settings;
create trigger settings_touch
  before insert or update on public.settings
  for each row execute function public.settings_touch();

-- Usada pelo formulário público: devolve só "sim/não", sem expor dados do time.
create or replace function public.capacity_status() returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (select * from public.settings where id = 1),
       o as (select count(*) filter (where complexity = 'alta')  as alta,
                    count(*) filter (where complexity = 'media') as media,
                    count(*) as total
             from public.tasks where status <> 'concluida')
  select jsonb_build_object(
    'overloaded', (s.burnout or o.alta > s.max_alta or o.media > s.max_media or o.total > s.max_total),
    'burnout',    s.burnout,
    'exceeded',   jsonb_build_object('alta', o.alta > s.max_alta, 'media', o.media > s.max_media, 'total', o.total > s.max_total)
  )
  from s, o
$$;
grant execute on function public.capacity_status() to anon, authenticated;

-- -------------------------------------------------------------------------------------
-- 6) Histórico de notificações enviadas pelo SeaTalk (gravado pela função /api/seatalk)
-- -------------------------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  template    text not null,
  channel     text not null check (channel in ('dm','group','webhook')),
  recipient   text,
  content     text not null,
  status      text not null default 'sent' check (status in ('sent','failed')),
  error       text,
  sent_by     text,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_task_idx on public.notifications (task_id, created_at desc);

-- -------------------------------------------------------------------------------------
-- 7) Fotos de perfil
-- -------------------------------------------------------------------------------------
create table if not exists public.avatars (
  email       text primary key,
  path        text not null,
  updated_at  timestamptz not null default now()
);

-- -------------------------------------------------------------------------------------
-- 8) Políticas de acesso (RLS). Quem não está em profiles não lê nada.
-- -------------------------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.tasks         enable row level security;
alter table public.settings      enable row level security;
alter table public.notifications enable row level security;
alter table public.avatars       enable row level security;

-- profiles
drop policy if exists "membros veem perfis"        on public.profiles;
drop policy if exists "owner e admin adicionam"    on public.profiles;
drop policy if exists "owner e admin editam"       on public.profiles;
drop policy if exists "owner remove"               on public.profiles;
create policy "membros veem perfis" on public.profiles for select to authenticated
  using (public.is_member());
create policy "owner e admin adicionam" on public.profiles for insert to authenticated
  with check ((public.my_role() = 'owner' and role in ('admin','viewer'))
           or (public.my_role() = 'admin' and role = 'viewer'));
create policy "owner e admin editam" on public.profiles for update to authenticated
  using      ((public.my_role() = 'owner' and role <> 'owner') or (public.my_role() = 'admin' and role = 'viewer'))
  with check ((public.my_role() = 'owner' and role <> 'owner') or (public.my_role() = 'admin' and role = 'viewer'));
create policy "owner remove" on public.profiles for delete to authenticated
  using (public.my_role() = 'owner' and role <> 'owner');

-- tasks
drop policy if exists "formulario publico cria"       on public.tasks;
drop policy if exists "membros veem tarefas"          on public.tasks;
drop policy if exists "gestores editam, viewer as suas" on public.tasks;
drop policy if exists "gestores excluem"              on public.tasks;
create policy "formulario publico cria" on public.tasks for insert to anon, authenticated
  with check (true);
create policy "membros veem tarefas" on public.tasks for select to authenticated
  using (public.is_member());
create policy "gestores editam, viewer as suas" on public.tasks for update to authenticated
  using      (public.is_mgr() or assignee_id = public.my_profile_id())
  with check (public.is_mgr() or assignee_id = public.my_profile_id());
create policy "gestores excluem" on public.tasks for delete to authenticated
  using (public.is_mgr());

-- settings
drop policy if exists "membros leem config"    on public.settings;
drop policy if exists "gestores alteram config" on public.settings;
drop policy if exists "gestores criam config"   on public.settings;
create policy "membros leem config" on public.settings for select to authenticated
  using (public.is_member());
create policy "gestores alteram config" on public.settings for update to authenticated
  using (public.is_mgr()) with check (public.is_mgr());
create policy "gestores criam config" on public.settings for insert to authenticated
  with check (public.is_mgr());

-- notifications (só leitura; quem grava é a função serverless, com a chave de serviço)
drop policy if exists "membros veem notificacoes" on public.notifications;
create policy "membros veem notificacoes" on public.notifications for select to authenticated
  using (public.is_member());

-- avatars
drop policy if exists "membros veem avatares" on public.avatars;
drop policy if exists "cada um gerencia o seu" on public.avatars;
create policy "membros veem avatares" on public.avatars for select to authenticated
  using (public.is_member());
create policy "cada um gerencia o seu" on public.avatars for all to authenticated
  using (email = public.my_email()) with check (email = public.my_email());

-- -------------------------------------------------------------------------------------
-- 8b) Arquivos: bucket "anexos" (formulário envia, membros leem) e "avatares"
-- -------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
  values ('anexos', 'anexos', false, 20971520) on conflict (id) do nothing;      -- 20 MB
insert into storage.buckets (id, name, public, file_size_limit)
  values ('avatares', 'avatares', false, 5242880) on conflict (id) do nothing;   -- 5 MB

drop policy if exists "anexos: formulario envia"  on storage.objects;
drop policy if exists "anexos: membros leem"      on storage.objects;
drop policy if exists "anexos: gestores apagam"   on storage.objects;
drop policy if exists "avatares: membros leem"    on storage.objects;
drop policy if exists "avatares: cada um envia"   on storage.objects;
drop policy if exists "avatares: cada um apaga"   on storage.objects;
create policy "anexos: formulario envia" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'anexos');
create policy "anexos: membros leem" on storage.objects for select to authenticated
  using (bucket_id = 'anexos' and public.is_member());
create policy "anexos: gestores apagam" on storage.objects for delete to authenticated
  using (bucket_id = 'anexos' and public.is_mgr());
create policy "avatares: membros leem" on storage.objects for select to authenticated
  using (bucket_id = 'avatares' and public.is_member());
create policy "avatares: cada um envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatares' and (storage.foldername(name))[1] = public.my_email());
create policy "avatares: cada um apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = public.my_email());

-- -------------------------------------------------------------------------------------
-- 8c) Tempo real: a tela do REX atualiza sozinha quando tarefas e preferências mudam
-- -------------------------------------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table public.tasks;    exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.settings; exception when duplicate_object then null; end;
end $$;

-- -------------------------------------------------------------------------------------
-- 9) >>> EDITE AQUI <<<  O primeiro owner (você). Sem esta linha ninguém consegue entrar.
--    Depois, as outras pessoas são adicionadas pela própria tela "Equipe" do REX.
-- -------------------------------------------------------------------------------------
insert into public.profiles (email, name, role)
  values ('SEU.EMAIL@shopee.com', 'Seu Nome', 'owner')
  on conflict (email) do update set role = 'owner', active = true;
