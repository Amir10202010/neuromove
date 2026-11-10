// Measurement observability registry — ONE place that says, for every quantity NeuroMove shows or models, what it
// physically is, which sensors and assumptions it needs, how it is obtained, and what it can never establish.
//
// It does not re-implement or re-describe anything: the definitions of repetition metrics (rehab/movement.ts
// METRICS), movement features (lab/features.ts FEATURES) and kinematic channels (lab/coord/channels.ts CHANNELS) stay
// where they are computed and are IMPORTED here; this file adds the measurement-science fields those registries do
// not carry (status, coordinate frame, error model, confidence, interpretation limits, re-attachment sensitivity).
// registry.test.ts fails when a metric, feature or channel exists without an entry here.
//
// Status categories (never merged, never upgraded by software):
//   directly_measured  a sensor output after the documented unit conversion only
//   derived            computed from measured quantities by a documented, deterministic algorithm
//   model_estimated    depends on a statistical or dynamical model fitted to data (changes if the model changes)
//   predicted          a model statement about observations that have not been made
//   not_observable     cannot be obtained from 3 six-axis IMUs on trunk, upper arm and forearm — no estimate is produced
//
// Error-model numbers quoted here come from SYNTHETIC ground truth through the app's MPU-6050 measurement model
// (research/mcse-validation.md V1–V3, research/SCIENTIFIC_VALIDATION.md M1–M4). None is an accuracy claim for children.

import { CHANNELS, CHANNEL_IDS, type ChannelId } from '../coord/channels';
import { FEATURES, type FeatureId } from '../features';
import { METRICS, type MetricId } from '../../rehab/movement';

export const MEASUREMENT_STATUSES = ['directly_measured', 'derived', 'model_estimated', 'predicted', 'not_observable'] as const;
export type MeasurementStatus = (typeof MEASUREMENT_STATUSES)[number];

export type SensorRole = 'trunk' | 'upper' | 'fore';

export type RegistryLayer = 'signal' | 'channel' | 'repetition_metric' | 'movement_feature' | 'coordination' | 'model' | 'prediction' | 'external' | 'unobservable';

/** How a metric responds to the sensor being strapped on differently (measured in placement.ts reattachmentStudy). */
export type ReattachmentClass = 'invariant_to_rotation' | 'sensitive_to_axial_rotation' | 'sensitive_to_tilt' | 'sensitive_to_heading' | 'not_applicable';

export interface RegistryEntry {
  /** `<layer prefix>.<id>` — unique. */
  id: string;
  layer: RegistryLayer;
  name: string;
  unit: string;
  physicalMeaning: string;
  /** Raw channels used: `acc` / `gyro` of the sensor roles in `sensors`. */
  requiredChannels: ('acc' | 'gyro')[];
  sensors: SensorRole[];
  placement: string;
  coordinateFrame: string;
  method: string;
  assumptions: string[];
  status: MeasurementStatus;
  /** Conditions under which the value is valid; outside them it is not produced or is flagged. */
  validity: string[];
  /** How it fails, and what the software does then. */
  failure: string[];
  errorModel: string;
  confidence: string;
  /** What the value must not be read as. */
  interpretationLimits: string[];
  reattachment: ReattachmentClass;
  /** Where the number is computed — the single implementation. */
  source: string;
}

const MOUNT = 'Sensor X along the bone towards the hand (trunk: X down the sternum), Z out of the skin; strapped per COORDINATES.md §2';
const CAL_FRAME = 'Sensor frame, referenced to the gravity direction recorded in the 3 s still calibration pose (arms hanging, sitting upright)';
const NO_CLINICAL = 'Not a clinical score, not a diagnosis and not validated in children: no reference-standard agreement or reliability study exists for this device';

type Extra = Pick<RegistryEntry, 'coordinateFrame' | 'status' | 'validity' | 'failure' | 'errorModel' | 'confidence' | 'interpretationLimits' | 'reattachment'>;

// ── kinematic channels (lab/coord/channels.ts) ─────────────────────────────────────────────────────────────

