export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function mostCommon<T>(values: T[], key: (v: T) => string = String): T | undefined {
  const counts = new Map<string, { value: T; count: number }>();
  for (const v of values) {
    const k = key(v);
    const entry = counts.get(k);
    if (entry) entry.count++;
    else counts.set(k, { value: v, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.value;
}
