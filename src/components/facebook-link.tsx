import { FACEBOOK_PAGE_URL } from "@/lib/social";

/**
 * Small Facebook icon link for the marketing footers. Inline SVG (no icon
 * dependency), painted with currentColor so it inherits the footer link
 * colour and its orange hover.
 */
export function FacebookLink({ className }: { className?: string }) {
  return (
    <a
      href={FACEBOOK_PAGE_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="חשבונית ידידותית בפייסבוק"
      className={className}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.23 2.68.23v2.97h-1.51c-1.49 0-1.95.93-1.95 1.88v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z" />
      </svg>
    </a>
  );
}