const CHANNEL_EXTRA: Record<ChannelId, Extra> = {
  trunk_pitch: {
    coordinateFrame: `${CAL_FRAME}; sagittal plane spanned by calibration "up" and the sensor's forward (Z) axis`,
    status: 'derived',
    validity: ['trunk sensor present', 'a still calibration window exists', 'forward axis not parallel to gravity in the calibration pose'],
    failure: ['mount rule not met → channel unavailable with the reason', 'missing samples → NaN, never interpolated'],
    errorModel: 'RMSE 0.37–0.39° on synthetic ground truth (V2b). A rotation of the trunk sensor about the vertical leaks pitch into roll: ≈ sin(offset) of the excursion (M2).',
    confidence: 'signal-quality class of the trunk sensor (lab/quality.ts) and placement confidence (measure/placement.ts)',
    interpretationLimits: ['tilt only — trunk rotation about the vertical is not observable', 'trunk motion is an observed kinematic contribution, not "compensation" in a pathological sense', NO_CLINICAL],
    reattachment: 'sensitive_to_heading',
  },
  trunk_roll: {
    coordinateFrame: `${CAL_FRAME}; frontal plane orthogonal to the sensor's forward (Z) axis`,
    status: 'derived',
    validity: ['as trunk_pitch'],
    failure: ['as trunk_pitch'],
    errorModel: 'as trunk_pitch (V2: RMSE < 1°); cross-talk with pitch under rotation of the sensor about the vertical (M2).',
    confidence: 'as trunk_pitch',
    interpretationLimits: ['as trunk_pitch'],
    reattachment: 'sensitive_to_heading',
  },
  upper_elev: {
    coordinateFrame: CAL_FRAME,
    status: 'derived',
    validity: ['upper-arm sensor present', 'calibration pose held still', 'no saturation'],
    failure: ['saturated samples → NaN', 'gap > 0.5 s → the gravity tracker restarts from the accelerometer'],
    errorModel: 'RMSE 0.88–1.14° on synthetic ground truth (V2a). Invariant to any fixed rotation of the sensor on the arm (M2). A calibration posture that differs by δ in the movement plane biases every later angle by ≈ δ (M3) — this is not detectable from the sensors.',
    confidence: 'signal-quality class, calibration-pose tilt (Session.calibrationPose) and placement confidence',
    interpretationLimits: ['inclination from the calibration direction in the world, not relative to the trunk: a trunk lean changes it', 'does not separate flexion from abduction', NO_CLINICAL],
    reattachment: 'invariant_to_rotation',
  },
  fore_elev: {
    coordinateFrame: CAL_FRAME,
    status: 'derived',
    validity: ['forearm sensor present', 'calibration pose held still', 'no saturation'],
    failure: ['as upper_elev'],
    errorModel: 'as upper_elev (same algorithm on the forearm sensor).',
    confidence: 'as upper_elev',
    interpretationLimits: ['world inclination of the forearm; forearm pronation/supination is a separate quantity', NO_CLINICAL],
    reattachment: 'invariant_to_rotation',
  },
  elbow_flex: {
    coordinateFrame: 'Hinge plane fixed in the upper-arm sensor frame (normal = sensor Z, signed by side)',
    status: 'derived',
    validity: ['upper-arm and forearm sensors present', 'hinge axis more than 30° from vertical', 'validated for shoulder flexion and elbow flexion only'],
    failure: ['hinge axis near vertical (arm abducted) → NaN (V2d fails there: RMSE 7.1°)', 'excluded from the shoulder-abduction representation'],
    errorModel: 'RMSE 2.5–2.7° in flexion on synthetic ground truth (V2d). Rotation of the upper-arm sensor about the bone turns the assumed hinge axis: error grows with the offset and with shoulder elevation (M2).',
    confidence: 'share of samples where the hinge was observable (ChannelSet.elbowUnobservableSamples) and placement confidence of the upper-arm sensor',
    interpretationLimits: ['assumes the elbow is a hinge whose axis is the sensor Z axis — a mounting assumption, not a measured joint axis', NO_CLINICAL],
    reattachment: 'sensitive_to_axial_rotation',
  },
  humerothoracic: {
    coordinateFrame: 'World frame from 6-axis orientation integration of trunk and upper-arm sensors; headings aligned by the mount rule at the end of calibration',
    status: 'model_estimated',
    validity: ['inside a repetition only', 'trunk and upper-arm sensors present', 'no filter restart since calibration'],
    failure: ['heading alignment impossible → unavailable', 'never part of the coordination representation (display only)'],
    errorModel: 'RMSE 1.05–1.72° inside repetitions on synthetic ground truth (V2c). Heading is pure gyroscope integration: it drifts with residual gyroscope bias (drift bound reported per recording).',
    confidence: 'relative heading-drift bound (ChannelSet.drift) and filter restarts',
    interpretationLimits: ['an estimate, not a measurement of glenohumeral or scapulothoracic motion', 'not valid across a session'],
    reattachment: 'sensitive_to_heading',
  },
  trunk_rate: {
    coordinateFrame: 'Sensor frame (norm of the angular-rate vector — frame-independent)',
    status: 'directly_measured',
    validity: ['gyroscope not saturated (±1000 °/s)', 'bias taken from a still window'],
    failure: ['saturation → NaN'],
    errorModel: 'Gyroscope noise ≈ 0.08 °/s SD per axis at DLPF 44 Hz (simulator model), residual bias after still calibration; the norm is biased upwards near zero rate (Rician).',
    confidence: 'residual-bias diagnostic (ChannelSet.drift.residualBiasDps)',
    interpretationLimits: ['segment angular speed, not joint angular velocity'],
    reattachment: 'invariant_to_rotation',
  },
  upper_rate: {
    coordinateFrame: 'Sensor frame (norm — frame-independent)',
    status: 'directly_measured',
    validity: ['as trunk_rate'],
    failure: ['as trunk_rate'],
    errorModel: 'as trunk_rate',
    confidence: 'as trunk_rate',
    interpretationLimits: ['segment angular speed in the world: includes trunk rotation carried by the arm'],
    reattachment: 'invariant_to_rotation',
  },
  fore_rate: {
    coordinateFrame: 'Sensor frame (norm — frame-independent)',
    status: 'directly_measured',
    validity: ['as trunk_rate'],
    failure: ['as trunk_rate'],
    errorModel: 'as trunk_rate',
    confidence: 'as trunk_rate',
    interpretationLimits: ['segment angular speed in the world: includes shoulder and trunk motion'],
    reattachment: 'invariant_to_rotation',
  },
  upper_axial_rate: {
    coordinateFrame: 'Bone axis of the upper arm = gravity direction in the sensor frame in the calibration pose',
    status: 'derived',
    validity: ['calibration pose with the arm hanging vertically'],
    failure: ['no calibration window → unavailable'],
    errorModel: 'Bone axis error = calibration-posture error; rate error ≈ |ω|·sin(axis error).',
    confidence: 'calibration-pose tilt',
    interpretationLimits: ['an angular rate, not an angle: integrated axial rotation drifts and is not reported'],
    reattachment: 'invariant_to_rotation',
  },
  fore_axial_rate: {
    coordinateFrame: 'Bone axis of the forearm from the calibration pose',
    status: 'derived',
    validity: ['as upper_axial_rate'],
    failure: ['as upper_axial_rate'],
    errorModel: 'as upper_axial_rate',
    confidence: 'calibration-pose tilt',
    interpretationLimits: ['pronation/supination RATE; the angle of the clinical rotation test comes from gravity roll (metric.rom for forearm_rotation)'],
    reattachment: 'invariant_to_rotation',
  },
};

