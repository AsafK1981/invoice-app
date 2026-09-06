// Shared wa.me link building. One source of truth for turning a phone
// number the owner typed into a client card ("054-900-0684", "+972 54 900
// 0684", "0549000684") into the digits wa.me expects, and for building the
// prefilled-message URL.
//
// Nothing here sends anything: a wa.me link only OPENS WhatsApp on the
// owner's device with a message ready to send. The owner presses send.

/**
 * Normalise a stored phone number to the digits wa.me wants
 * (country code + subscriber number, no `+`, no separators).
 *
 * - strips spaces, dashes, dots, parentheses and a leading `+`
 * - `00` international prefix -> dropped
 * - Israeli local form `05x...` -> `9725x...`
 * - already-international `972...` is kept (and a stray `9720...` is fixed)
 * - anything shorter than 9 digits is not a dialable number -> `""`, which
 *   callers treat as "no phone" (the link then opens WhatsApp's contact
 *   picker instead of a wrong chat)
 */
export function waDigits(phone: string | null | undefined): string {
  let digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 9) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("972")) {
    const rest = digits.slice(3).replace(/^0+/, "");
    return rest ? `972${rest}` : "";
  }
  if (digits.startsWith("0")) return `972${digits.slice(1)}`;
  return digits;
}

/**
 * `https://wa.me/<digits>?text=<encoded>`, or the picker form
 * (`https://wa.me/?text=...`) when there is no usable number, so the owner
 * can still choose a recipient by hand instead of hitting a dead button.
 */
export function whatsappLink(phone: string | null | undefined, text: string): string {
  const digits = waDigits(phone);
  const query = `?text=${encodeURIComponent(text)}`;
  return digits ? `https://wa.me/${digits}${query}` : `https://wa.me/${query}`;
}
