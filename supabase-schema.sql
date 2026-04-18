create extension if not exists pgcrypto;

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text,
    full_name text,
    phone text,
    city text,
    address text,
    pincode text,
    preferred_fit text,
    style_mood text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.orders (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    order_code text unique,
    status text not null default 'Confirmed',
    payment_method text not null default 'upi',
    total numeric not null default 0,
    eta text default '2 to 4 business days',
    items jsonb not null default '[]'::jsonb,
    shipping_address jsonb not null default '{}'::jsonb,
    notes text,
    created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.orders enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
for select using (auth.uid() = id);

drop policy if exists "profiles_upsert_own" on public.profiles;
create policy "profiles_upsert_own" on public.profiles
for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
for update using (auth.uid() = id);

drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own" on public.orders
for select using (auth.uid() = user_id);

drop policy if exists "orders_insert_own" on public.orders;
create policy "orders_insert_own" on public.orders
for insert with check (auth.uid() = user_id);