// ── per-repetition metrics of a stored session (rehab/movement.ts) ─────────────────────────────────────────

const ANGLE_LIMITS = ['relative to the calibration pose, so a different calibration posture shifts it', NO_CLINICAL];

const METRIC_EXTRA: Record<MetricId, Extra & { sensors: SensorRole[]; requiredChannels: ('acc' | 'gyro')[] }> = {
  rom: { sensors: ['upper', 'fore'], requiredChannels: ['acc', 'gyro'], coordinateFrame: CAL_FRAME, status: 'derived', validity: ['≥ 3 repetitions', 'signal ≥ 90 %', 'no blocking quality flag'], failure: ['step flagged and excluded from comparisons (never silently)'], errorModel: 'Inherits the task-angle error (channel.upper_elev / channel.elbow_flex); the maximum of a noisy trace is biased upwards by about one noise SD.', confidence: 'step quality flags + session signal percent + placement confidence', interpretationLimits: ['active range reached in this test, not passive joint range', ...ANGLE_LIMITS], reattachment: 'invariant_to_rotation' },
  min_angle: { sensors: ['upper', 'fore'], requiredChannels: ['acc', 'gyro'], coordinateFrame: CAL_FRAME, status: 'derived', validity: ['20 Hz stored trace available'], failure: ['short extremes (≤ 50 ms) can be missed'], errorModel: 'As rom, plus 20 Hz decimation.', confidence: 'as rom', interpretationLimits: ANGLE_LIMITS, reattachment: 'invariant_to_rotation' },
  excursion: { sensors: ['upper', 'fore'], requiredChannels: ['acc', 'gyro'], coordinateFrame: CAL_FRAME, status: 'derived', validity: ['20 Hz stored trace available'], failure: ['bounded below by the detector threshold'], errorModel: 'As rom; a difference of two angles of one repetition, so a constant calibration-posture offset cancels.', confidence: 'as rom', interpretationLimits: ANGLE_LIMITS, reattachment: 'invariant_to_rotation' },
  peak_velocity: { sensors: ['upper', 'fore'], requiredChannels: ['gyro'], coordinateFrame: 'Sensor frame (norm)', status: 'derived', validity: ['no gyroscope saturation'], failure: ['saturation flag'], errorModel: 'Gyroscope noise and bias; the maximum of a noisy signal is biased upwards.', confidence: 'saturation flag', interpretationLimits: ['segment angular speed, not joint angular velocity when the proximal segment also moves'], reattachment: 'invariant_to_rotation' },
  rep_duration: { sensors: ['upper', 'fore'], requiredChannels: ['acc', 'gyro'], coordinateFrame: 'time', status: 'derived', validity: ['repetition detected by the hysteresis detector'], failure: ['depends on detector thresholds'], errorModel: 'Threshold crossings on the angle: 10 ms sampling, plus dependence on the expected range.', confidence: 'none beyond detection', interpretationLimits: ['not a velocity-defined movement time (see feature.duration)'], reattachment: 'invariant_to_rotation' },
  time_to_peak: { sensors: ['upper', 'fore'], requiredChannels: ['acc', 'gyro'], coordinateFrame: 'time', status: 'derived', validity: ['20 Hz trace'], failure: ['±50 ms resolution'], errorModel: '±50 ms (20 Hz trace); window starts at a threshold crossing.', confidence: 'none', interpretationLimits: ['not time to peak velocity'], reattachment: 'invariant_to_rotation' },
  sparc: { sensors: ['upper', 'fore'], requiredChannels: ['gyro'], coordinateFrame: 'Sensor frame (norm)', status: 'derived', validity: ['rise phase ≥ 8 samples'], failure: ['NaN when too short'], errorModel: 'Sensitive to segmentation and to noise in slow movements; no error bound established.', confidence: 'none', interpretationLimits: ['validated in adult reaching with other sensors; not validated here', NO_CLINICAL], reattachment: 'invariant_to_rotation' },
  rom_cv: { sensors: ['upper', 'fore'], requiredChannels: ['acc', 'gyro'], coordinateFrame: CAL_FRAME, status: 'derived', validity: ['≥ 2 repetitions'], failure: ['unstable with few repetitions'], errorModel: 'Mixes biological variability, effort and measurement noise; measure/uncertainty.ts reports the measurement share.', confidence: 'number of repetitions', interpretationLimits: ['higher variability is not automatically worse motor function'], reattachment: 'invariant_to_rotation' },
  rom_sd: { sensors: ['upper', 'fore'], requiredChannels: ['acc', 'gyro'], coordinateFrame: CAL_FRAME, status: 'derived', validity: ['≥ 2 repetitions'], failure: ['as rom_cv'], errorModel: 'as rom_cv', confidence: 'number of repetitions', interpretationLimits: ['as rom_cv'], reattachment: 'invariant_to_rotation' },
  rep_interval_cv: { sensors: ['upper', 'fore'], requiredChannels: ['acc', 'gyro'], coordinateFrame: 'time', status: 'derived', validity: ['≥ 3 repetitions'], failure: ['includes pauses chosen by the child or professional'], errorModel: 'Timing resolution 10 ms; dominated by behaviour, not by the sensor.', confidence: 'number of repetitions', interpretationLimits: ['not a motor-control measure on its own'], reattachment: 'invariant_to_rotation' },
  trunk: { sensors: ['trunk'], requiredChannels: ['acc', 'gyro'], coordinateFrame: CAL_FRAME, status: 'derived', validity: ['trunk sensor worn', 'exercise uses the trunk sensor'], failure: ['absent for elbow and forearm tests'], errorModel: 'Unsigned tilt from the calibration direction: invariant to sensor rotation; the maximum of a noisy trace is biased upwards.', confidence: 'trunk signal quality', interpretationLimits: ['tilt only (no rotation)', 'an observed trunk contribution — whether it is helpful or limiting depends on the task and is a clinical judgement'], reattachment: 'invariant_to_rotation' },
  rep_count: { sensors: ['upper', 'fore'], requiredChannels: ['acc', 'gyro'], coordinateFrame: 'count', status: 'derived', validity: ['detector thresholds appropriate for the range'], failure: ['small movements below the threshold are not counted'], errorModel: 'Detection ≥ 0.95 on synthetic data (V3a).', confidence: 'none', interpretationLimits: ['a count of detected movements, never a target to increase'], reattachment: 'invariant_to_rotation' },
};

