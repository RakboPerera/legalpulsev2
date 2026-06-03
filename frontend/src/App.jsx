import React from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import Sidebar from './components/Sidebar.jsx';
import RunSwitcher from './components/RunSwitcher.jsx';
import { workspaces as wsApi } from './api.js';
import Overview from './pages/Overview.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Outreach from './pages/Outreach.jsx';
import ActiveProspects from './pages/ActiveProspects.jsx';
import MarketScreening from './pages/MarketScreening.jsx';
import EventDetail from './pages/EventDetail.jsx';
import OpportunityDetail from './pages/OpportunityDetail.jsx';
import Clients from './pages/Clients.jsx';
import ClientDetail from './pages/ClientDetail.jsx';
import Matters from './pages/Matters.jsx';
import Signals from './pages/Signals.jsx';
import AuditTrail from './pages/AuditTrail.jsx';
import ReasoningTrail from './pages/ReasoningTrail.jsx';
import Sources from './pages/Sources.jsx';
import Setup from './pages/Setup.jsx';
import Settings from './pages/Settings.jsx';
import EventInquiry from './pages/EventInquiry.jsx';
import KpiDashboard from './pages/KpiDashboard.jsx';
import OperationalInsights from './pages/OperationalInsights.jsx';
import { WorkspaceProvider, useWorkspace } from './components/WorkspaceContext.jsx';

function WorkspaceRoute({ Component }) {
  const { id } = useParams();
  const { selectWorkspace, currentId } = useWorkspace();
  React.useEffect(() => { if (id && id !== currentId) selectWorkspace(id); }, [id, currentId, selectWorkspace]);
  return <Component />;
}

function DemoBanner() {
  const { current, currentId, refreshCurrent } = useWorkspace();
  const [reloading, setReloading] = React.useState(false);
  if (current?.mode !== 'demo') return null;
  // The reload button is a developer convenience for pulling in a fresh
  // snapshot during demo prep. Hidden by default — a partner has no use for
  // it and the copy ("Reload from latest bake") leaks engineering language.
  // Append ?dev=1 to the URL or set localStorage.lpDev=1 to surface it.
  const devVisible =
    typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).get('dev') === '1' ||
      window.localStorage?.getItem('lpDev') === '1');
  const handleReload = async () => {
    if (reloading || !currentId) return;
    setReloading(true);
    try {
      await wsApi.reloadSnapshot(currentId);
      await refreshCurrent();
      window.location.reload();
    } catch (err) {
      alert(`Refresh failed: ${err.response?.data?.message || err.response?.data?.error || err.message}`);
      setReloading(false);
    }
  };
  const opps = current.counts?.opportunities || 0;
  const signals = current.counts?.signals || 0;
  return (
    <div className="demo-banner">
      <span>
        <strong>Sample workspace</strong> — {current.firmProfile?.name || 'Hartwell & Stone LLP'} is a fictional firm; the 15 clients and prospects are real public companies and the signals (EDGAR filings, court records, news) are real.
      </span>
      <span className="demo-banner-meta">
        {opps} opportunit{opps === 1 ? 'y' : 'ies'} · {signals.toLocaleString()} signal{signals === 1 ? '' : 's'}
        {devVisible && (
          <button
            onClick={handleReload}
            disabled={reloading}
            className="demo-banner-reload"
            title="Developer: re-read data/demo-snapshot.json from disk"
          >
            <RefreshCw size={12} className={reloading ? 'spin' : ''} />
            {reloading ? ' Refreshing…' : ' Refresh sample'}
          </button>
        )}
      </span>
    </div>
  );
}

// In-app shell: sidebar + main. The chat pane was removed (chat is now
// scoped per-opportunity inside OpportunityDetail). The marketing landing
// at / renders outside this shell so it can be a clean full-bleed page.
// Strip between banners and main content — surfaces the run switcher when
// pipeline history exists. Renders nothing otherwise (component returns
// null when there's no history), so the gap collapses for new workspaces.
function RunStrip() {
  return (
    <div className="run-strip">
      <RunSwitcher />
    </div>
  );
}

function Shell() {
  return (
    <div className="app-shell app-shell-no-chat">
      <Sidebar />
      <main className="main">
        <DemoBanner />
        <RunStrip />
        <div className="main-inner">
          <Routes>
            <Route path="/setup" element={<Setup />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/overview" element={<Overview />} />
            <Route path="/workspaces/:id/overview" element={<WorkspaceRoute Component={Overview} />} />
            <Route path="/workspaces/:id" element={<WorkspaceRoute Component={Dashboard} />} />
            <Route path="/workspaces/:id/outreach" element={<WorkspaceRoute Component={Outreach} />}>
              <Route index element={<ActiveProspects />} />
              <Route path="screening" element={<MarketScreening />} />
              <Route path="screening/:eventKey" element={<EventDetail />} />
              <Route path="inquiry" element={<EventInquiry />} />
            </Route>
            <Route path="/workspaces/:id/event-inquiry" element={<WorkspaceRoute Component={EventInquiry} />} />
            <Route path="/workspaces/:id/opportunities/:oid" element={<WorkspaceRoute Component={OpportunityDetail} />} />
            <Route path="/workspaces/:id/clients" element={<WorkspaceRoute Component={Clients} />} />
            <Route path="/workspaces/:id/clients/:cid" element={<WorkspaceRoute Component={ClientDetail} />} />
            <Route path="/workspaces/:id/matters" element={<WorkspaceRoute Component={Matters} />} />
            <Route path="/workspaces/:id/signals" element={<WorkspaceRoute Component={Signals} />} />
            <Route path="/workspaces/:id/audit" element={<WorkspaceRoute Component={AuditTrail} />} />
            <Route path="/workspaces/:id/reasoning" element={<WorkspaceRoute Component={ReasoningTrail} />} />
            <Route path="/workspaces/:id/sources" element={<WorkspaceRoute Component={Sources} />} />
            <Route path="/workspaces/:id/kpi" element={<WorkspaceRoute Component={KpiDashboard} />} />
            <Route path="/workspaces/:id/insights" element={<WorkspaceRoute Component={OperationalInsights} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <WorkspaceProvider>
      <Routes>
        {/* Skip the standalone landing — open straight to the in-shell overview. */}
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/*" element={<Shell />} />
      </Routes>
    </WorkspaceProvider>
  );
}
