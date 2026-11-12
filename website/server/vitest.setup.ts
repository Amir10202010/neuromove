// Time limit of the SERVER tests only (loaded for every test file by vite.config.ts → test.setupFiles; it acts only on
// files under server/).
//
// A server test starts an in-process PostgreSQL (PGlite), applies every migration and creates accounts whose
// passwords go through a deliberately slow hash. One test takes 2–4 s on an idle machine and 5–6 s on a busy or
// thermally throttled one. With Vitest's default limit of 5 s these tests timed out now and then for reasons that
// have nothing to do with correctness — observed on 10–11 Nov 2026 in the full run AND with the file run on its own
// minutes after it had passed. The limit is raised to 20 s here; no assertion is changed, and every other test keeps
// the 5 s default (so an accidentally heavy unit test is still noticed).

import { expect, vi } from 'vitest';

if (/[\\/]server[\\/]/.test(expect.getState().testPath ?? '')) vi.setConfig({ testTimeout: 20_000 });
