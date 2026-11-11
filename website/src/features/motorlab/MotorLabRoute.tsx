// Entry point of the motor-learning lab, loaded lazily (its own build chunk) by app/Workspace.tsx.

import { lazy } from 'react';
import type { Route } from '../../app/router';
import { LabOverviewPage } from './LabOverviewPage';
import { LearningExplorerPage } from './LearningExplorerPage';
import { MovementLabPage } from './MovementLabPage';
import { ReadinessPage } from './ReadinessPage';
import { RunReportPage, RunsPage } from './RunsPage';
import { StudyDesignerPage } from './StudyDesignerPage';
import { TwinPage } from './TwinPage';
import { CoordinationPage } from './coordination/CoordinationPage';

// Research-frontier workspaces: a chunk of their own (shell + dictionary), each view lazily inside it.
// The Suspense boundary is the one around MotorLabRoute in app/Workspace.tsx.
const FrontierPage = lazy(() => import('./frontier/FrontierPage').then((m) => ({ default: m.FrontierPage })));

export default function MotorLabRoute({ route }: { route: Route }) {
  switch (route.name) {
    case 'labOverview':
      return <LabOverviewPage />;
    case 'labLearning':
      return <LearningExplorerPage participant={route.participant} task={route.task} metric={route.metric} />;
    case 'labTwin':
      return <TwinPage id={route.id} />;
    case 'labMovement':
      return <MovementLabPage sessionId={route.sessionId} />;
    case 'labDesigner':
      return <StudyDesignerPage />;
    case 'labRuns':
      return <RunsPage />;
    case 'labRun':
      return <RunReportPage id={route.id} />;
    case 'labReadiness':
      return <ReadinessPage />;
    case 'labCoordination':
      return <CoordinationPage participant={route.participant} exercise={route.exercise} />;
    case 'labFrontier':
      return <FrontierPage view={route.view} participant={route.participant} />;
    default:
      return null;
  }
}
