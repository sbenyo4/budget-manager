const ilsFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

export function formatILS(amount: number): string {
  return ilsFormatter.format(amount);
}

export function formatHebrewDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
