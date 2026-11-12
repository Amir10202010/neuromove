// A job runs in the worker when one can be started, on the main thread when it cannot, and never reports twice.
import { describe, expect, it } from 'vitest';
import { startJob, type JobReply } from './workerJob';

/** A stand-in for a Web Worker: the test decides what it does with a request. */
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message?: string; preventDefault?: () => void }) => void) | null = null;
  terminated = false;
  posted: unknown[] = [];
  postMessage(req: unknown) {
    this.posted.push(req);
  }
  terminate() {
    this.terminated = true;
  }
}
const asWorker = (w: FakeWorker) => w as unknown as Worker;
const tick = () => new Promise((r) => setTimeout(r, 0));
const direct = (fn: () => void) => fn();

describe('startJob', () => {
  it('uses the answer of the worker and stops it', async () => {
    const w = new FakeWorker();
    const got: [JobReply<number>, string][] = [];
    let localCalls = 0;
    startJob<number, number>({ make: () => asWorker(w), local: () => (localCalls++, -1), req: 20, done: (r, where) => got.push([r, where]), defer: direct });
    expect(w.posted).toEqual([20]);
    w.onmessage!({ data: { ok: true, result: 41 } });
    await tick();
    expect(got).toEqual([[{ ok: true, result: 41 }, 'worker']]);
    expect(w.terminated).toBe(true);
    expect(localCalls).toBe(0);
    // a late duplicate is ignored
    w.onmessage?.({ data: { ok: true, result: 99 } });
    expect(got).toHaveLength(1);
  });

  it('a job that fails inside the worker is reported as failed — it is not run again on the main thread', async () => {
    const w = new FakeWorker();
    const got: JobReply<number>[] = [];
    let localCalls = 0;
    startJob<number, number>({ make: () => asWorker(w), local: () => (localCalls++, 1), req: 1, done: (r) => got.push(r), defer: direct });
    w.onmessage!({ data: { ok: false, error: 'singular matrix' } });
    await tick();
    expect(got).toEqual([{ ok: false, error: 'singular matrix' }]);
    expect(localCalls).toBe(0);
  });

  it('runs the same job on the main thread when the worker cannot start (blocked by the content policy, file://)', async () => {
    const w = new FakeWorker();
    const got: [JobReply<number>, string][] = [];
    startJob<number, number>({ make: () => asWorker(w), local: (x) => x * 2, req: 21, done: (r, where) => got.push([r, where]), defer: direct });
    let prevented = false;
    w.onerror!({ message: '', preventDefault: () => (prevented = true) });
    await tick();
    expect(got).toEqual([[{ ok: true, result: 42 }, 'main_thread']]);
    expect(prevented).toBe(true);
    expect(w.terminated).toBe(true);
  });

  it('runs on the main thread when the worker constructor throws, and reports an error of the job itself', async () => {
    const got: [JobReply<number>, string][] = [];
    startJob<number, number>({
      make: () => {
        throw new Error('SecurityError');
      },
      local: async (x) => x + 1,
      req: 1,
      done: (r, where) => got.push([r, where]),
      defer: direct,
    });
    await tick();
    expect(got).toEqual([[{ ok: true, result: 2 }, 'main_thread']]);
    const failed: JobReply<number>[] = [];
    startJob<number, number>({
      make: () => {
        throw new Error('SecurityError');
      },
      local: () => {
        throw new Error('no repetitions');
      },
      req: 1,
      done: (r) => failed.push(r),
      defer: direct,
    });
    await tick();
    expect(failed).toEqual([{ ok: false, error: 'no repetitions' }]);
  });

  it('a cancelled job reports nothing, from the worker or from the main thread', async () => {
    const w = new FakeWorker();
    const got: unknown[] = [];
    const h = startJob<number, number>({ make: () => asWorker(w), local: (x) => x, req: 1, done: (r) => got.push(r), defer: direct });
    h.cancel();
    expect(w.terminated).toBe(true);
    w.onmessage?.({ data: { ok: true, result: 1 } });
    w.onerror?.({});
    await tick();
    expect(got).toEqual([]);
    // cancelled while the main-thread run was still pending
    const pending: (() => void)[] = [];
    const h2 = startJob<number, number>({
      make: () => {
        throw new Error('blocked');
      },
      local: (x) => x,
      req: 1,
      done: (r) => got.push(r),
      defer: (fn) => pending.push(fn),
    });
    h2.cancel();
    pending.forEach((fn) => fn());
    await tick();
    expect(got).toEqual([]);
  });
});
