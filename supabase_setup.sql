-- ============================================================
-- 退職届ナビ（請負版）Supabase セットアップ
-- ------------------------------------------------------------
-- 実行方法：Supabase ダッシュボード > SQL Editor に全文貼り付けて Run
-- （結成ナビと同じプロジェクトでOK。テーブル名は taishoku_ で分離しています）
--
-- ★もうひとつ手作業が必要です★
--   Authentication > Users > Add user で運営者アカウントを作成し、
--   発行された User UID を下の taishoku_is_operator() 関数に設定してください。
--   "Auto Confirm User" にチェックを忘れずに。
-- ============================================================

-- 受付番号の連番（T-0001, T-0002, ...）
create sequence if not exists taishoku_order_seq;

-- 注文テーブル
create table if not exists taishoku_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text unique not null
    default ('T-' || lpad(nextval('taishoku_order_seq')::text, 4, '0')),
  owner uuid not null default auth.uid(),
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment','paid','shipped','done','cancelled')),
  payload jsonb not null,          -- 退職届の内容・署名画像・連絡先
  tracking_no text,                -- 発送後の追跡番号
  op_note text,                    -- 運営者メモ
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at 自動更新
create or replace function taishoku_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists taishoku_orders_touch on taishoku_orders;
create trigger taishoku_orders_touch
  before update on taishoku_orders
  for each row execute function taishoku_touch_updated_at();

-- 運営者判定（User UIDで判定。Authentication > Users で発行されたUIDに置き換えてください）
create or replace function taishoku_is_operator() returns boolean
language sql stable as $$
  select auth.uid() = '767bcace-1674-41b7-bb90-4f035319dbd4'::uuid
$$;

-- RLS：本人は自分の注文のみ、運営者は全件
alter table taishoku_orders enable row level security;

drop policy if exists "taishoku insert own" on taishoku_orders;
create policy "taishoku insert own" on taishoku_orders
  for insert to authenticated
  with check (owner = auth.uid());

drop policy if exists "taishoku select own or operator" on taishoku_orders;
create policy "taishoku select own or operator" on taishoku_orders
  for select to authenticated
  using (owner = auth.uid() or taishoku_is_operator());

-- 依頼者ができる更新は「入金待ちのうちにキャンセル」だけ
drop policy if exists "taishoku cancel own" on taishoku_orders;
create policy "taishoku cancel own" on taishoku_orders
  for update to authenticated
  using (owner = auth.uid() and status = 'awaiting_payment')
  with check (status = 'cancelled');

-- 運営者は全件更新可（ステータス変更・追跡番号など）
drop policy if exists "taishoku operator update" on taishoku_orders;
create policy "taishoku operator update" on taishoku_orders
  for update to authenticated
  using (taishoku_is_operator())
  with check (taishoku_is_operator());
