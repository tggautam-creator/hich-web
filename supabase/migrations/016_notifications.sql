-- Notifications table for persistent in-app notifications
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  type        text not null,            -- 'board_request', 'board_accepted', 'board_declined', 'ride_request', etc.
  title       text not null,
  body        text not null,
  data        jsonb not null default '{}',  -- ride_id, schedule_id, requester_name, etc.
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Index for fetching user's notifications sorted by recency
create index if not exists idx_notifications_user_created
  on public.notifications(user_id, created_at desc);

-- RLS
alter table public.notifications enable row level security;

create policy "Users can read own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

create policy "Users can update own notifications"
  on public.notifications for update
  using (auth.uid() = user_id);

-- Server (service role) can insert
create policy "Service role can insert notifications"
  on public.notifications for insert
  with check (true);
