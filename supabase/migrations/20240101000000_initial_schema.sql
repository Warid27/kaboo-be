-- Users are managed by auth.users, but we use a public profile table
create table public.profiles (
  id uuid references auth.users not null primary key,
  username text unique not null,
  avatar_url text,
  created_at timestamptz default now()
);

-- Games Table
create table public.games (
  id uuid default gen_random_uuid() primary key,
  room_code text unique not null,
  status text not null default 'waiting', -- 'waiting', 'playing', 'finished'
  
  -- The ENTIRE game state is serialized here.
  -- This replaces the Durable Object in-memory state.
  game_state jsonb not null default '{}'::jsonb,
  
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now() -- Used for Realtime ordering
);

-- Players in a game
create table public.game_players (
  id uuid default gen_random_uuid() primary key,
  game_id uuid references public.games(id) on delete cascade,
  user_id uuid references public.profiles(id),
  player_name text not null,
  position integer not null,
  is_connected boolean default true,
  score integer,
  
  unique(game_id, user_id),
  unique(game_id, position)
);

-- Security: Enable RLS
alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;

-- Policies
-- Profiles: Everyone can read, User can update own
create policy "Public profiles are viewable by everyone." on public.profiles for select using (true);
create policy "Users can insert their own profile." on public.profiles for insert with check (auth.uid() = id);
create policy "Users can update own profile." on public.profiles for update using (auth.uid() = id);

-- Games:
-- Read: Everyone (or maybe just players? for now everyone to simplify joining)
create policy "Games are viewable by everyone." on public.games for select using (true);
-- Insert: Authenticated users can create games
create policy "Authenticated users can create games." on public.games for insert with check (auth.role() = 'authenticated');

-- Game Players:
-- Read: Everyone
create policy "Game players are viewable by everyone." on public.game_players for select using (true);

-- Realtime
alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.game_players;
