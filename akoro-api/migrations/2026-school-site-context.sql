-- One round trip for a public school site render (corrected).: notices and school events live in the
-- mgmt schema (see modules/school/store-site.js), not public.
--
-- Rendering a tenant page used to make ~10 separate PostgREST calls (website,
-- portal settings, profile, teachers, courses, classes, admission, gateway,
-- notices, events, menus and pages). On a remote Postgres that is seconds of
-- serialised latency. This function returns the whole context as one JSON
-- document; the renderer keeps the per-query path as a fallback.
create or replace function public.school_site_context(p_school_id uuid, p_today date default current_date)
returns jsonb
language sql
stable
as $function$
  select jsonb_build_object(
    'website', (select to_jsonb(w) from edu.school_website w where w.school_id = p_school_id),
    'portal', (select to_jsonb(s) from edu.school_portal_settings s where s.school_id = p_school_id),
    'profile', (select to_jsonb(p) from public.school_profiles p where p.id = p_school_id),
    'contact_email', (
      select u.email from public.school_profiles p
      join public.users u on u.id = p.admin_user_id
      where p.id = p_school_id
    ),
    'teachers', coalesce((
      select jsonb_agg(jsonb_build_object('name', u.full_name) order by u.full_name)
      from public.school_teachers t join public.users u on u.id = t.teacher_id
      where t.school_id = p_school_id and u.full_name is not null
    ), '[]'::jsonb),
    'courses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', x.title, 'subject', x.subject, 'level', x.level,
        'price', x.price, 'is_free', x.is_free
      ) order by x.title)
      from (
        select c.title, c.subject, c.level, c.price, c.is_free
        from public.courses c
        where c.is_published = true
          and c.instructor_id in (select t.teacher_id from public.school_teachers t where t.school_id = p_school_id)
        order by c.title limit 24
      ) x
    ), '[]'::jsonb),
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object('name', c.name) order by c.name)
      from public.classrooms c where c.school_id = p_school_id
    ), '[]'::jsonb),
    'admission', jsonb_build_object(
      'enabled', coalesce((select a.enabled from edu.school_admission_settings a where a.school_id = p_school_id), false)
    ),
    'gateway_ok', coalesce((
      select g.enabled = true and (
        case lower(coalesce(g.mode, 'sandbox'))
          when 'live' then coalesce(g.live_key_secret, '') <> ''
          else coalesce(g.sandbox_key_secret, '') <> ''
        end
      )
      from edu.school_payment_gateway g where g.school_id = p_school_id
    ), false),
    'notices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', x.title, 'body', coalesce(x.body, ''), 'publish_on', x.publish_on, 'pinned', coalesce(x.pinned, false)
      ) order by coalesce(x.pinned, false) desc, x.publish_on desc)
      from (
        select n.title, n.body, n.publish_on, n.pinned
        from mgmt.notices n
        where n.school_id = p_school_id
          and (n.expires_on is null or n.expires_on >= p_today)
          and (n.publish_on is null or n.publish_on <= p_today)
        order by coalesce(n.pinned, false) desc, n.publish_on desc limit 6
      ) x
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', x.title, 'description', coalesce(x.description, ''),
        'event_type', x.event_type, 'starts_on', x.starts_on
      ) order by x.starts_on)
      from (
        select e.title, e.description, e.event_type, e.starts_on
        from mgmt.school_events e
        where e.school_id = p_school_id and e.starts_on >= p_today
        order by e.starts_on limit 6
      ) x
    ), '[]'::jsonb),
    'menus', coalesce((
      select jsonb_object_agg(x.location, x.items)
      from (
        select m.location,
          (select coalesce(jsonb_agg(jsonb_build_object(
              'label', i.label,
              'href', case
                when i.page_id is null then coalesce(nullif(i.url, ''), '#')
                when p.status = 'published' and p.deleted_at is null and p.slug is not null then '/' || p.slug
                else '#'
              end,
              'target', i.target
            ) order by i.sort_order), '[]'::jsonb)
           from mgmt.site_menu_items i
           left join mgmt.site_pages p on p.id = i.page_id
           where i.menu_id = m.id) as items
        from mgmt.site_menus m
        where m.school_id = p_school_id and m.location is not null
      ) x
    ), '{}'::jsonb)
  );
$function$;

grant execute on function public.school_site_context(uuid, date) to service_role;

comment on function public.school_site_context(uuid, date) is
  'All data a public school website render needs (website, settings, profile, teachers, courses, classes, admission, gateway, notices, events, menus) in one JSON document.';