// ── velocity-defined movement features (lab/features.ts) ───────────────────────────────────────────────────

const FEATURE_EXTRA: Record<FeatureId, Extra & { sensors: SensorRole[]; requiredChannels: ('acc' | 'gyro')[] }> = {
  duration: { sensors: ['upper'], requiredChannels: ['gyro'], coordinateFrame: 'time', status: 'derived', validity: ['movement complete'], failure: ['incomplete → missing, with the reason'], errorModel: 'Median onset error 20 ms on synthetic data (V3b).', confidence: 'boundary uncertainty interval (coord/segment.ts)', interpretationLimits: ['depends on the 5 %-of-peak convention'], reattachment: 'invariant_to_rotation' },
  peak_speed: { sensors: ['upper'], requiredChannels: ['gyro'], coordinateFrame: 'Sensor frame (norm)', status: 'derived', validity: ['no saturation'], failure: ['saturated → missing'], errorModel: 'Gyroscope noise after the 6 Hz zero-phase low-pass: ≈ 0.03 °/s SD.', confidence: 'saturation flag', interpretationLimits: ['segment speed in the world'], reattachment: 'invariant_to_rotation' },
  mean_speed: { sensors: ['upper'], requiredChannels: ['gyro'], coordinateFrame: 'Sensor frame (norm)', status: 'derived', validity: ['no saturation'], failure: ['saturated → missing'], errorModel: 'as peak_speed', confidence: 'saturation flag', interpretationLimits: ['segment speed in the world'], reattachment: 'invariant_to_rotation' },
  time_to_peak_fraction: { sensors: ['upper'], requiredChannels: ['gyro'], coordinateFrame: 'dimensionless', status: 'derived', validity: ['movement complete'], failure: ['incomplete → missing'], errorModel: 'Onset/offset error (≈ 20 ms) relative to the duration.', confidence: 'boundary uncertainty', interpretationLimits: ['symmetry of the speed profile; not a diagnosis of anything'], reattachment: 'invariant_to_rotation' },
  speed_peaks: { sensors: ['upper'], requiredChannels: ['gyro'], coordinateFrame: 'count', status: 'derived', validity: ['movement complete'], failure: ['sensitive to the low-pass cut-off'], errorModel: 'Integer count; changes by ±1 with noise near the 10 % prominence threshold.', confidence: 'none', interpretationLimits: ['a count of speed maxima, not "submovements" of the nervous system'], reattachment: 'invariant_to_rotation' },
  sparc: { sensors: ['upper'], requiredChannels: ['gyro'], coordinateFrame: 'Sensor frame (norm)', status: 'derived', validity: ['movement complete', '≥ 8 samples'], failure: ['too short → missing'], errorModel: 'No error bound established; sensitive to segmentation.', confidence: 'none', interpretationLimits: [NO_CLINICAL], reattachment: 'invariant_to_rotation' },
  inclination_change: { sensors: ['upper'], requiredChannels: ['acc', 'gyro'], coordinateFrame: 'Gravity-referenced inclination of the sensor X axis (not calibration-referenced)', status: 'derived', validity: ['segment not accelerating strongly at onset and offset'], failure: ['none flagged'], errorModel: 'Uses the nominal X axis: a strap tilt of 2–5° gives up to ≈ 10° error at high elevation (core.test.ts). Prefer channel.upper_elev.', confidence: 'none', interpretationLimits: ['raw-signal view only; not the clinical ROM angle'], reattachment: 'sensitive_to_tilt' },
  trunk_tilt: { sensors: ['trunk'], requiredChannels: ['acc', 'gyro'], coordinateFrame: 'Tilt from the first still orientation', status: 'derived', validity: ['trunk sensor present', 'a still period at the start'], failure: ['no reference → missing'], errorModel: 'as metric.trunk', confidence: 'trunk signal quality', interpretationLimits: ['as metric.trunk'], reattachment: 'invariant_to_rotation' },
  trunk_ratio: { sensors: ['trunk', 'upper'], requiredChannels: ['acc', 'gyro'], coordinateFrame: 'dimensionless', status: 'derived', validity: ['arm inclination change ≥ 20°'], failure: ['below 20° → missing'], errorModel: 'Ratio of two noisy angles: relative error ≈ √(rel. error of each)².', confidence: 'none', interpretationLimits: ['an observed kinematic ratio, not a diagnosis of compensation'], reattachment: 'invariant_to_rotation' },
  trunk_arm_correlation: { sensors: ['trunk', 'upper'], requiredChannels: ['acc', 'gyro'], coordinateFrame: 'dimensionless', status: 'derived', validity: ['≥ 20 samples'], failure: ['too few samples → missing'], errorModel: 'Attenuated by noise when the trunk barely moves.', confidence: 'none', interpretationLimits: ['co-variation, not causation'], reattachment: 'invariant_to_rotation' },
  trunk_lag: { sensors: ['trunk', 'upper'], requiredChannels: ['acc', 'gyro'], coordinateFrame: 'time', status: 'derived', validity: ['≥ 50 samples', 'correlation peak ≥ 0.5'], failure: ['weak correlation → missing'], errorModel: 'Resolution 10 ms; intra-frame sensor skew ≈ 2–4 ms (not measured).', confidence: 'correlation at the best lag', interpretationLimits: ['a kinematic lag, not a neural delay'], reattachment: 'invariant_to_rotation' },
};

