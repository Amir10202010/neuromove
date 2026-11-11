// Worker hook of the research-frontier workspaces. Kept apart from shared.tsx because the job code carries the
// whole engine: only the views that compute something heavy (strategy atlas, twin layers, sandbox) load it.
//
// The worker is a file of the site (`?worker`, not `?worker&inline`): the site's content policy allows scripts of
// its own origin only. Where no worker can be started (single-file demo opened from disk), the same job runs on
// the main thread — lib/workerJob.ts.

import { useEffect, useRef, useState } from 'react';
import type { FrontierRequest, FrontierResult } from '../../../lab/frontierJobs';
import FrontierWorker from '../../../lab/frontier.worker?worker';
import { startJob, type JobHandle } from '../../../lib/workerJob';

export type Job<T> = { state: 'idle' } | { state: 'running' } | { state: 'done'; result: T } | { state: 'error'; message: string };

/** Runs one kind of frontier job; a new request cancels the one in flight. */
export function useFrontierJob<K extends FrontierResult['kind']>(kind: K) {
  type R = Extract<FrontierResult, { kind: K }>;
  const [job, setJob] = useState<Job<R>>({ state: 'idle' });
  const handle = useRef<JobHandle | null>(null);
  useEffect(() => () => handle.current?.cancel(), []);
  const run = (req: FrontierRequest) => {
    handle.current?.cancel();
    setJob({ state: 'running' });
    handle.current = startJob<FrontierRequest, FrontierResult>({
      make: () => new FrontierWorker(),
      local: (r) => import('../../../lab/frontierJobs').then((m) => m.runFrontierJob(r)),
      req,
      done: (reply) => {
        if (!reply.ok) setJob({ state: 'error', message: reply.error });
        else if (reply.result.kind === kind) setJob({ state: 'done', result: reply.result as R });
        else setJob({ state: 'error', message: 'unexpected result' });
      },
    });
  };
  const reset = () => {
    handle.current?.cancel();
    setJob({ state: 'idle' });
  };
  return { job, run, reset };
}
