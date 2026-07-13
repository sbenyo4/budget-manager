const ilsFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const wholeIlsFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

export function formatILS(amount: number): string {
  return ilsFormatter.format(amount);
}

export function formatILSWhole(amount: number): string {
  return wholeIlsFormatter.format(amount);
}

export function formatHebrewDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isTodayIso(iso: string): boolean {
  return iso === todayIso();
}
