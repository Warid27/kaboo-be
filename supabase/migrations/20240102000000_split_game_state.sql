-- Create game_secrets table to store sensitive game state
create table public.game_secrets (
  game_id uuid references public.games(id) on delete cascade primary key,
  game_state jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable RLS
alter table public.game_secrets enable row level security;

-- Policies for game_secrets:
-- DENY ALL for everyone (public, authenticated).
-- Only Service Role can access.
-- No policies needed implies Deny All.
-- Explicitly:
create policy "No one can read game_secrets" on public.game_secrets for select using (false);
create policy "No one can insert game_secrets" on public.game_secrets for insert with check (false);
create policy "No one can update game_secrets" on public.game_secrets for update using (false);

-- Drop game_state from games table
-- Note: In a real production migration with data, we would copy data first.
-- Since this is dev, we can just drop it.
alter table public.games drop column game_state;
