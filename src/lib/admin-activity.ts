import type { DocumentType } from "./types";

/**
 * Operator activity feed: WHO did WHAT kind of thing, WHEN. Nothing else.
 *
 * The /admin dashboard shows signups and counts, which says nothing about
 * what the platform is being used for right now. This feed answers that
 * question from the source tables' own timestamps instead of `audit_log`,
 * on purpose: audit_log rows carry `target_label` and a payload with the
 * client name and the amount (that is what the owner's own history page
 * needs), and an operator feed must never select those columns. Here the
 * privacy boundary is the input types below: a document contributes its
 * type, status and three timestamps, an expense or a client contributes only
 * its timestamp, and the actor is the account email plus the business name
 * the owner chose for themselves. No number, no subject, no client, no total.
 *
 * Pure: takes already-fetched rows, returns a sorted, capped list. The route
 * under /api/admin/activity does the fetching; tests cover this file.
 */

export type AdminActivityKind =
  | "document.created"
  | "document.emailed"
  | "document.paid"
  | "expense.created"
  | "client.created"
  | "user.signed_in";

export interface AdminActivityEvent {
  /** Stable key: `${kind}:${source row id}`. */
  id: string;
  /** ISO timestamp. */
  at: string;
  kind: AdminActivityKind;
  /** Account email (null when the business has no matching auth user). */
  email: string | null;
  /** The owner's own business name, or null if they have not set one. */
  businessName: string | null;
  /** Only for document.* events. */
  documentType?: DocumentType;
  /** Only for document.created: the document was saved as a draft. */
  draft?: boolean;
}

export interface ActivityDocumentRow {
  id: string;
  business_id: string;
  type: string;
  status: string;
  created_at: string;
  emailed_at?: string | null;
  paid_at?: string | null;
}

export interface ActivityTimestampRow {
  id: string;
  business_id: string;
  created_at: string;
}

export interface ActivityBusinessRow {
  id: string;
  user_id: string;
  name?: string | null;
}

export interface ActivityUserRow {
  id: string;
  email?: string | null;
  last_sign_in_at?: string | null;
}

export interface BuildAdminActivityInput {
  documents: ActivityDocumentRow[];
  expenses: ActivityTimestampRow[];
  clients: ActivityTimestampRow[];
  businesses: ActivityBusinessRow[];
  users: ActivityUserRow[];
  /** Max events returned after merging. */
  limit?: number;
}

/**
 * A receipt is created already paid, so its paid_at lands within the same
 * second as created_at. That is one action, not two; a "marked paid" event
 * is only interesting when it happened later.
 */
const SAME_ACTION_WINDOW_MS = 60 * 1000;

export function buildAdminActivity(input: BuildAdminActivityInput): AdminActivityEvent[] {
  const limit = input.limit ?? 50;

  const userById = new Map<string, ActivityUserRow>();
  for (const u of input.users) userById.set(u.id, u);

  const actorByBusiness = new Map<string, { email: string | null; businessName: string | null }>();
  for (const b of input.businesses) {
    const user = userById.get(b.user_id);
    actorByBusiness.set(b.id, {
      email: user?.email ?? null,
      businessName: b.name?.trim() ? b.name.trim() : null,
    });
  }
  // A user who signed up but has not finished onboarding has no business row
  // yet; their sign-in still counts as activity, and their name is the email.
  const actorByUser = new Map<string, { email: string | null; businessName: string | null }>();
  for (const b of input.businesses) {
    if (!actorByUser.has(b.user_id)) actorByUser.set(b.user_id, actorByBusiness.get(b.id)!);
  }

  const unknownActor = { email: null, businessName: null };
  const actorFor = (businessId: string) => actorByBusiness.get(businessId) ?? unknownActor;

  const events: AdminActivityEvent[] = [];
  const seen = new Set<string>();
  const push = (e: AdminActivityEvent) => {
    if (!e.at || Number.isNaN(new Date(e.at).getTime())) return;
    // The route fetches documents three times (by created_at, emailed_at,
    // paid_at), so the same row can arrive more than once.
    if (seen.has(e.id)) return;
    seen.add(e.id);
    events.push(e);
  };

  for (const d of input.documents) {
    const actor = actorFor(d.business_id);
    const documentType = d.type as DocumentType;
    push({
      id: `document.created:${d.id}`,
      at: d.created_at,
      kind: "document.created",
      ...actor,
      documentType,
      draft: d.status === "draft",
    });
    if (d.emailed_at) {
      push({
        id: `document.emailed:${d.id}`,
        at: d.emailed_at,
        kind: "document.emailed",
        ...actor,
        documentType,
      });
    }
    if (d.paid_at) {
      const gap = new Date(d.paid_at).getTime() - new Date(d.created_at).getTime();
      if (Math.abs(gap) > SAME_ACTION_WINDOW_MS) {
        push({
          id: `document.paid:${d.id}`,
          at: d.paid_at,
          kind: "document.paid",
          ...actor,
          documentType,
        });
      }
    }
  }

  for (const x of input.expenses) {
    push({
      id: `expense.created:${x.id}`,
      at: x.created_at,
      kind: "expense.created",
      ...actorFor(x.business_id),
    });
  }

  for (const c of input.clients) {
    push({
      id: `client.created:${c.id}`,
      at: c.created_at,
      kind: "client.created",
      ...actorFor(c.business_id),
    });
  }

  for (const u of input.users) {
    if (!u.last_sign_in_at) continue;
    const actor = actorByUser.get(u.id) ?? { email: u.email ?? null, businessName: null };
    push({
      id: `user.signed_in:${u.id}`,
      at: u.last_sign_in_at,
      kind: "user.signed_in",
      email: actor.email ?? u.email ?? null,
      businessName: actor.businessName,
    });
  }

  // Numeric, not string, order: auth rows end in "Z" while table rows end in
  // "+00:00", and a lexical sort would interleave them wrongly.
  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return events.slice(0, limit);
}

/**
 * Hebrew, gender-neutral phrasing (noun phrases, not verbs) so the feed reads
 * the same for every account holder.
 */
export function describeAdminActivity(
  e: AdminActivityEvent,
  typeLabels: Record<string, string>,
): string {
  const type = e.documentType ? typeLabels[e.documentType] || e.documentType : "מסמך";
  switch (e.kind) {
    case "document.created":
      return e.draft ? `טיוטה חדשה: ${type}` : `מסמך חדש: ${type}`;
    case "document.emailed":
      return `נשלח במייל: ${type}`;
    case "document.paid":
      return `סומן כשולם: ${type}`;
    case "expense.created":
      return "הוצאה חדשה";
    case "client.created":
      return "לקוח חדש";
    case "user.signed_in":
      return "התחברות";
  }
}
