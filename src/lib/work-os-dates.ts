export function todayIso(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function addDaysIso(value: string, amount: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
