export function compareStrings(left: string, right: string): number {
  const a = Array.from(left, (c) => c.codePointAt(0) ?? 0);
  const b = Array.from(right, (c) => c.codePointAt(0) ?? 0);
  for (let i = 0; i < Math.min(a.length, b.length); i++)
    if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0);
  return a.length - b.length;
}
/** pathlib.Path ordering compares path components; Windows additionally folds case. */
export function comparePaths(left: string, right: string): number {
  const fold = (s: string) =>
    process.platform === "win32" ? s.toLowerCase() : s;
  const a = left.split("/").map(fold);
  const b = right.split("/").map(fold);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const n = compareStrings(a[i] ?? "", b[i] ?? "");
    if (n) return n;
  }
  return a.length - b.length;
}
