/** Arbeitet eine Liste mit begrenzter Parallelität ab und behält die Reihenfolge. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const concurrency = Math.max(1, Math.min(limit, items.length))
  const results = new Array<R>(items.length)
  let next = 0

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < items.length) {
        const index = next
        next += 1
        results[index] = await fn(items[index]!, index)
      }
    }),
  )

  return results
}
