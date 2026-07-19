export function isRepeatedExpenseGroup(count: number, periodCount: number): boolean {
  return count >= 2 || periodCount >= 2;
}
