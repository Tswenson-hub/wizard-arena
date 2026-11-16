-- Round 26: the drop-off readout over public.events (docs/agents/round26-playtime.md §1). Environment agent.
-- Read only: every block below is one standalone SELECT (no views or functions are created, so nothing new is exposed and the
-- security advisor stays quiet). Run each block on its own (the Supabase MCP's execute_sql, or the SQL editor).
-- The window: change `interval '7 days'` in the `p` line of a block (every block has one). Times are UTC.
-- A session is one socket of one human (server/saves.js startSession → endSession). Sessions without a `disconnect` (a server
-- restart, or still playing) count as ended once their last event is 30 minutes old.
-- Detail keys read (spells writes them): session_start { first, cg, platform }, first_kill { s }, first_death { s },
-- match_end { place, kills, deaths, s, humans, bots }, idle_kick { s }, disconnect { seconds, joined_s, last, state, kills, deaths, streak }.

-- ---------------------------------------------------------------- 0. volume: sessions by platform, client generation and first visit
with p as (select now() - interval '7 days' as since),
s as (
  select e.session_id, max(e.platform) as platform, max(e.gen) as gen,
         coalesce(bool_or((e.details->>'first')::boolean) filter (where e.event = 'session_start'), false) as first_visit,
         count(*) filter (where e.event = 'match_end') as matches
    from public.events e, p where e.created_at >= p.since group by e.session_id)
select platform, gen, first_visit, count(*) as sessions, sum(matches) as matches_finished,
       round(avg(matches), 2) as matches_per_session
  from s group by rollup (platform, gen, first_visit) order by platform nulls first, gen nulls first, first_visit nulls first;

-- ---------------------------------------------------------------- 1. where sessions end: the drop-off funnel
-- never joined / before the first kill / during the first match / at the first podium (one match, no rematch) / later
with p as (select now() - interval '7 days' as since),
s as (
  select e.session_id, max(e.platform) as platform,
         coalesce(bool_or((e.details->>'first')::boolean) filter (where e.event = 'session_start'), false) as first_visit,
         count(*) filter (where e.event = 'join') as joins,
         count(*) filter (where e.event = 'first_kill') as first_kills,
         count(*) filter (where e.event = 'match_end') as matches,
         count(*) filter (where e.event = 'rematch_stay') as stays,
         bool_or(e.event = 'disconnect') as disconnected, max(e.created_at) as last_at
    from public.events e, p where e.created_at >= p.since group by e.session_id),
staged as (
  select *, case when joins = 0 then '0 never joined'
                 when matches = 0 and first_kills = 0 then '1 quit before the first kill'
                 when matches = 0 then '2 quit during the first match'
                 when matches = 1 and stays = 0 then '3 quit at the first podium'
                 else '4 later (stayed for a rematch or 2+ matches)' end as stage
    from s where disconnected or last_at < now() - interval '30 minutes')
select stage, first_visit, count(*) as sessions,
       round(100.0 * count(*) / sum(count(*)) over (partition by first_visit), 1) as pct_of_group
  from staged group by stage, first_visit order by first_visit desc, stage;

-- ---------------------------------------------------------------- 2. session length: median (and quartiles), by first visit and platform
-- disconnect.seconds when there is one, else the span between the session's first and last events
with p as (select now() - interval '7 days' as since),
s as (
  select e.session_id, max(e.platform) as platform,
         coalesce(bool_or((e.details->>'first')::boolean) filter (where e.event = 'session_start'), false) as first_visit,
         coalesce(max((e.details->>'seconds')::numeric) filter (where e.event = 'disconnect'),
                  extract(epoch from max(e.created_at) - min(e.created_at))) as seconds,
         bool_or(e.event = 'disconnect') as disconnected, max(e.created_at) as last_at
    from public.events e, p where e.created_at >= p.since group by e.session_id)
select platform, first_visit, count(*) as sessions,
       round(percentile_cont(0.5) within group (order by seconds)::numeric / 60, 2) as median_min,
       round(percentile_cont(0.25) within group (order by seconds)::numeric / 60, 2) as p25_min,
       round(percentile_cont(0.75) within group (order by seconds)::numeric / 60, 2) as p75_min,
       round(100.0 * count(*) filter (where seconds < 180) / count(*), 1) as pct_under_3_min
  from s where disconnected or last_at < now() - interval '30 minutes'
 group by rollup (platform, first_visit) order by platform nulls first, first_visit nulls first;

-- ---------------------------------------------------------------- 3. new players' kills per minute (finished matches), and the first match alone
-- plus how long the first kill and the first death take after joining (medians, seconds)
with p as (select now() - interval '7 days' as since),
fv as (
  select e.session_id, coalesce(bool_or((e.details->>'first')::boolean), false) as first_visit
    from public.events e, p where e.created_at >= p.since and e.event = 'session_start' group by e.session_id),
m as (
  select e.session_id, e.created_at, (e.details->>'kills')::numeric as kills, (e.details->>'deaths')::numeric as deaths,
         nullif((e.details->>'s')::numeric, 0) as s, (e.details->>'place')::int as place,
         row_number() over (partition by e.session_id order by e.created_at) as nth
    from public.events e, p where e.created_at >= p.since and e.event = 'match_end'),
firsts as (
  select e.session_id, max((e.details->>'s')::numeric) filter (where e.event = 'first_kill') as first_kill_s,
         max((e.details->>'s')::numeric) filter (where e.event = 'first_death') as first_death_s
    from public.events e, p where e.created_at >= p.since and e.event in ('first_kill', 'first_death') group by e.session_id)
select fv.first_visit, count(m.*) as matches,
       round(sum(m.kills) / nullif(sum(m.s) / 60, 0), 2) as kills_per_min,
       round(sum(m.deaths) / nullif(sum(m.s) / 60, 0), 2) as deaths_per_min,
       round(sum(m.kills) filter (where m.nth = 1) / nullif(sum(m.s) filter (where m.nth = 1) / 60, 0), 2) as first_match_kills_per_min,
       round(100.0 * count(*) filter (where m.nth = 1 and m.place <= 3) / nullif(count(*) filter (where m.nth = 1), 0), 1) as first_match_podium_pct,
       (select round(percentile_cont(0.5) within group (order by f.first_kill_s)::numeric, 1) from firsts f join fv v using (session_id)
         where v.first_visit = fv.first_visit) as median_first_kill_s,
       (select round(percentile_cont(0.5) within group (order by f.first_death_s)::numeric, 1) from firsts f join fv v using (session_id)
         where v.first_visit = fv.first_visit) as median_first_death_s
  from fv join m using (session_id) group by fv.first_visit order by fv.first_visit desc;

-- ---------------------------------------------------------------- 4. quits right after a death streak
-- disconnects during a live match, by deaths since the player's last kill (disconnect.streak); 3+ is the "tilt" row
with p as (select now() - interval '7 days' as since),
d as (
  select e.session_id, coalesce((e.details->>'streak')::int, 0) as streak, e.details->>'state' as state
    from public.events e, p where e.created_at >= p.since and e.event = 'disconnect'),
fv as (
  select e.session_id, coalesce(bool_or((e.details->>'first')::boolean), false) as first_visit
    from public.events e, p where e.created_at >= p.since and e.event = 'session_start' group by e.session_id)
select coalesce(d.state, '(none)') as state, case when d.streak >= 5 then '5+' else d.streak::text end as deaths_since_last_kill,
       count(*) as quits, count(*) filter (where fv.first_visit) as first_visit_quits,
       round(100.0 * count(*) / sum(count(*)) over (partition by coalesce(d.state, '(none)')), 1) as pct_of_state
  from d left join fv using (session_id)
 group by 1, 2 order by 1, 2;

-- ---------------------------------------------------------------- 5. the other signals: idle kicks, menu opens, loadout changes, rematch stays
-- per session (sessions in the window), and what the last event before a disconnect was
with p as (select now() - interval '7 days' as since),
n as (select count(distinct e.session_id) as sessions from public.events e, p where e.created_at >= p.since)
select e.event, count(*) as events, count(distinct e.session_id) as sessions_with_it,
       round(100.0 * count(distinct e.session_id) / nullif(max(n.sessions), 0), 1) as pct_of_sessions
  from public.events e, p, n where e.created_at >= p.since
 group by e.event order by events desc;

with p as (select now() - interval '7 days' as since)
select coalesce(e.details->>'last', '(none)') as last_event_before_quit, coalesce(e.details->>'state', '(none)') as state, count(*) as quits
  from public.events e, p where e.created_at >= p.since and e.event = 'disconnect'
 group by 1, 2 order by quits desc;

-- ---------------------------------------------------------------- 6. per day (is it moving after a release?)
select date_trunc('day', e.created_at)::date as day, count(distinct e.session_id) as sessions,
       count(*) filter (where e.event = 'match_end') as matches_finished,
       round(percentile_cont(0.5) within group (order by (e.details->>'seconds')::numeric)
             filter (where e.event = 'disconnect')::numeric / 60, 2) as median_session_min
  from public.events e where e.created_at >= now() - interval '30 days'
 group by 1 order by 1;

-- ---------------------------------------------------------------- cleanup (a test session; and retention, optional)
-- delete from public.events where session_id = '<uuid>';
-- delete from public.events where created_at < now() - interval '90 days';
