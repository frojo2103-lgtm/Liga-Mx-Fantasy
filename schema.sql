-- =====================================================================
-- Fantasy Liga MX — esquema de base de datos para Supabase
-- Pega TODO este archivo en Supabase → SQL Editor → New query → Run.
-- Se puede volver a correr sin problema (borra y recrea funciones/políticas).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- utilidades ----------
create or replace function now_ms() returns bigint language sql stable as
$$ select (extract(epoch from now())*1000)::bigint $$;

-- ---------- tablas ----------
create table if not exists members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  avatar text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists config (
  id int primary key default 1 check (id = 1),
  data jsonb not null
);

create table if not exists players (
  id text primary key,
  name text not null,
  team text not null,
  pos text not null check (pos in ('PT','DF','MC','DC')),
  num int,
  value numeric not null default 1,
  owner uuid references auth.users(id) on delete set null,
  clause numeric,
  signed_at bigint,
  sale_price numeric,
  sale_at bigint
);
create index if not exists players_owner_idx on players(owner);

create table if not exists photos (
  id text primary key references players(id) on delete cascade,
  src text not null
);

create table if not exists managers (
  id uuid primary key references auth.users(id) on delete cascade,
  team_name text not null,
  cash numeric not null default 0,
  formation text not null default '4-4-2',
  lineup text[] not null default '{}',
  joined_at bigint not null default now_ms()
);

create table if not exists bids (
  user_id uuid not null references auth.users(id) on delete cascade,
  player_id text not null references players(id) on delete cascade,
  amount numeric not null,
  at bigint not null default now_ms(),
  primary key (user_id, player_id)
);

create table if not exists market (
  id int primary key default 1 check (id = 1),
  ids text[] not null default '{}',
  opened_at bigint
);

create table if not exists feed (
  id bigserial primary key,
  t bigint not null default now_ms(),
  text text not null
);

create table if not exists points (
  jornada int not null,
  player_id text not null references players(id) on delete cascade,
  pts int not null,
  primary key (jornada, player_id)
);

create table if not exists results (
  jornada int primary key,
  scores jsonb not null default '{}',
  lineups jsonb not null default '{}',
  closed_at bigint
);

-- configuración inicial (solo si no existe)
insert into config(id, data) values (1, '{"startCash":50,"pointValue":0.2,"marketSize":12,"clauseRaise":0.5,"lockDays":14,"maxSquad":24,"quickSale":0.5,"squad":{"PT":1,"DF":4,"MC":4,"DC":2},"jornada":1,"lineupsLocked":false,"closed":{},"teams":["América","Atlante","Atlas","Atlético de San Luis","Cruz Azul","Guadalajara","Juárez","León","Monterrey","Necaxa","Pachuca","Puebla","Pumas UNAM","Querétaro","Santos Laguna","Tigres UANL","Tijuana","Toluca"]}')
on conflict (id) do nothing;
insert into market(id) values (1) on conflict (id) do nothing;

-- ---------- quién es quién ----------
create or replace function is_member() returns boolean language sql stable security definer set search_path = public as
$$ select exists(select 1 from members where user_id = auth.uid() and status = 'approved') $$;

create or replace function is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select exists(select 1 from members where user_id = auth.uid() and status = 'approved' and is_admin) $$;

create or replace function cfg() returns jsonb language sql stable security definer set search_path = public as
$$ select data from config where id = 1 $$;

create or replace function add_feed(p_text text) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into feed(text) values (p_text);
  delete from feed where id in (select id from feed order by id desc offset 80);
end $$;

-- Registro al iniciar sesión. El PRIMER usuario en entrar queda como administrador.
create or replace function register_me() returns members language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  j jsonb;
  m members;
  first boolean;
begin
  if u is null then raise exception 'Inicia sesión primero'; end if;
  select raw_user_meta_data into j from auth.users where id = u;
  select not exists(select 1 from members) into first;
  insert into members(user_id, email, name, avatar, status, is_admin)
  values (u, (select email from auth.users where id = u),
          coalesce(j->>'full_name', j->>'name', ''), coalesce(j->>'avatar_url', ''),
          case when first then 'approved' else 'pending' end, first)
  on conflict (user_id) do update set name = excluded.name, avatar = excluded.avatar, email = excluded.email;
  select * into m from members where user_id = u;
  return m;
end $$;