// ── signals, coordination, model and prediction layers ─────────────────────────────────────────────────────

const OTHER: RegistryEntry[] = [
  {
    id: 'signal.acc', layer: 'signal', name: 'Specific force (accelerometer)', unit: 'g', physicalMeaning: 'Acceleration minus gravity along each sensor axis; at rest a 1 g vector pointing up',
    requiredChannels: ['acc'], sensors: ['trunk', 'upper', 'fore'], placement: MOUNT, coordinateFrame: 'Sensor frame', method: 'int16 / 8192 LSB per g (±4 g), optional 6-position offset/scale correction (core/imu.ts toPhysical)',
    assumptions: ['factory scale unless the device passport carries a 6-position calibration'], status: 'directly_measured', validity: ['|value| below the ±4 g range'], failure: ['saturation flagged per sample'],
    errorModel: 'Noise ≈ 0.004 g SD at DLPF 44 Hz; uncalibrated zero offset up to ±0.05 g (≈ 3° of tilt).', confidence: 'rest-norm check |a| − 1 g (lab/quality.ts)',
    interpretationLimits: ['not position: double integration drifts quadratically and is never done'], reattachment: 'not_applicable', source: 'core/imu.ts',
  },
  {
    id: 'signal.gyro', layer: 'signal', name: 'Angular rate (gyroscope)', unit: '°/s', physicalMeaning: 'Angular velocity of the sensor about each of its axes',
    requiredChannels: ['gyro'], sensors: ['trunk', 'upper', 'fore'], placement: MOUNT, coordinateFrame: 'Sensor frame', method: 'int16 / 32.8 LSB per °/s (±1000 °/s) minus the bias of the still calibration window',
    assumptions: ['bias constant after calibration (checked by the drift diagnostic)'], status: 'directly_measured', validity: ['below ±1000 °/s'], failure: ['saturation flagged per sample'],
    errorModel: 'Noise ≈ 0.08 °/s SD per axis; bias ≈ ±1.5 °/s before calibration; residual bias reported per recording.', confidence: 'bias drift between first and last still period',
    interpretationLimits: ['heading (rotation about the vertical) obtained by integrating it drifts and is not corrected by any measurement'], reattachment: 'not_applicable', source: 'core/imu.ts',
  },
  {
    id: 'coordination.component_score', layer: 'coordination', name: 'Coordination component score', unit: '°', physicalMeaning: 'Projection of a repetition\'s registered multi-segment excursion curves on a principal direction of co-variation',
    requiredChannels: ['acc', 'gyro'], sensors: ['trunk', 'upper', 'fore'], placement: MOUNT, coordinateFrame: 'Component space of the analysed set of repetitions (not comparable across separate analyses)', method: 'Discretised functional PCA with parallel analysis + bootstrap congruence (coord/components.ts)',
    assumptions: ['landmark registration removes phase-timing differences only', 'linear residualisation on the task outcome'], status: 'model_estimated', validity: ['≥ 10 repetitions', 'component passes parallel analysis and congruence ≥ 0.85'], failure: ['no_structure / insufficient_data verdicts'],
    errorModel: 'PC1 congruence with the true direction 0.998 on synthetic data (V4); undefined when the trunk sensor is missing and strategies differ in trunk motion.', confidence: 'bootstrap congruence, cross-validated reconstruction error',
    interpretationLimits: ['a kinematic co-variation pattern — not a muscle or neural synergy'], reattachment: 'sensitive_to_axial_rotation', source: 'lab/coord/components.ts',
  },
  {
    id: 'coordination.strategy_label', layer: 'coordination', name: 'Movement-strategy assignment', unit: 'label + posterior', physicalMeaning: 'Membership of a repetition in a reproducible cluster of coordination patterns',
    requiredChannels: ['acc', 'gyro'], sensors: ['trunk', 'upper', 'fore'], placement: MOUNT, coordinateFrame: 'Component space', method: 'Diagonal Gaussian mixture, BIC with parsimony, bootstrap/Jaccard/Ward/separation/co-occurrence checks (coord/strategy.ts)',
    assumptions: ['strategies are discrete and roughly Gaussian in component space'], status: 'model_estimated', validity: ['≥ 12 repetitions', 'every stability check passes', 'posterior ≥ 0.8'], failure: ['insufficient_data / single_pattern / inconclusive verdicts; uncertain assignments are null'],
    errorModel: '0 / 80 false strategies on single-strategy synthetic data (V6a); power 0.95 at n = 48 (V5a).', confidence: 'posterior probability, bootstrap ARI, Jaccard recovery',
    interpretationLimits: ['neutral statistical label: not compensatory, pathological, efficient or worse'], reattachment: 'sensitive_to_axial_rotation', source: 'lab/coord/strategy.ts',
  },
  {
    id: 'coordination.trunk_contribution', layer: 'coordination', name: 'Trunk contribution ratio', unit: '', physicalMeaning: '|trunk tilt excursion in the task plane| / |upper-arm inclination excursion| during the outbound phase',
    requiredChannels: ['acc', 'gyro'], sensors: ['trunk', 'upper'], placement: MOUNT, coordinateFrame: CAL_FRAME, method: 'coord/coordination.ts describeRepetition',
    assumptions: ['task plane = sagittal for flexion, frontal for abduction'], status: 'derived', validity: ['upper-arm excursion ≥ 20°'], failure: ['below 20° → null'],
    errorModel: 'Numerator inherits the trunk pitch/roll cross-talk under trunk-sensor rotation about the vertical (M2).', confidence: 'placement confidence of the trunk sensor',
    interpretationLimits: ['an observed kinematic ratio; the same trunk motion can enable a task or mask limited arm capacity — the task context decides'], reattachment: 'sensitive_to_heading', source: 'lab/coord/coordination.ts',
  },
  {
    id: 'model.session_state', layer: 'model', name: 'Latent task-performance state z_k', unit: 'metric unit', physicalMeaning: 'Model estimate of one person\'s performance on one task metric at a session, with repetition and day-to-day noise removed',
    requiredChannels: ['acc', 'gyro'], sensors: ['upper', 'fore'], placement: MOUNT, coordinateFrame: 'Metric scale', method: 'Maximum likelihood under the selected candidate model (lab/models.ts, fit.ts)',
    assumptions: ['shared measurement model y_kr = z_k + η_k + ε_kr', 'the selected model is adequate'], status: 'model_estimated', validity: ['≥ 3–5 included sessions depending on the model'], failure: ['insufficient_data; non-identifiable parameters flagged by open profile intervals'],
    errorModel: 'Bootstrap bands; small-sample profile intervals slightly liberal (E3 coverage 0.955).', confidence: 'profile-likelihood intervals, bootstrap, leave-future-out error',
    interpretationLimits: ['a description of an observed metric — not a state of the nervous system, not recovery'], reattachment: 'not_applicable', source: 'lab/fit.ts',
  },
  {
    id: 'model.change_parameter', layer: 'model', name: 'Change parameters (slope, time constant, half-life, gain)', unit: 'per model', physicalMeaning: 'Parameters describing how the latent state changes across sessions',
    requiredChannels: ['acc', 'gyro'], sensors: ['upper', 'fore'], placement: MOUNT, coordinateFrame: 'Metric scale / days', method: 'lab/fit.ts with profile likelihood',
    assumptions: ['model form', 'dose assumption when no practice log exists'], status: 'model_estimated', validity: ['interval closed on both sides'], failure: ['open interval = not identifiable; reported, never hidden'],
    errorModel: 'E4/E5: time constant identifiable in 25 % of 8-session series; forgetting separable from saturation only with breaks and variable dose.', confidence: 'profile-likelihood interval',
    interpretationLimits: ['association over time, not the effect of practice: no causal claim from observational sessions'], reattachment: 'not_applicable', source: 'lab/fit.ts',
  },
  {
    id: 'prediction.next_session', layer: 'prediction', name: 'Predicted mean of a future session', unit: 'metric unit', physicalMeaning: 'Interval expected to contain the mean of a future session of n repetitions if the model and conditions stay as they were',
    requiredChannels: ['acc', 'gyro'], sensors: ['upper', 'fore'], placement: MOUNT, coordinateFrame: 'Metric scale', method: 'Parametric bootstrap predictive interval with small-sample correction (lab/fit.ts predictiveBands); model-averaged record in lab/twin/prediction.ts',
    assumptions: ['no change of protocol, sensors or the child\'s condition', 'model adequate'], status: 'predicted', validity: ['horizon within the observed span', 'calibration status evaluated'], failure: ['refused when evidence is insufficient (twin/prediction.ts refusal rules)'],
    errorModel: 'Coverage 0.92 on synthetic linear change (E7); calibration on real data unknown.', confidence: 'leave-future-out coverage with its binomial interval',
    interpretationLimits: ['not a prognosis and not a treatment recommendation'], reattachment: 'not_applicable', source: 'lab/fit.ts, lab/twin/prediction.ts',
  },
  {
    id: 'external.clinical_score', layer: 'external', name: 'Standardised clinical assessment score (AHA, MA2, QUEST, ABILHAND-Kids, COPM, GAS)', unit: 'instrument scale', physicalMeaning: 'Function, capacity, performance or goal attainment as defined by the instrument',
    requiredChannels: [], sensors: [], placement: 'not a sensor quantity', coordinateFrame: 'instrument scale', method: 'Entered by a qualified assessor (rehab/model.ts assessments); never computed or reconstructed by NeuroMove',
    assumptions: ['administered as the instrument requires (training / certification where required)'], status: 'not_observable', validity: ['only when independently collected'], failure: ['absent → analyses that need it report "not estimable"'],
    errorModel: 'Per the instrument\'s own measurement properties.', confidence: 'not computed here',
    interpretationLimits: ['IMU metrics and clinical scores measure different constructs; no IMU metric is a surrogate for them'], reattachment: 'not_applicable', source: 'rehab/model.ts (manual entry)',
  },
];

