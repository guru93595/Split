export function shareAmount(totalCents: number, memberCount: number, index: number): number {
  const base = Math.floor(totalCents / memberCount)
  const remainder = totalCents % memberCount
  return index < remainder ? base + 1 : base
}
