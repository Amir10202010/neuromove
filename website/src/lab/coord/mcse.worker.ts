// Runs the coordination engine off the main thread (the analysis takes seconds for dozens of repetitions).
// Messages: { kind: 'analyse', inputs, options } or { kind: 'synthetic', seed }. Replies with the result or an error.

import { runMcse, type McseOptions, type McseRecordingInput } from './engine';
import { syntheticDemoParticipant } from './demo';

type Req = { kind: 'analyse'; inputs: McseRecordingInput[]; options: McseOptions } | { kind: 'synthetic'; seed: number; options: McseOptions };

self.onmessage = (e: MessageEvent<Req>) => {
  try {
    const req = e.data;
    const inputs = req.kind === 'synthetic' ? syntheticDemoParticipant(req.seed).map((r) => ({ frames: r.frames, meta: r.meta })) : req.inputs;
    const result = runMcse(inputs, req.options);
    (self as unknown as Worker).postMessage({ ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
