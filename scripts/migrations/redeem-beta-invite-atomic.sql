-- Atomic invite redemption. Replaces the previous "read count, then
-- increment, then insert" three-step dance with a single SQL function
-- that holds row locks for the duration. Removes the race window where
-- N concurrent redeemers could all pass the cap check before any of
-- them incremented the counter.

CREATE OR REPLACE FUNCTION public.redeem_beta_invite(
  p_code text,
  p_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_invite public.beta_invites%ROWTYPE;
  v_existing public.beta_invite_redemptions%ROWTYPE;
  v_expires_at timestamptz;
BEGIN
  -- First, give a clean error if the user already redeemed this code,
  -- without bumping the counter or causing a UNIQUE-violation rollback.
  SELECT b.* INTO v_existing
  FROM public.beta_invite_redemptions b
  JOIN public.beta_invites i ON i.id = b.invite_id
  WHERE i.code = p_code AND b.user_id = p_user_id;
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'already_redeemed',
      'already_expires_at', v_existing.expires_at
    );
  END IF;

  -- Atomic check-and-bump. Postgres locks the row during UPDATE, so
  -- two concurrent calls can't both pass the cap test.
  UPDATE public.beta_invites
  SET redemptions_count = redemptions_count + 1
  WHERE code = p_code
    AND active = true
    AND redemptions_count < max_redemptions
    AND (expires_at IS NULL OR expires_at > now())
  RETURNING * INTO v_invite;

  IF v_invite.id IS NULL THEN
    -- Fall through to figure out *why* — informative for the UI.
    SELECT * INTO v_invite FROM public.beta_invites WHERE code = p_code;
    IF v_invite.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    ELSIF NOT v_invite.active THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'inactive');
    ELSIF v_invite.expires_at IS NOT NULL AND v_invite.expires_at <= now() THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'expired');
    ELSE
      RETURN jsonb_build_object('ok', false, 'reason', 'exhausted');
    END IF;
  END IF;

  v_expires_at := now() + make_interval(days => v_invite.days_granted);

  -- Insert the redemption row. UNIQUE (invite_id, user_id) protects
  -- against a concurrent dupe from the *same* user that beat our pre-
  -- check above.
  BEGIN
    INSERT INTO public.beta_invite_redemptions (invite_id, user_id, expires_at)
    VALUES (v_invite.id, p_user_id, v_expires_at);
  EXCEPTION WHEN unique_violation THEN
    -- Roll back the counter bump — we charged a slot that wasn't used.
    UPDATE public.beta_invites
    SET redemptions_count = redemptions_count - 1
    WHERE id = v_invite.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'already_redeemed');
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'invite_id', v_invite.id,
    'plan_tier', v_invite.plan_tier,
    'invite_code', v_invite.code,
    'days_granted', v_invite.days_granted,
    'expires_at', v_expires_at
  );
END;
$$;

-- The function runs as the owning role, but we want the API route
-- (which uses the service_role key) to be able to call it. service_role
-- has implicit access to SECURITY DEFINER functions in the public schema.
