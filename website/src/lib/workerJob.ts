// Run one request in a Web Worker — and on the main thread when a worker cannot be started.
//
// Why a fallback is needed at all: the site's Content-Security-Policy (vite.config.ts) allows scripts from the
// site's own origin only. A worker therefore has to be a FILE of the site (`?worker`), never a blob: or data: URL
// (`?worker&inline` is blocked: "Creating a worker from 'blob:…' violates … script-src 'self'" — found on
// 11 Nov 2026, when the coordination analysis turned out never to finish in the built site). And the single-file
// demo (file://, hash-based policy) cannot load a worker file at all. In those cases the same job function runs on
// the main thread: the page does not respond for the seconds it takes, but the code and the result are the same.
//
// Contract of the worker script: it answers every request with { ok: true, result } or { ok: false, error } and
// never throws. An `error` EVENT on the worker therefore means "could not be loaded or started", not "the job
// failed" — and only that triggers the fallback.

export type JobReply<Res> = { ok: true; result: Res } | { ok: false; error: string };

export interface JobHandle {
  /** Stop the worker and ignore any result that is still on its way. */
  cancel(): void;
}

export interface JobOptions<Req, Res> {
  /** Creates the worker; may throw (then the job runs on the main thread). */
  make: () => Worker;
  /** The same job on the main thread. */
  local: (req: Req) => Res | Promise<Res>;
  req: Req;
  done: (reply: JobReply<Res>, ranIn: 'worker' | 'main_thread') => void;
  /** How the main-thread run is deferred so that the "computing" state can paint first (tests pass a direct call). */
  defer?: (fn: () => void) => void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function startJob<Req, Res>(o: JobOptions<Req, Res>): JobHandle {
  let cancelled = false;
  let settled = false;
  let worker: Worker | null = null;
  const stop = () => {
    worker?.terminate();
    worker = null;
  };
  const finish = (reply: JobReply<Res>, ranIn: 'worker' | 'main_thread') => {
    if (cancelled || settled) return;
    settled = true;
    stop();
    o.done(reply, ranIn);
  };
  const runLocal = () => {
    stop();
    (o.defer ?? ((fn) => setTimeout(fn, 50)))(() => {
      if (cancelled || settled) return;
      Promise.resolve()
        .then(() => o.local(o.req))
        .then(
          (result) => finish({ ok: true, result }, 'main_thread'),
          (e: unknown) => finish({ ok: false, error: message(e) }, 'main_thread'),
        );
    });
  };
  try {
    worker = o.make();
    worker.onmessage = (e: MessageEvent<JobReply<Res>>) => finish(e.data, 'worker');
    worker.onerror = (e) => {
      // do not let the browser report it again as an uncaught error: it is handled here
      e.preventDefault?.();
      if (!settled && !cancelled) runLocal();
    };
    worker.postMessage(o.req);
  } catch {
    runLocal();
  }
  return {
    cancel() {
      cancelled = true;
      stop();
    },
  };
}
