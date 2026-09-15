-- =============================================================
-- 2026-demo-community-membership.sql
--
-- Seed one idempotent learner community for the two existing demo
-- JSS 1 accounts. This belongs in the schema deploy group (rather
-- than the optional demo bundle) so a deployment that has these
-- accounts can exercise the live Communities API immediately.
--
-- Safe in non-demo environments: it is a no-op when either account
-- is absent. It deliberately leaves an existing member role intact
-- while repairing the creator's owner membership.
-- =============================================================

DO $$
DECLARE
  owner_user_id  uuid;
  member_user_id uuid;
  seeded_community_id uuid;
BEGIN
  SELECT id INTO owner_user_id
  FROM public.users
  WHERE lower(email) = 'stu.jss11@demo.akoro.app'
  LIMIT 1;

  SELECT id INTO member_user_id
  FROM public.users
  WHERE lower(email) = 'stu.jss12@demo.akoro.app'
  LIMIT 1;

  IF owner_user_id IS NULL OR member_user_id IS NULL THEN
    RAISE NOTICE 'Community demo seed skipped: stu.jss11 or stu.jss12 is not present.';
    RETURN;
  END IF;

  -- Owner + name make this seed repeatable without imposing a global name
  -- uniqueness constraint on learner-created communities.
  SELECT id INTO seeded_community_id
  FROM edu.communities
  WHERE owner_id = owner_user_id
    AND name = 'JSS 1 Study Circle'
  ORDER BY created_at ASC
  LIMIT 1;

  IF seeded_community_id IS NULL THEN
    INSERT INTO edu.communities (name, description, emoji, owner_id, is_public)
    VALUES (
      'JSS 1 Study Circle',
      'A demo study group for sharing revision activities and supporting one another.',
      '📚',
      owner_user_id,
      true
    )
    RETURNING id INTO seeded_community_id;
  END IF;

  -- The creator is always the community owner, even if an earlier partial seed
  -- wrote an incorrect membership role.
  INSERT INTO edu.community_members (community_id, user_id, role)
  VALUES (seeded_community_id, owner_user_id, 'owner')
  ON CONFLICT (community_id, user_id) DO UPDATE SET role = EXCLUDED.role;

  -- Do not overwrite a pre-existing role for the joined learner; membership is
  -- sufficient and the normal app/API can manage it afterward.
  IF member_user_id <> owner_user_id THEN
    INSERT INTO edu.community_members (community_id, user_id, role)
    VALUES (seeded_community_id, member_user_id, 'member')
    ON CONFLICT (community_id, user_id) DO NOTHING;
  END IF;

  RAISE NOTICE 'Seeded community % for demo learners.', seeded_community_id;
END $$;

NOTIFY pgrst, 'reload schema';
