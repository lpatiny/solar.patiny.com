/**
 * Race a promise against a timeout. If `promise` does not settle within `ms`,
 * the returned promise rejects with an {@link Error} carrying `message`; the
 * timer is always cleared so it never keeps the event loop alive. The original
 * `promise` is NOT cancelled — it keeps running — so callers must tolerate its
 * eventual (now ignored) settlement.
 * @param promise - the work to bound
 * @param ms - timeout in milliseconds
 * @param message - error message used when the timeout fires
 * @returns the resolved value of `promise`, or a rejection on timeout
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
