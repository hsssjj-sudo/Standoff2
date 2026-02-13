create table if not exists public.market_listings (
  id bigint generated always as identity primary key,
  name text not null,
  rarity text not null,
  type text not null,
  price integer not null check (price > 0),
  seller_name text not null,
  seller_id text not null,
  buyer_name text,
  buyer_id text,
  emoji text default '🎯',
  status text not null default 'active' check (status in ('active', 'sold')),
  created_at timestamptz not null default now(),
  sold_at timestamptz
);

create index if not exists market_listings_status_created_idx on public.market_listings(status, created_at desc);

create or replace function public.purchase_market_listing(
  p_listing_id bigint,
  p_buyer_id text,
  p_buyer_name text
)
returns json
language plpgsql
security definer
as $$
declare
  v_listing public.market_listings%rowtype;
begin
  update public.market_listings
  set status = 'sold',
      buyer_id = p_buyer_id,
      buyer_name = coalesce(p_buyer_name, 'Игрок'),
      sold_at = now()
  where id = p_listing_id
    and status = 'active'
  returning * into v_listing;

  if v_listing.id is null then
    return json_build_object('success', false, 'message', 'Лот уже продан или не найден');
  end if;

  return json_build_object(
    'success', true,
    'message', 'Покупка успешно завершена',
    'item', row_to_json(v_listing)
  );
end;
$$;
