-- Create admin users table for authorized access
-- This table will store admin credentials separate from Supabase auth

create table if not exists public.admin_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text,
  role text default 'analyst',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security
alter table public.admin_users enable row level security;

-- RLS Policies: Only authenticated users can view their own data
create policy "Users can view their own admin profile"
  on public.admin_users for select
  using (auth.uid() = id);

create policy "Users can update their own admin profile"
  on public.admin_users for update
  using (auth.uid() = id);

-- Create function to auto-create admin profile on signup
create or replace function public.handle_new_admin_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.admin_users (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', null),
    coalesce(new.raw_user_meta_data ->> 'role', 'analyst')
  )
  on conflict (id) do nothing;
  
  return new;
end;
$$;

-- Create trigger for auto-creating admin profile
drop trigger if exists on_auth_admin_user_created on auth.users;

create trigger on_auth_admin_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_admin_user();

-- Create updated_at trigger function
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

-- Add updated_at trigger to admin_users
drop trigger if exists admin_users_updated_at on public.admin_users;

create trigger admin_users_updated_at
  before update on public.admin_users
  for each row
  execute function public.handle_updated_at();