// ── what three six-axis IMUs cannot observe ────────────────────────────────────────────────────────────────

const U = (id: string, name: string, why: string, needed: string): RegistryEntry => ({
  id: `unobservable.${id}`, layer: 'unobservable', name, unit: '—', physicalMeaning: name,
  requiredChannels: [], sensors: [], placement: 'no sensor of the current configuration measures it', coordinateFrame: '—', method: 'none — no estimate is produced',
  assumptions: [], status: 'not_observable', validity: [], failure: [why], errorModel: 'not applicable', confidence: 'not applicable',
  interpretationLimits: [`would require: ${needed}`], reattachment: 'not_applicable', source: '—',
});

const UNOBSERVABLE: RegistryEntry[] = [
  U('brain_activity', 'Brain activity', 'IMUs measure inertial signals of body segments only', 'EEG, fNIRS or MRI'),
  U('corticospinal_integrity', 'Corticospinal tract integrity', 'no neurophysiological or imaging measurement', 'TMS or diffusion MRI'),
  U('neural_activation', 'Neural activation or neural recovery', 'kinematics do not identify neural mechanisms', 'neurophysiology plus a causal study design'),
  U('muscle_activity', 'Muscle electrical activity', 'no EMG', 'surface EMG'),
  U('muscle_force', 'Muscle force and joint torque', 'no force measurement and no validated inverse-dynamics model', 'force sensors, dynamometry or a validated musculoskeletal model'),
  U('spasticity', 'Spasticity / muscle tone', 'needs velocity-dependent resistance to passive stretch, which is not measured', 'instrumented passive stretch with torque and EMG, or clinical scales by an assessor'),
  U('hand_trajectory', 'Absolute hand trajectory and endpoint accuracy', 'no position sensing; double integration of acceleration drifts quadratically; no hand sensor', 'optical or electromagnetic tracking, or a hand/wrist sensor with a kinematic chain and heading'),
  U('contact_force', 'Object contact and grip force', 'no force or pressure sensor', 'instrumented objects'),
  U('scapular_motion', 'Scapular motion independent of trunk and humerus', 'no scapular sensor; skin motion over the scapula is large', 'a scapula locator or additional sensor'),
  U('glenohumeral', 'Full clinical shoulder biomechanics (plane of elevation, axial rotation angle, glenohumeral vs scapulothoracic share)', 'relative heading between trunk and arm is not observable without a magnetometer or optical reference', 'magnetometer-aided or optical reference, functional calibration'),
  U('heading', 'Heading (rotation about the vertical) and trunk rotation', 'gravity fixes tilt only; gyroscope integration drifts', 'magnetometer in an undisturbed field, or an optical reference'),
  U('wrist_hand', 'Wrist, hand and finger kinematics', 'no sensor distal to the forearm', 'hand/finger sensors'),
  U('subjective_state', 'Pain, effort, fatigue, attention', 'subjective states are not inertial signals', 'self-report or observer rating recorded by a person'),
  U('daily_function', 'Function in daily life', 'only instructed test movements are recorded', 'standardised functional assessments and daily-life monitoring'),
  U('cause_of_change', 'Cause of a change (practice, growth, medication, recovery, measurement conditions)', 'observational repeated measures do not identify causes', 'a controlled (randomised) design'),
];

