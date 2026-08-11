/**
 * Feature-tone palette (Option 1, approved 2026-08-11).
 *
 * The union below is the single compile-time authority for which tone
 * suffixes exist: every `tone` prop/field (sidebar nav items, dashboard
 * stat cards, EmptyState) must be typed as `FeatureTone`, so a typo like
 * "teel" fails the build instead of silently rendering an untinted tile.
 * The matching CSS lives in app-skin.css (`.ftile-*` light tiles,
 * `.fgrad-*` filled page-head gradients).
 *
 * Canonical feature → tone mapping (keep page headers, sidebar items and
 * empty states of the same feature on the same tone):
 *   dashboard=amber, documents=indigo, clients=teal, products=violet,
 *   expenses=pink, recurring=sky, notifications=orange, reports=emerald,
 *   settings=slate, admin=rose. חשבונית ישראל stays gold (the flagship
 *   treatment, like the homepage allocation card - it takes no tone).
 */
export type FeatureTone =
  | "amber"
  | "indigo"
  | "teal"
  | "violet"
  | "pink"
  | "sky"
  | "orange"
  | "emerald"
  | "slate"
  | "rose";
