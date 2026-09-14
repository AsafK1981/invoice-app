import { normalizeBusinessNumber } from "../israeli-id";

/**
 * `OPENFRMT/<dealer number without its check digit>.<YY>/<MMDDhhmm>`, section 2.2.
 * The dealer number is the padded 9-digit form the file carries, so an 8-digit
 * עוסק gets its leading zero here too. Lives outside the route file because a
 * Next.js route file may export only its handlers.
 */
export function uniformFolderPath(taxId: string, at: Date): string {
  const dealer = (normalizeBusinessNumber(taxId).value ?? taxId.replace(/\D/g, "").slice(-9).padStart(9, "0")).slice(0, 8);
  const pad = (n: number) => String(n).padStart(2, "0");
  const yy = String(at.getFullYear()).slice(-2);
  const stamp = `${pad(at.getMonth() + 1)}${pad(at.getDate())}${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `OPENFRMT/${dealer}.${yy}/${stamp}`;
}