-- ---------- helpers de juego ----------
create or replace function form_counts(f text) returns jsonb language plpgsql immutable as $$
declare a text[] := string_to_array(coalesce(f,'4-4-2'), '-');
begin
  return jsonb_build_object('PT',1,'DF',a[1]::int,'MC',a[2]::int,'DC',a[3]::int);
end $$;

create or replace function squad_size(u uuid) returns int language sql stable security definer set search_path = public as
$$ select count(*)::int from players where owner = u $$;

create or replace function deal_to(u uuid) returns int language plpgsql security definer set search_path = public as $$
declare
  c jsonb := cfg();
  v_pos text;
  n int;
  r record;
  got int := 0;
  v_lineup text[] := '{}';
  fc jsonb := form_counts('4-4-2');
  inpos int;
begin
  perform pg_advisory_xact_lock(4242);
  foreach v_pos in array array['PT','DF','MC','DC'] loop
    n := coalesce((c->'squad'->>v_pos)::int, 0);
    inpos := 0;
    for r in select p.id from players p where p.owner is null and p.pos = v_pos order by random() limit n loop
      update players set owner = u, clause = value, signed_at = now_ms(), sale_price = null, sale_at = null where id = r.id;
      got := got + 1;
      if inpos < (fc->>v_pos)::int then v_lineup := v_lineup || r.id; inpos := inpos + 1; end if;
    end loop;
  end loop;
  update managers set lineup = v_lineup, formation = '4-4-2' where id = u;
  return got;
end $$;

-- ---------- acciones de jugadores (todas validadas en el servidor) ----------
create or replace function join_league(p_team text) returns int language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); got int; nm text := left(trim(coalesce(p_team,'')), 30);
begin
  if not is_member() then raise exception 'Tu acceso aún no está aprobado'; end if;
  if nm = '' then raise exception 'Escribe un nombre para tu equipo'; end if;
  if exists(select 1 from managers where id = u) then raise exception 'Ya estás en la liga'; end if;
  insert into managers(id, team_name, cash) values (u, nm, coalesce((cfg()->>'startCash')::numeric, 50));
  got := deal_to(u);
  perform add_feed(nm || ' se unió a la liga y recibió ' || got || ' jugadores');
  return got;
end $$;

create or replace function rename_team(p_name text) returns void language plpgsql security definer set search_path = public as $$
declare nm text := left(trim(coalesce(p_name,'')), 30);
begin
  if nm = '' then raise exception 'Nombre vacío'; end if;
  update managers set team_name = nm where id = auth.uid();
end $$;

create or replace function set_lineup(p_formation text, p_lineup text[]) returns void language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); fc jsonb; v_pos text; cnt int;
begin
  if coalesce((cfg()->>'lineupsLocked')::boolean, false) then raise exception 'Las alineaciones están bloqueadas'; end if;
  if p_formation not in ('3-4-3','3-5-2','4-3-3','4-4-2','4-5-1','5-3-2','5-4-1') then raise exception 'Formación inválida'; end if;
  if exists(select 1 from unnest(p_lineup) x where not exists(select 1 from players p where p.id = x and p.owner = u)) then
    raise exception 'Solo puedes alinear a tus jugadores';
  end if;
  fc := form_counts(p_formation);
  foreach v_pos in array array['PT','DF','MC','DC'] loop
    select count(*) into cnt from unnest(p_lineup) x join players p on p.id = x where p.pos = v_pos;
    if cnt > (fc->>v_pos)::int then raise exception 'Demasiados jugadores en %', v_pos; end if;
  end loop;
  update managers set formation = p_formation, lineup = coalesce((select array_agg(distinct x) from unnest(p_lineup) x), '{}') where id = u;
end $$;

create or replace function quick_sell(p_id text) returns numeric language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); p players; q numeric; tn text;
begin
  select * into p from players where id = p_id for update;
  if p.owner is distinct from u then raise exception 'Ese jugador no es tuyo'; end if;
  q := round(p.value * coalesce((cfg()->>'quickSale')::numeric, 0.5), 1);
  update players set owner = null, clause = null, signed_at = null, sale_price = null, sale_at = null where id = p_id;
  update managers set cash = round(cash + q, 1), lineup = array_remove(lineup, p_id) where id = u returning team_name into tn;
  delete from bids where player_id = p_id;
  perform add_feed(tn || ' vendió rápido a ' || p.name || ' por $' || q || 'M');
  return q;
end $$;

