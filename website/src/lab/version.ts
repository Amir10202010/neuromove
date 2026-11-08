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

export type LabComponent = keyof typeof LAB_VERSIONS;

/** One string for the whole engine — shown in reports. */
export const LAB_ENGINE_VERSION = 'nm-lab 1.0.0';
