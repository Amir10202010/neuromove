// Runs the research-frontier jobs (lab/frontierJobs.ts) off the main thread. Replies with the result or an error.

import { runFrontierJob, type FrontierRequest } from './frontierJobs';

self.onmessage = (e: MessageEvent<FrontierRequest>) => {
  try {
    (self as unknown as Worker).postMessage({ ok: true, result: runFrontierJob(e.data) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
