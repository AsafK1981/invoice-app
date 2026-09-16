-- One business row per user, enforced by the database.
--
-- Context: Sentry INVOICE-APP-J (2026-09-15, /onboarding, Chrome iOS).
-- src/lib/business-init.ts decided "this user has no business yet" from a
-- SELECT that had come back empty, and then inserted one. Under row-level
-- security an empty result is not evidence: a request that loses its access
-- token is sent with the anon key, and RLS answers it with zero rows and NO
-- error. So the app could try to create a SECOND business for a user who
-- already had one. It was only the INSERT policy (user_id = auth.uid())
-- rejecting the same anon request that stopped a duplicate from being
-- written - the app was saved by the error it reported, not by its own logic.
--
-- The client-side fix lands in the same change, but the invariant belongs
-- here too: "one business per user" is assumed all over the codebase, and
-- two of the places that assume it break loudly if it is ever violated -
-- /api/danger/delete-all and /api/assistant both use .maybeSingle() on
-- user_id, which ERRORS on a second row. This index turns a silent
-- duplicate into an impossible one, and turns a racing second insert into
-- 23505, which business-init now recovers from by reading the winner back.
--
-- Verified 0 duplicate user_ids immediately before applying (21 rows).
--
-- Plain CREATE UNIQUE INDEX, deliberately not CONCURRENTLY: migrations here
-- go through the Supabase Management API, which runs the statement inside a
-- transaction block, and CONCURRENTLY errors with 25001 there. On a table
-- this size the plain form takes milliseconds and is atomic - CONCURRENTLY
-- would only add the risk of leaving an INVALID index behind.

CREATE UNIQUE INDEX IF NOT EXISTS businesses_user_id_key
  ON public.businesses (user_id);