create or replace function list_player(p_id text, p_price numeric) returns void language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); p players; tn text;
begin
  select * into p from players where id = p_id;
  if p.owner is distinct from u then raise exception 'Ese jugador no es tuyo'; end if;
  if p_price < p.value then raise exception 'El precio mínimo es su valor ($%M)', p.value; end if;
  update players set sale_price = round(p_price, 1), sale_at = now_ms() where id = p_id;
  select team_name into tn from managers where id = u;
  perform add_feed(tn || ' puso a ' || p.name || ' en el mercado por $' || round(p_price,1) || 'M');
end $$;

create or replace function unlist_player(p_id text) returns void language plpgsql security definer set search_path = public as $$
begin
  update players set sale_price = null, sale_at = null where id = p_id and owner = auth.uid();
  delete from bids where player_id = p_id;
end $$;

create or replace function place_bid(p_id text, p_amount numeric) returns void language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); p players; m managers; mk text[]; minp numeric; prev bids;
begin
  select * into m from managers where id = u;
  if m.id is null then raise exception 'Únete a la liga primero'; end if;
  select * into p from players where id = p_id;
  if p.id is null then raise exception 'Jugador no encontrado'; end if;
  if p.owner = u then raise exception 'Ese jugador ya es tuyo'; end if;
  select ids into mk from market where id = 1;
  if p.owner is null then
    if not (p_id = any(mk)) then raise exception 'Ese jugador no está en el mercado'; end if;
    minp := p.value;
  else
    if p.sale_price is null then raise exception 'Ese jugador ya no está en venta'; end if;
    minp := p.sale_price;
  end if;
  if p_amount < minp then raise exception 'La puja mínima es $%M', minp; end if;
  if p_amount > m.cash then raise exception 'No puedes pujar más de lo que tienes en caja'; end if;
  if squad_size(u) >= coalesce((cfg()->>'maxSquad')::int, 24) then raise exception 'Tu plantilla está llena'; end if;
  select * into prev from bids where user_id = u and player_id = p_id;
  insert into bids(user_id, player_id, amount, at) values (u, p_id, round(p_amount,1),
      case when prev.amount = round(p_amount,1) then prev.at else now_ms() end)
  on conflict (user_id, player_id) do update set amount = excluded.amount, at = excluded.at;
end $$;

create or replace function remove_bid(p_id text) returns void language sql security definer set search_path = public as
$$ delete from bids where user_id = auth.uid() and player_id = p_id $$;

create or replace function pay_clause(p_id text) returns numeric language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); p players; buyer managers; seller managers; cl numeric; c jsonb := cfg();
begin
  select * into p from players where id = p_id for update;
  if p.owner is null or p.owner = u then raise exception 'No puedes pagar esa cláusula'; end if;
  select * into buyer from managers where id = u for update;
  if buyer.id is null then raise exception 'Únete a la liga primero'; end if;
  cl := greatest(coalesce(p.clause,0), p.value);
  if p.signed_at is not null and now_ms() - p.signed_at < coalesce((c->>'lockDays')::numeric,14) * 86400000 then
    raise exception 'Ese jugador sigue protegido';
  end if;
  if buyer.cash < cl then raise exception 'No te alcanza'; end if;
  if squad_size(u) >= coalesce((c->>'maxSquad')::int, 24) then raise exception 'Tu plantilla está llena'; end if;
  select * into seller from managers where id = p.owner for update;
  update managers set cash = round(cash - cl, 1) where id = u;
  update managers set cash = round(cash + cl, 1), lineup = array_remove(lineup, p_id) where id = p.owner;
  update players set owner = u, signed_at = now_ms(), clause = cl, sale_price = null, sale_at = null where id = p_id;
  delete from bids where player_id = p_id;
  perform add_feed(buyer.team_name || ' pagó la cláusula de ' || p.name || ' ($' || cl || 'M) a ' || coalesce(seller.team_name,'otro equipo'));
  return cl;
end $$;

create or replace function raise_clause(p_id text, p_new numeric) returns numeric language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); p players; cur numeric; cost numeric; m managers;
begin
  select * into p from players where id = p_id for update;
  if p.owner is distinct from u then raise exception 'Ese jugador no es tuyo'; end if;
  cur := greatest(coalesce(p.clause,0), p.value);
  if p_new <= cur then raise exception 'La nueva cláusula debe ser mayor que $%M', cur; end if;
  cost := round((p_new - cur) * coalesce((cfg()->>'clauseRaise')::numeric, 0.5), 1);
  select * into m from managers where id = u for update;
  if m.cash < cost then raise exception 'Subirla cuesta $%M y no te alcanza', cost; end if;
  update players set clause = round(p_new,1) where id = p_id;
  update managers set cash = round(cash - cost, 1) where id = u;
  return cost;
