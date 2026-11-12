// Versions of every computational component. Each frozen analysis run records all of them, so a result
// computed today can always be told apart from one computed after an algorithm change — and an old run is
// never silently recomputed in place (docs/architecture/data-lineage.md).
//
// Rule: change the component version whenever its numbers can change for the same input.

export const LAB_VERSIONS = {
  /** Learning-series construction from stored sessions (dataset.ts). */
  dataset: 'nm-lab-dataset 1.0.0',
  /** Raw-signal quality assessment (quality.ts). */
  quality: 'nm-lab-quality 1.1.0',
  /** Velocity-based movement events (events.ts). */
  events: 'nm-lab-events 1.1.0',
  /** 100 Hz movement features (features.ts). */
  features: 'nm-lab-features 1.1.0',
  /** Learning-dynamics models, fitting, comparison and prediction (models.ts, fit.ts). */
  models: 'nm-lab-models 1.0.0',
  /** Learning decomposition: within/between session, retention, transfer (learning.ts). */
  learning: 'nm-lab-learning 1.0.0',
} as const;

/**
 * Motor Coordination & Strategy Discovery Engine (lab/coord): channels, segmentation, alignment, coordination
 * components, strategy discovery, dissociation, longitudinal strategy analysis. Kept OUT of LAB_VERSIONS so that a
 * change here never marks frozen learning-analysis runs as computed by a different engine.
 */
export const COORD_VERSION = 'nm-lab-coord 1.0.0';

/**
 * Research-frontier engines added on 2026-11-10: measurement science (lab/measure), strategy profiles and
 * flexibility (lab/coord/profile.ts, flexibility.ts), the learning observatory (lab/observatory), the layered twin
 * and population model (lab/twin), the ground-truth scenario engine and benchmark registry (lab/scenario), the
 * discovery layer (lab/discovery) and measurement planning (lab/design). Kept OUT of LAB_VERSIONS for the same reason
 * as COORD_VERSION: none of them changes a number of a frozen learning-analysis run.
 *
 * Rule (same as above): bump a component whenever its numbers can change for the same input.
 *
 * Changes:
 *   measure 1.0.1   placement comparison reports an attribution bound that adds the strap-tilt allowance a
 *                   recording cannot reveal (found by strategy benchmark S2, run 1: 12.5 % of re-attachments were
 *                   called a change of the movement)
 *   strategy 1.0.1  profile comparison tests with the Welch t quantile instead of the normal 1.96 (anti-conservative
 *                   with a dozen repetitions per block; found when scenario 3 was built)
 */
export const FRONTIER_VERSIONS = {
  measure: 'nm-lab-measure 1.0.1',
  strategy: 'nm-lab-strategy 1.0.1',
  observatory: 'nm-lab-observatory 1.0.0',
  twin: 'nm-lab-twin 1.0.0',
  scenario: 'nm-lab-scenario 1.0.0',
  discovery: 'nm-lab-discovery 1.0.0',
  design: 'nm-lab-design 1.0.0',
} as const;

export type FrontierComponent = keyof typeof FRONTIER_VERSIONS;

export type LabComponent = keyof typeof LAB_VERSIONS;

/** One string for the whole engine — shown in reports. */
export const LAB_ENGINE_VERSION = 'nm-lab 1.0.0';
