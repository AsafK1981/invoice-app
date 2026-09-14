import { normalizeBusinessNumber } from "../israeli-id";
import { israelClock } from "./encode";

/**
 * `OPENFRMT/<dealer number without its check digit>.<YY>/<MMDDhhmm>`, section 2.2.
 * The dealer number is the padded 9-digit form the file carries, so an 8-digit
 * עוסק gets its leading zero here too. Lives outside the route file because a
 * Next.js route file may export only its handlers.
 */
export function uniformFolderPath(taxId: string, at: Date): string {
  const dealer = (normalizeBusinessNumber(taxId).value ?? taxId.replace(/\D/g, "").slice(-9).padStart(9, "0")).slice(0, 8);
  // Israeli date and clock, whatever timezone the server runs in.
  const { date, hh, mm } = israelClock(at);
  const yy = date.slice(2, 4);
  const stamp = `${date.slice(5, 7)}${date.slice(8, 10)}${hh}${mm}`;
  return `OPENFRMT/${dealer}.${yy}/${stamp}`;
}
