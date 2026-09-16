/**
 * The /reminders email-reminder form: what the owner is editing, and whether
 * it differs from what is saved. The שמירה button is enabled only when it does.
 */

export interface DunningSettingsDraft {
  enabled: boolean;
  fromName: string;
  /** Friendly email before the due date. Kept while `enabled` is off, so
   *  turning the email reminders back on restores the owner's choice. */
  preDue: boolean;
}

/** The saved values as the form shows them (absent settings read as off / empty). */
export function dunningDraftFromBusiness(business: {
  dunningEnabled?: boolean;
  dunningFromName?: string;
  dunningPreDueEnabled?: boolean;
}): DunningSettingsDraft {
  return {
    enabled: business.dunningEnabled ?? false,
    fromName: business.dunningFromName ?? "",
    preDue: business.dunningPreDueEnabled === true,
  };
}

export function isDunningDraftDirty(draft: DunningSettingsDraft, saved: DunningSettingsDraft): boolean {
  return (
    draft.enabled !== saved.enabled ||
    draft.fromName !== saved.fromName ||
    draft.preDue !== saved.preDue
  );
}

/** Whether the שמירה button may be pressed. */
export function canSaveDunningDraft(input: {
  draft: DunningSettingsDraft;
  saved: DunningSettingsDraft;
  saving: boolean;
}): boolean {
  return !input.saving && isDunningDraftDirty(input.draft, input.saved);
}