end $$;

-- ---------- acciones de administrador ----------
create or replace function admin_open_market() returns int language plpgsql security definer set search_path = public as $$
declare v_ids text[];
begin
  if not is_admin() then raise exception 'Solo el administrador'; end if;
  select coalesce(array_agg(id), '{}') into v_ids from (select id from players where owner is null order by random()
    limit coalesce((cfg()->>'marketSize')::int, 12)) s;
  update market set ids = v_ids, opened_at = now_ms() where id = 1;
  return coalesce(array_length(v_ids,1),0);
end $$;

create or replace function admin_close_market() returns int language plpgsql security definer set search_path = public as $$
declare
  mk text[]; r record; b record; seller uuid; minp numeric; c jsonb := cfg(); awarded int := 0; ncand int;
  bcash numeric; bcount int; buyer_name text; seller_name text;
begin
  if not is_admin() then raise exception 'Solo el administrador'; end if;
  select ids into mk from market where id = 1;
  for r in select * from players where (owner is null and id = any(mk)) or (owner is not null and sale_price is not null) order by random() loop
    seller := r.owner;
    minp := case when seller is null then r.value else r.sale_price end;
    select count(*) into ncand from bids where player_id = r.id and user_id is distinct from seller;
    for b in select * from bids where player_id = r.id and user_id is distinct from seller order by amount desc, at asc loop
      select cash, team_name into bcash, buyer_name from managers where id = b.user_id;
      if bcash is null then continue; end if;
      bcount := squad_size(b.user_id);
      if bcash >= b.amount and b.amount >= minp and bcount < coalesce((c->>'maxSquad')::int,24) then
        update players set owner = b.user_id, clause = greatest(b.amount, value), signed_at = now_ms(), sale_price = null, sale_at = null where id = r.id;
        update managers set cash = round(cash - b.amount, 1) where id = b.user_id;
        if seller is not null then
          update managers set cash = round(cash + b.amount, 1), lineup = array_remove(lineup, r.id) where id = seller returning team_name into seller_name;
        end if;
        perform add_feed(buyer_name || ' fichó a ' || r.name || case when seller is not null then ' de ' || coalesce(seller_name,'') else '' end
          || ' por $' || b.amount || 'M' || case when ncand > 1 then ' (' || ncand || ' pujas)' else '' end);
        awarded := awarded + 1;
        exit;
      end if;
    end loop;
  end loop;
  delete from bids;
  update market set ids = '{}', opened_at = null where id = 1;
  if awarded = 0 then perform add_feed('Mercado cerrado sin fichajes'); end if;
  return awarded;
end $$;

create or replace function admin_close_jornada(p_j int) returns void language plpgsql security definer set search_path = public as $$
declare
  c jsonb := cfg(); m record; l text[]; s int; prev int; bonus numeric; scores jsonb := '{}'; lineups jsonb := '{}';
  old results; summary text := ''; was_closed boolean;
begin
  if not is_admin() then raise exception 'Solo el administrador'; end if;
  select * into old from results where jornada = p_j;
  was_closed := old.jornada is not null;
  for m in select * from managers loop
    if was_closed and old.lineups ? m.id::text then
      select coalesce(array_agg(x), '{}') into l from jsonb_array_elements_text(old.lineups->m.id::text) x where exists(select 1 from players where id = x);
    else
      select coalesce(array_agg(x), '{}') into l from unnest(m.lineup) x where exists(select 1 from players p where p.id = x and p.owner = m.id);
    end if;
    select coalesce(sum(pts),0) into s from points where jornada = p_j and player_id = any(l);
    prev := coalesce((old.scores->>m.id::text)::int, 0);
    bonus := (greatest(s,0) - greatest(prev,0)) * coalesce((c->>'pointValue')::numeric, 0.2);
    if bonus <> 0 then update managers set cash = round(cash + bonus, 1) where id = m.id; end if;
    scores := scores || jsonb_build_object(m.id::text, s);
    lineups := lineups || jsonb_build_object(m.id::text, to_jsonb(l));
    summary := summary || case when summary = '' then '' else ' · ' end || m.team_name || ' ' || s;
  end loop;
  insert into results(jornada, scores, lineups, closed_at) values (p_j, scores, lineups, now_ms())
  on conflict (jornada) do update set scores = excluded.scores, lineups = excluded.lineups, closed_at = excluded.closed_at;
  update config set data = jsonb_set(jsonb_set(jsonb_set(data, '{closed}', coalesce(data->'closed','{}') || jsonb_build_object(p_j::text, true)),
      '{jornada}', to_jsonb(least(17, greatest(coalesce((data->>'jornada')::int,1), p_j + 1)))), '{lineupsLocked}', 'false') where id = 1;
  perform add_feed('Jornada ' || p_j || case when was_closed then ' recalculada: ' else ' cerrada: ' end || summary);
