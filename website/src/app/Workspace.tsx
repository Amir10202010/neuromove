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
import { ErrorBoundary } from './ErrorBoundary';
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
    default:
      return <NotFoundPage />;
  }
}

export default function Workspace({ route }: { route: Route }) {
  let content;
  if (route.name === 'onboarding') content = <OnboardingPage />;
  else if (route.name === 'sessionPrint') content = <PrintReportPage id={route.id} />;
  else if (route.name === 'family') content = <FamilyReportPage id={route.id} />;
  else
    content = (
      <AppShell>
        <ErrorBoundary resetKey={JSON.stringify(route)}>
          <Page route={route} />
        </ErrorBoundary>
      </AppShell>
    );

  return (
    <>
      {content}
      <RecoveryDialog />
    </>
  );
}
