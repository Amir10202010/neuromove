// The coordination-engine job, as one function: run by mcse.worker.ts off the main thread and, where a worker
// cannot be started (lib/workerJob.ts explains when), by the page itself.

import { syntheticDemoParticipant } from './demo';
import { runMcse, type McseOptions, type McseRecordingInput, type McseResult } from './engine';

export type McseRequest = { kind: 'analyse'; inputs: McseRecordingInput[]; options: McseOptions } | { kind: 'synthetic'; seed: number; options: McseOptions };

export function runMcseJob(req: McseRequest): McseResult {
  const inputs = req.kind === 'synthetic' ? syntheticDemoParticipant(req.seed).map((r) => ({ frames: r.frames, meta: r.meta })) : req.inputs;
  return runMcse(inputs, req.options);
}