end $$;

create or replace function admin_deal_missing() returns int language plpgsql security definer set search_path = public as $$
declare m record; n int := 0;
begin
  if not is_admin() then raise exception 'Solo el administrador'; end if;
  for m in select id from managers where squad_size(id) = 0 loop perform deal_to(m.id); n := n + 1; end loop;
  return n;
end $$;

create or replace function admin_kick(p_user uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo el administrador'; end if;
  update players set owner = null, clause = null, signed_at = null, sale_price = null, sale_at = null where owner = p_user;
  delete from bids where user_id = p_user;
  delete from managers where id = p_user;
end $$;

create or replace function admin_set_owner(p_id text, p_user uuid) returns void language plpgsql security definer set search_path = public as $$
declare old uuid;
begin
  if not is_admin() then raise exception 'Solo el administrador'; end if;
  select owner into old from players where id = p_id;
  if old is not null then update managers set lineup = array_remove(lineup, p_id) where id = old; end if;
  update players set owner = p_user, signed_at = case when p_user is null then null else now_ms() end,
    clause = case when p_user is null then null else value end, sale_price = null, sale_at = null where id = p_id;
end $$;

-- ---------- seguridad (RLS) ----------
alter table members  enable row level security;
alter table config   enable row level security;
alter table players  enable row level security;
alter table photos   enable row level security;
alter table managers enable row level security;
alter table bids     enable row level security;
alter table market   enable row level security;
alter table feed     enable row level security;
alter table points   enable row level security;
alter table results  enable row level security;

do $$ declare r record; begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- miembros: cada quien ve su fila; los aprobados ven a todos; solo el admin aprueba
create policy members_read on members for select using (user_id = auth.uid() or is_member());
create policy members_admin on members for update using (is_admin()) with check (is_admin());
create policy members_admin_del on members for delete using (is_admin());

-- lectura para miembros aprobados; escritura directa solo del admin
create policy config_read  on config  for select using (is_member());
create policy config_admin on config  for all using (is_admin()) with check (is_admin());
create policy players_read on players for select using (is_member());
create policy players_admin on players for all using (is_admin()) with check (is_admin());
create policy photos_read  on photos  for select using (is_member());
create policy photos_admin on photos  for all using (is_admin()) with check (is_admin());
create policy market_read  on market  for select using (is_member());
create policy market_admin on market  for all using (is_admin()) with check (is_admin());
create policy feed_read    on feed    for select using (is_member());
create policy points_read  on points  for select using (is_member());
create policy points_admin on points  for all using (is_admin()) with check (is_admin());
create policy results_read on results for select using (is_member());
create policy results_admin on results for all using (is_admin()) with check (is_admin());
create policy managers_read on managers for select using (is_member());
create policy managers_admin on managers for update using (is_admin()) with check (is_admin());
-- pujas: cada quien ve solo las suyas; el admin ve todas (para cerrar el mercado)
create policy bids_read on bids for select using (user_id = auth.uid() or is_admin());

-- permisos de funciones: solo usuarios con sesión
revoke all on all functions in schema public from anon;
grant execute on all functions in schema public to authenticated;
-- funciones internas: nadie las llama directo
revoke execute on function deal_to(uuid) from authenticated, public;
revoke execute on function add_feed(text) from authenticated, public;
revoke execute on function squad_size(uuid) from authenticated, public;

-- tiempo real (actualizaciones en vivo)
do $$ declare t text; begin
  foreach t in array array['members','config','players','photos','managers','bids','market','feed','points','results'] loop
    begin execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;
