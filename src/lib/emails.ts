const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseEmails(input: string | undefined | null): string[] {
  if (!input) return [];
  return input
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

export function joinEmails(emails: string[]): string {
  return emails.filter(Boolean).map((e) => e.trim()).join(", ");
}
