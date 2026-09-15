import type { PagedLoadMessages } from "./report-rows";

function messages(what: string): PagedLoadMessages {
  return {
    failed: `טעינת ה${what} נכשלה. נסו שוב.`,
    changed: `ה${what} השתנו בזמן הטעינה. נסו שוב.`,
    unverified: `לא ניתן לאמת שכל ה${what} נטענו. נסו שוב.`,
    incomplete: `לא כל ה${what} נטענו. נסו שוב.`,
  };
}

/** Error wording of the shared document / expense / client stores. */
export const STORE_LOAD_MESSAGES = {
  documents: messages("מסמכים"),
  expenses: messages("הוצאות"),
  clients: messages("לקוחות"),
};

/** The first store error among several, for a page that reads more than one store. */
export function firstStoreError(...errors: (string | null | undefined)[]): string | null {
  return errors.find((e): e is string => Boolean(e)) ?? null;
}
