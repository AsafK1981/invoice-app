/**
 * The page index to actually show: `page` pulled back to the last page that
 * still has rows. Deleting the only row on the last page (or any change that
 * shrinks the list without touching the filters) used to leave the table on
 * a page past the end: no rows and, with one page left, no pager either.
 */
export function clampPage(page: number, itemCount: number, pageSize: number): number {
  const pageCount = Math.max(1, Math.ceil(itemCount / pageSize));
  return Math.min(Math.max(0, page), pageCount - 1);
}
