-- ライフプランアプリ用のテーブル。Supabase の「SQL Editor」に貼り付けて実行してください。
-- 1アカウント(auth.users)が複数の受講生プランを持ちます。RLS により、本人以外は読み書きできません。

create table if not exists public.plans (
  user_id     uuid    not null default auth.uid() references auth.users(id) on delete cascade,
  id          text    not null,                 -- アプリ側で発行するプランID
  name        text    not null default '',
  memo        text    not null default '',
  data        jsonb   not null,                 -- 入力内容(受講生のプラン)
  created_ms  bigint  not null default (extract(epoch from now()) * 1000)::bigint,
  updated_ms  bigint  not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (user_id, id)
);

alter table public.plans enable row level security;

create policy "plans_select_own" on public.plans for select to authenticated using (auth.uid() = user_id);
create policy "plans_insert_own" on public.plans for insert to authenticated with check (auth.uid() = user_id);
create policy "plans_update_own" on public.plans for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "plans_delete_own" on public.plans for delete to authenticated using (auth.uid() = user_id);

-- 未ログイン(anon)には何も許可しない(ポリシーを付けないため、読み書きともに拒否されます)。