// ── assembly ───────────────────────────────────────────────────────────────────────────────────────────────

function build(): RegistryEntry[] {
  const out: RegistryEntry[] = [];
  for (const id of CHANNEL_IDS) {
    const d = CHANNELS[id];
    const x = CHANNEL_EXTRA[id];
    out.push({
      id: `channel.${id}`, layer: 'channel', name: id, unit: d.unit, physicalMeaning: d.definition,
      requiredChannels: d.kind === 'rate' && d.observability === 'measured' ? ['gyro'] : ['acc', 'gyro'], sensors: [...d.needs], placement: MOUNT,
      method: `lab/coord/channels.ts buildChannels (${d.observability})`, assumptions: [d.assumptions], source: 'lab/coord/channels.ts', ...x,
    });
  }
  for (const id of Object.keys(METRICS) as MetricId[]) {
    const d = METRICS[id];
    const { sensors, requiredChannels, ...x } = METRIC_EXTRA[id];
    out.push({
      id: `metric.${id}`, layer: 'repetition_metric', name: id, unit: d.unit, physicalMeaning: d.definition, requiredChannels, sensors, placement: MOUNT,
      method: d.processing, assumptions: [d.input, d.limitations], source: 'core/metrics.ts → rehab/movement.ts', ...x,
    });
  }
  for (const id of Object.keys(FEATURES) as FeatureId[]) {
    const d = FEATURES[id];
    const { sensors, requiredChannels, ...x } = FEATURE_EXTRA[id];
    out.push({
      id: `feature.${id}`, layer: 'movement_feature', name: id, unit: d.unit, physicalMeaning: d.definition, requiredChannels, sensors, placement: MOUNT,
      method: 'lab/features.ts movementFeatures', assumptions: [d.validWhen], source: 'lab/features.ts', ...x,
    });
  }
  return [...OTHER.filter((e) => e.layer === 'signal'), ...out, ...OTHER.filter((e) => e.layer !== 'signal'), ...UNOBSERVABLE];
}

