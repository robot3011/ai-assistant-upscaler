-- =========================================================
-- NovaMind schema
-- =========================================================

-- Profiles
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Roles enum + table
create type public.app_role as enum ('admin', 'user');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null default 'user',
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

alter table public.user_roles enable row level security;

-- has_role security definer (avoids recursive RLS)
create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  );
$$;

-- Auto-create profile + role on signup; first user becomes admin
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_count int;
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));

  select count(*) into admin_count from public.user_roles where role = 'admin';
  insert into public.user_roles (user_id, role)
  values (new.id, case when admin_count = 0 then 'admin'::app_role else 'user'::app_role end);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- updated_at helper
create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger update_profiles_updated_at
before update on public.profiles
for each row execute function public.update_updated_at_column();

-- Conversations
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  tone text not null default 'balanced',
  system_prompt text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_conversations_user on public.conversations(user_id, updated_at desc);
alter table public.conversations enable row level security;

create trigger update_conversations_updated_at
before update on public.conversations
for each row execute function public.update_updated_at_column();

-- Messages
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null default '',
  images jsonb,
  kind text not null default 'text' check (kind in ('text','generated_image')),
  created_at timestamptz not null default now()
);

create index idx_messages_conv on public.messages(conversation_id, created_at);
alter table public.messages enable row level security;

-- =========================================================
-- RLS POLICIES
-- =========================================================

-- profiles
create policy "Users read own profile"
  on public.profiles for select
  using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));

create policy "Users insert own profile"
  on public.profiles for insert
  with check (auth.uid() = user_id);

create policy "Users update own profile"
  on public.profiles for update
  using (auth.uid() = user_id);

-- user_roles
create policy "Users read own roles"
  on public.user_roles for select
  using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));

create policy "Admins manage roles"
  on public.user_roles for all
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- conversations
create policy "Users select own conversations"
  on public.conversations for select
  using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));

create policy "Users insert own conversations"
  on public.conversations for insert
  with check (auth.uid() = user_id);

create policy "Users update own conversations"
  on public.conversations for update
  using (auth.uid() = user_id);

create policy "Users delete own conversations"
  on public.conversations for delete
  using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));

-- messages
create policy "Users select own messages"
  on public.messages for select
  using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));

create policy "Users insert own messages"
  on public.messages for insert
  with check (auth.uid() = user_id);

create policy "Users delete own messages"
  on public.messages for delete
  using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));