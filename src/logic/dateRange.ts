/** Last day of the month that closes the rolling future-data window. */
export function futureDataEndIso(now = new Date(), monthsAhead = 18): string {
  const end = new Date(now.getFullYear(), now.getMonth() + monthsAhead + 1, 0);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
}
