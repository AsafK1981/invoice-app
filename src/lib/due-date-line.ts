/**
 * Whether a sheet prints its "לתשלום עד" line.
 *
 * Two different questions hide behind that, and mixing them would let a
 * design change rewrite documents a customer already holds:
 *
 * - A STORED document (a documents row: the in-app view, /view, print, the
 *   PDF) answers from its own `due_date_hidden`, which the database stamped
 *   once at insert from the design in force then and froze after issue. A
 *   reprint is an "העתק" and must match the original, so the business's
 *   CURRENT design is never consulted here.
 * - A PREVIEW of a document not issued yet (the editor, the design page, the
 *   dev gallery) follows the business's current design, because that is the
 *   value the database will stamp when it is issued.
 *
 * Either way a type that may not state a due date, or an empty date, prints
 * nothing.
 */

import { printsDueDate } from "./document-themes";
import { allowsDueDate, type DocumentType } from "./types";

export type DueDateLineSource =
  | { from: "document"; hidden: boolean }
  | { from: "business-design"; design: unknown };

export function printsDueDateLine(input: {
  documentType: DocumentType;
  dueDate: string | undefined;
  source: DueDateLineSource;
}): boolean {
  const { documentType, dueDate, source } = input;
  if (!dueDate || !allowsDueDate(documentType)) return false;
  return source.from === "document" ? !source.hidden : printsDueDate(source.design);
}
