-- =====================================================================
-- Pickale-Tauschbörse – Datenbankschema für Supabase
-- Komplett im Supabase-Dashboard unter "SQL Editor" ausführen.
--
-- Sicherheitskonzept:
--  * Admins melden sich mit Supabase-Auth (E-Mail + Passwort) an und
--    dürfen dank Row Level Security (RLS) alle Tabellen bearbeiten.
--  * Kinder/Benutzer haben KEIN Supabase-Konto. Sie kennen nur ihren
--    Anmeldecode. Alle ihre Zugriffe laufen über die RPC-Funktionen
--    weiter unten, die den Code prüfen. Direkter Tabellenzugriff ist
--    für nicht angemeldete Besucher (Rolle "anon") gesperrt.
-- =====================================================================

-- ---------- Hilfsfunktion: Code normalisieren -------------------------
-- "Tiger Banane 27", "tiger-banane-27", "TIGERBANANE27" -> "tigerbanane27"
create or replace function public.normalize_code(p text)
returns text
language sql immutable
as $$ select regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]', '', 'g') $$;

-- ---------- Tabellen --------------------------------------------------
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.campaigns (
  id         bigint generated always as identity primary key,
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.stickers (
  id          bigint generated always as identity primary key,
  campaign_id bigint not null references public.campaigns(id) on delete cascade,
  number      text not null,          -- Text, damit auch "A1" oder "12a" geht
  name        text not null default '',
  unique (campaign_id, number)
);

create table if not exists public.players (
  id           bigint generated always as identity primary key,
  display_name text not null,
  login_code   text not null,          -- so wie er angezeigt wird
  login_key    text generated always as (public.normalize_code(login_code)) stored unique,
  share_token  uuid not null unique default gen_random_uuid(),
  created_at   timestamptz not null default now()
);

-- qty = Anzahl Exemplare insgesamt (1 = eingeklebt, 2 = ein Doppelter, ...)
-- Fehlende Sticker haben keine Zeile.
create table if not exists public.player_stickers (
  player_id  bigint not null references public.players(id) on delete cascade,
  sticker_id bigint not null references public.stickers(id) on delete cascade,
  qty        int not null check (qty between 1 and 99),
  primary key (player_id, sticker_id)
);
create index if not exists player_stickers_sticker_idx on public.player_stickers(sticker_id);
create index if not exists stickers_campaign_idx on public.stickers(campaign_id);

-- ---------- Admin-Prüfung ---------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;

-- ---------- Row Level Security ----------------------------------------
alter table public.admins          enable row level security;
alter table public.campaigns       enable row level security;
alter table public.stickers        enable row level security;
alter table public.players         enable row level security;
alter table public.player_stickers enable row level security;

drop policy if exists "admin_all" on public.campaigns;
drop policy if exists "admin_all" on public.stickers;
drop policy if exists "admin_all" on public.players;
drop policy if exists "admin_all" on public.player_stickers;
create policy "admin_all" on public.campaigns       for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin_all" on public.stickers        for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin_all" on public.players         for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin_all" on public.player_stickers for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- admins: keine Policy -> nur über SQL-Editor pflegbar.

revoke all on public.admins, public.campaigns, public.stickers, public.players, public.player_stickers from anon;
grant select, insert, update, delete on public.campaigns, public.stickers, public.players, public.player_stickers to authenticated;
grant usage on all sequences in schema public to authenticated;

-- ---------- Interne Hilfsfunktion: Code -> Spieler-ID ------------------
create or replace function public._require_player(p_code text)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare v_id bigint;
begin
  select p.id into v_id from public.players p where p.login_key = public.normalize_code(p_code);
  if v_id is null then
    perform pg_sleep(1);  -- bremst Durchprobieren von Codes
    raise exception 'Unbekannter Code' using errcode = 'P0001';
  end if;
  return v_id;
end $$;

-- ---------- RPC-Funktionen für Benutzer (ohne Supabase-Konto) ----------

-- Anmelden: liefert Anzeigename und Freigabe-Token
create or replace function public.player_login(p_code text)
returns json
language plpgsql security definer set search_path = public
as $$
declare v_id bigint := public._require_player(p_code);
begin
  return (select json_build_object('display_name', p.display_name, 'share_token', p.share_token)
          from public.players p where p.id = v_id);
end $$;

-- Aktive Tauschaktionen
create or replace function public.list_campaigns()
returns table (id bigint, name text)
language sql stable security definer set search_path = public
as $$ select c.id, c.name from public.campaigns c where c.active order by c.created_at desc $$;

-- Alle Sticker einer Aktion inkl. eigener Anzahl
create or replace function public.my_stickers(p_code text, p_campaign_id bigint)
returns table (sticker_id bigint, number text, name text, qty int)
language plpgsql security definer set search_path = public
as $$
declare v_player bigint := public._require_player(p_code);
begin
  return query
    select s.id, s.number, s.name, coalesce(ps.qty, 0)
    from public.stickers s
    join public.campaigns c on c.id = s.campaign_id and c.active
    left join public.player_stickers ps on ps.sticker_id = s.id and ps.player_id = v_player
    where s.campaign_id = p_campaign_id;
end $$;

-- Anzahl eines Stickers setzen (0 = fehlt)
create or replace function public.set_sticker_qty(p_code text, p_sticker_id bigint, p_qty int)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_player bigint := public._require_player(p_code);
begin
  if p_qty is null or p_qty < 0 or p_qty > 99 then
    raise exception 'Ungültige Anzahl';
  end if;
  if not exists (select 1 from public.stickers s join public.campaigns c on c.id = s.campaign_id
                 where s.id = p_sticker_id and c.active) then
    raise exception 'Unbekannter Sticker';
  end if;
  if p_qty = 0 then
    delete from public.player_stickers where player_id = v_player and sticker_id = p_sticker_id;
  else
    insert into public.player_stickers (player_id, sticker_id, qty)
    values (v_player, p_sticker_id, p_qty)
    on conflict (player_id, sticker_id) do update set qty = excluded.qty;
  end if;
end $$;

-- Anzeigenamen ändern
create or replace function public.set_display_name(p_code text, p_name text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_player bigint := public._require_player(p_code);
  v_name text := btrim(coalesce(p_name, ''));
begin
  if length(v_name) < 1 or length(v_name) > 40 then
    raise exception 'Name muss 1 bis 40 Zeichen lang sein';
  end if;
  update public.players set display_name = v_name where id = v_player;
end $$;

-- Öffentliche Ansicht: Doppelte eines Benutzers (ohne das eingeklebte Exemplar)
create or replace function public.shared_duplicates(p_token uuid)
returns json
language sql stable security definer set search_path = public
as $$
  select json_build_object(
    'display_name', p.display_name,
    'campaigns', coalesce((
      select json_agg(json_build_object(
               'id', c.id,
               'name', c.name,
               'stickers', (
                 select coalesce(json_agg(json_build_object(
                          'sticker_id', s.id, 'number', s.number, 'name', s.name,
                          'extra', ps.qty - 1)), '[]'::json)
                 from public.player_stickers ps
                 join public.stickers s on s.id = ps.sticker_id
                 where ps.player_id = p.id and s.campaign_id = c.id and ps.qty > 1)
             ) order by c.created_at desc)
      from public.campaigns c where c.active
    ), '[]'::json)
  )
  from public.players p
  where p.share_token = p_token
$$;

-- ---------- Ausführungsrechte -----------------------------------------
revoke execute on function public._require_player(text) from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon;
grant  execute on function public.is_admin() to authenticated;
grant  execute on function public.normalize_code(text) to anon, authenticated;
grant  execute on function public.player_login(text)                   to anon, authenticated;
grant  execute on function public.list_campaigns()                     to anon, authenticated;
grant  execute on function public.my_stickers(text, bigint)            to anon, authenticated;
grant  execute on function public.set_sticker_qty(text, bigint, int)   to anon, authenticated;
grant  execute on function public.set_display_name(text, text)         to anon, authenticated;
grant  execute on function public.shared_duplicates(uuid)              to anon, authenticated;
