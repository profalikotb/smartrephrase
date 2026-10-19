/**
 * Wraps an async iterable with three independent clocks. When any clock fires it
 * (1) aborts the shared AbortController — which tears down the real network request —
 * and (2) rejects the pending read so we never wait on a misbehaving source.
 * Every timer is cleared on every exit path, and the source iterator is closed.
 */
export type GuardKind = "first_content" | "inactivity" | "overall";

export class GuardTimeout extends Error {
  constructor(public readonly kind: GuardKind) {
    super(`timeout:${kind}`);
    this.name = "GuardTimeout";
  }
}

export interface GuardOptions<T> {
  controller: AbortController;
  firstContentMs: number;
  inactivityMs: number;
  /** Absolute epoch ms. The overall deadline always wins over the per-phase clocks. */
  deadlineAt: number;
  hasContent: (item: T) => boolean;
  now?: () => number;
}

export async function* guardStream<T>(source: AsyncIterable<T>, o: GuardOptions<T>): AsyncGenerator<T> {
  const now = o.now ?? Date.now;
  const it = source[Symbol.asyncIterator]();
  let seenContent = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fail: ((e: Error) => void) | undefined;
  let fired: GuardTimeout | undefined;

  const arm = () => {
    if (timer) clearTimeout(timer);
    const remaining = o.deadlineAt - now();
    const phase = seenContent ? o.inactivityMs : o.firstContentMs;
    const kind: GuardKind = remaining <= phase ? "overall" : seenContent ? "inactivity" : "first_content";
    const ms = Math.max(0, Math.min(remaining, phase));
    timer = setTimeout(() => {
      fired = new GuardTimeout(kind);
      o.controller.abort(fired);
      fail?.(fired);
    }, ms);
  };

  const onAbort = () => fail?.(o.controller.signal.reason instanceof Error ? o.controller.signal.reason : new DOMException("Aborted", "AbortError"));
  o.controller.signal.addEventListener("abort", onAbort);

  try {
    arm();
    while (true) {
      if (fired) throw fired;
      if (o.controller.signal.aborted) throw o.controller.signal.reason ?? new DOMException("Aborted", "AbortError");
      const res = await new Promise<IteratorResult<T>>((resolve, reject) => {
        fail = reject;
        it.next().then(resolve, reject);
      });
      fail = undefined;
      if (res.done) return;
      if (o.hasContent(res.value)) {
        seenContent = true;
        arm();
      }
      yield res.value;
    }
  } catch (e) {
    throw fired ?? e;
  } finally {
    if (timer) clearTimeout(timer);
    fail = undefined;
    o.controller.signal.removeEventListener("abort", onAbort);
    // Best effort: close the source (releases stream readers); never await a hung source.
    try {
      void it.return?.()?.catch(() => undefined);
    } catch {
      /* ignore */
    }
  }
}
