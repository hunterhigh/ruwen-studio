export const slowLoadMs = 10_000;

export function observeSlowLoad<T>(
  clock: {
    setTimeout(callback: () => void, delay: number): T;
    clearTimeout(timer: T): void;
  },
  showNotice: () => void,
): () => void {
  const timeout = clock.setTimeout(showNotice, slowLoadMs);
  return () => clock.clearTimeout(timeout);
}
