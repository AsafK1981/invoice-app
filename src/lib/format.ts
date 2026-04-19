export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(date: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(date));
}

export function formatMonth(date: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    year: "numeric",
    month: "long",
  }).format(new Date(date));
}
