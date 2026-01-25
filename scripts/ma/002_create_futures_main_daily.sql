-- Supabase SQL to create futures_main_daily cache table
-- Ensure appropriate RLS policies granting read to anon and write via authenticated or service role as needed

create table if not exists public.futures_main_daily (
  id bigint generated always as identity primary key,
  code text not null check (code in ('IH','IF','IC','IM')),
  ts_code text,
  trade_date text not null, -- YYYYMMDD
  close numeric,
  settle numeric,
  settle_return numeric, -- percent change
  source text,
  inserted_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists futures_main_daily_code_trade_date_idx
  on public.futures_main_daily (code, trade_date);

-- Update trigger to set updated_at
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger futures_main_daily_set_updated_at
  before update on public.futures_main_daily
  for each row execute procedure public.set_updated_at();
