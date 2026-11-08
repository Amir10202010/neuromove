// Экраны приложения — отдельный кусок сборки: App.tsx загружает его лениво (React.lazy), а со стартовой
// страницы — заранее, в свободное время. Здесь всё, что видит специалист: каркас с меню, экраны,
// знакомство, лист печати, отчёт для семьи и окно «Сеанс был прерван».

import { AnalyticsPage } from '../features/analytics/AnalyticsPage';
import { DevicesPage } from '../features/devices/DevicesPage';
import { NotFoundPage } from '../features/NotFoundPage';
import { OnboardingPage } from '../features/onboarding/OnboardingPage';
import { OverviewPage } from '../features/overview/OverviewPage';
import { FamilyReportPage } from '../features/patients/FamilyReportPage';
import { PatientPage } from '../features/patients/PatientPage';
import { PatientsPage } from '../features/patients/PatientsPage';
import { PrintReportPage } from '../features/report/PrintReportPage';
import { SessionReportPage } from '../features/report/SessionReportPage';
import { RecoveryDialog } from '../features/session/RecoveryDialog';
import { SessionRunPage } from '../features/session/SessionRunPage';
import { SessionSetupPage } from '../features/session/SessionSetupPage';
import { SessionsPage } from '../features/sessions/SessionsPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { AppShell } from '../layout/AppShell';
import { ResearchPage } from '../features/research/ResearchPage';
import { ProtocolStudio } from '../features/research/ProtocolStudio';
import { ValidationSetup } from '../features/research/ValidationSetup';
import { ValidationSessionPage } from '../features/research/ValidationSessionPage';
import { DatasetsPage } from '../features/research/DatasetsPage';
import { FigureLook } from '../figures/look';
import { useAppStore } from '../state/appStore';
import { useSessionStore } from '../state/sessionStore';
import { RehabDashboard } from '../features/rehab/RehabDashboard';
import { ParticipantRehabPage } from '../features/rehab/ParticipantRehabPage';
import { ActivityLibraryPage } from '../features/rehab/ActivityLibraryPage';
import { StudiesPage } from '../features/rehab/StudiesPage';
import { FamilyHomePage } from '../features/rehab/FamilyHomePage';
import { ChildPlayPage } from '../features/rehab/ChildPlayPage';
import { CaregiverGate } from '../features/rehab/CaregiverGate';
import { ErrorBoundary } from './ErrorBoundary';
import { lazy, Suspense } from 'react';

// Motor-learning lab: its own chunk, loaded on first visit (src/features/motorlab)
const MotorLabRoute = lazy(() => import('../features/motorlab/MotorLabRoute'));
import type { Route } from './router';

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case 'overview':
      return <OverviewPage />;
    case 'patients':
      return <PatientsPage />;
    case 'patient':
      return <PatientPage id={route.id} tab={route.tab} />;
    case 'sessionNew':
      return <SessionSetupPage patientId={route.patientId} protocol={route.protocol ?? null} />;
    case 'sessionRun':
      return <SessionRunPage />;
    case 'sessions':
      return <SessionsPage />;
    case 'session':
      return <SessionReportPage id={route.id} complete={route.complete} />;
    case 'analytics':
      return <AnalyticsPage />;
    case 'devices':
      return <DevicesPage />;
    case 'settings':
      return <SettingsPage />;
    case 'research':
      return <ResearchPage />;
    case 'researchProtocols':
      return <ProtocolStudio />;
    case 'researchNew':
      return <ValidationSetup protocolKey={route.protocolKey} />;
    case 'researchSession':
      return <ValidationSessionPage id={route.id} />;
    case 'researchDatasets':
      return <DatasetsPage />;
    case 'labOverview':
    case 'labLearning':
    case 'labTwin':
    case 'labMovement':
    case 'labDesigner':
    case 'labRuns':
    case 'labRun':
    case 'labReadiness':
    case 'labCoordination':
      return (
        <Suspense fallback={<div className="page" aria-busy="true" />}>
          <MotorLabRoute route={route} />
        </Suspense>
      );
    case 'rehab':
      return <RehabDashboard />;
    case 'rehabParticipant':
      return <ParticipantRehabPage id={route.id} tab={route.tab} reviewId={route.review} />;
    case 'rehabActivities':
      return <ActivityLibraryPage />;
    case 'rehabStudies':
      return <StudiesPage />;
    default:
      return <NotFoundPage />;
  }
}

/** Пол пациента открытого экрана — рисунки показывают мальчика или девочку (figures/look.tsx). */
function useRouteSex(route: Route) {
  const patients = useAppStore((s) => s.patients);
  const sessions = useAppStore((s) => s.sessions);
  const runPatient = useSessionStore((s) => s.controller?.setup.patientId ?? null);
  let id: string | null = null;
  if (route.name === 'patient' || route.name === 'family') id = route.id;
  else if (route.name === 'sessionNew') id = route.patientId;
  else if (route.name === 'sessionRun') id = runPatient;
  else if (route.name === 'session' || route.name === 'sessionPrint') id = sessions.find((s) => s.id === route.id)?.patientId ?? null;
  return id ? patients.find((p) => p.id === id)?.sex ?? null : null;
}

export default function Workspace({ route }: { route: Route }) {
  const sex = useRouteSex(route);
  let content;
  if (route.name === 'onboarding') content = <OnboardingPage />;
  else if (route.name === 'sessionPrint') content = <PrintReportPage id={route.id} />;
  else if (route.name === 'family') content = <FamilyReportPage id={route.id} />;
  // Family and child screens: their own calm shell, no professional navigation (shared tablets)
  else if (route.name === 'familyHome') content = <ErrorBoundary resetKey={JSON.stringify(route)}><FamilyHomePage id={route.id} /></ErrorBoundary>;
  else if (route.name === 'childPlay') content = <ErrorBoundary resetKey={JSON.stringify(route)}><ChildPlayPage id={route.id} /></ErrorBoundary>;
  else
    content = (
      <CaregiverGate>
        <AppShell>
          <ErrorBoundary resetKey={JSON.stringify(route)}>
            <Page route={route} />
          </ErrorBoundary>
        </AppShell>
      </CaregiverGate>
    );

  return (
    <FigureLook sex={sex}>
      {content}
      <RecoveryDialog />
    </FigureLook>
  );
}