export const REGISTRY: readonly RegistryEntry[] = build();

const BY_ID = new Map(REGISTRY.map((e) => [e.id, e]));

export function registryEntry(id: string): RegistryEntry | null {
  return BY_ID.get(id) ?? null;
}

export function entriesByStatus(status: MeasurementStatus): RegistryEntry[] {
  return REGISTRY.filter((e) => e.status === status);
}

/**
 * Which quantities remain obtainable with a given set of sensors (logical ablation, the basis of the minimum
 * sensor-configuration analysis in lab/design/sensors.ts). A quantity needs ALL the roles it lists.
 */
export function observableWith(roles: readonly SensorRole[]): { available: RegistryEntry[]; lost: RegistryEntry[] } {
  const have = new Set(roles);
  const measurable = REGISTRY.filter((e) => e.status !== 'not_observable' && e.layer !== 'model' && e.layer !== 'prediction' && e.layer !== 'signal');
  // Repetition metrics of a step need the sensors of THAT step's movement, not both arm sensors: an entry listing
  // upper+fore is treated as "either" for layer repetition_metric (elevation tests use upper, elbow/rotation fore).
  const ok = (e: RegistryEntry) => (e.layer === 'repetition_metric' && e.sensors.length > 1 ? e.sensors.some((s) => have.has(s)) : e.sensors.every((s) => have.has(s)));
  return { available: measurable.filter(ok), lost: measurable.filter((e) => !ok(e)) };
}

// ── data provenance labels (shown on every value; never merged) ───────────────────────────────────────────

export const PROVENANCE_LABELS = ['real_measurement', 'synthetic_simulation', 'manual_entry', 'external_assessment', 'model_estimate', 'model_prediction', 'hypothetical_scenario'] as const;
export type ProvenanceLabel = (typeof PROVENANCE_LABELS)[number];

/** Provenance of a value given how it was obtained and whether its inputs were simulated. Simulation always wins. */
export function provenanceOf(status: MeasurementStatus, o: { simulated: boolean; manual?: boolean; hypothetical?: boolean }): ProvenanceLabel {
  if (o.hypothetical) return 'hypothetical_scenario';
  if (o.simulated) return 'synthetic_simulation';
  if (status === 'predicted') return 'model_prediction';
  if (status === 'model_estimated') return 'model_estimate';
  if (o.manual) return status === 'not_observable' ? 'external_assessment' : 'manual_entry';
  return 'real_measurement';
}

/**
 * Number of decimals a value may be DISPLAYED with, given its standard uncertainty: the last shown digit is the
 * first significant digit of the uncertainty (GUM 7.2.6 convention, one significant digit of u). Stored values are
 * never rounded.
 */
export function displayDecimals(standardUncertainty: number | null | undefined, max = 2): number {
  if (standardUncertainty === null || standardUncertainty === undefined || !(standardUncertainty > 0) || !Number.isFinite(standardUncertainty)) return Math.min(1, max);
  const d = -Math.floor(Math.log10(standardUncertainty));
  return Math.max(0, Math.min(max, d));
}
