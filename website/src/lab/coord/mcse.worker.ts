// Runs the coordination engine off the main thread (the analysis takes seconds for dozens of repetitions).
// Messages: { kind: 'analyse', inputs, options } or { kind: 'synthetic', seed }. Replies with the result or an error
// and never throws (the contract lib/workerJob.ts relies on).

import { runMcseJob, type McseRequest } from './mcseJob';

self.onmessage = (e: MessageEvent<McseRequest>) => {
  try {
    (self as unknown as Worker).postMessage({ ok: true, result: runMcseJob(e.data) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
