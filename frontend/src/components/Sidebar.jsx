import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Briefcase, Building2, Radio, ScrollText, Settings, UserPlus, BookOpen, BarChart3, AlertTriangle, GitBranch, Key, Sparkles, Globe } from 'lucide-react';
import { useWorkspace } from './WorkspaceContext.jsx';
import { opportunities as oppApi } from '../api.js';

export default function Sidebar() {
  const { list, currentId, loading, createWorkspace } = useWorkspace();
  const [counts, setCounts] = useState({ existing: 0, outreach: 0 });
  const navigate = useNavigate();
  const location = useLocation();
  const autoCreateRef = useRef(false);

  useEffect(() => {
    if (!currentId) { setCounts({ existing: 0, outreach: 0 }); return; }
    oppApi.list(currentId, { limit: 500 })
      .then(r => {
        const opps = r.opportunities || [];
        setCounts({
          existing: opps.filter(o => o.entityType === 'client').length,
          outreach: opps.filter(o => o.entityType === 'prospect').length
        });
      })
      .catch(() => setCounts({ existing: 0, outreach: 0 }));
  }, [currentId]);

  // Auto-create a demo workspace ONLY when:
  //   - workspace list has finished loading (avoid the [] race during initial fetch),
  //   - it's actually empty,
  //   - we haven't already kicked one off this session.
  // Land on the in-shell Overview so the URL matches the user's intent (App.jsx
  // redirects `/` → `/overview`); navigating to the dashboard fights that.
  useEffect(() => {
    if (loading) return;
    if (autoCreateRef.current) return;
    if (!list || list.length > 0) return;
    autoCreateRef.current = true;
    const landingPath = location.pathname.startsWith('/overview') ? '/overview' : null;
    createWorkspace({ mode: 'demo' })
      .then(ws => navigate(landingPath ? `/workspaces/${ws.id}/overview` : `/workspaces/${ws.id}/overview`, { replace: true }))
      .catch(err => {
        autoCreateRef.current = false;
        console.warn('auto-create demo workspace failed', err);
      });
  }, [loading, list, createWorkspace, navigate, location.pathname]);

  return (
    <aside className="sidebar">
      <div className="sidebar-product">LegalPulse</div>

      <div className="nav-section">About</div>
      <NavLink
        to={currentId ? `/workspaces/${currentId}/overview` : '/overview'}
        className="sidebar-overview-link"
      >
        <BookOpen size={16} /> <span className="nav-label">Overview</span>
      </NavLink>

      {currentId && (
        <>
          <div className="nav-section">Commercial Health</div>
          <NavLink to={`/workspaces/${currentId}/kpi`}>
            <BarChart3 size={16} /> <span className="nav-label">KPI Dashboard</span>
          </NavLink>
          <NavLink to={`/workspaces/${currentId}/insights`}>
            <AlertTriangle size={16} /> <span className="nav-label">Operational Insights</span>
          </NavLink>

          <div className="nav-section">Opportunities</div>
          <NavLink to={`/workspaces/${currentId}`} end>
            <Building2 size={16} />
            <span className="nav-label">Existing Clients</span>
            <span className="nav-count">{counts.existing}</span>
          </NavLink>
          <NavLink to={`/workspaces/${currentId}/outreach`}>
            <UserPlus size={16} />
            <span className="nav-label">New Client Outreach</span>
            <span className="nav-count">{counts.outreach}</span>
          </NavLink>
          <NavLink to={`/workspaces/${currentId}/event-inquiry`}>
            <Sparkles size={16} />
            <span className="nav-label">Event Inquiry</span>
          </NavLink>

          <div className="nav-section">Workspace</div>
          <NavLink to={`/workspaces/${currentId}/clients`}><Building2 size={16} /> <span className="nav-label">Clients & Prospects</span></NavLink>
          <NavLink to={`/workspaces/${currentId}/matters`}><Briefcase size={16} /> <span className="nav-label">Matters</span></NavLink>
          <NavLink to={`/workspaces/${currentId}/signals`}><Radio size={16} /> <span className="nav-label">Signals</span></NavLink>
          <NavLink to={`/workspaces/${currentId}/reasoning`}><GitBranch size={16} /> <span className="nav-label">Signal &amp; reasoning audit</span></NavLink>
          <NavLink to={`/workspaces/${currentId}/sources`}><Globe size={16} /> <span className="nav-label">Signals &amp; sources</span></NavLink>
        </>
      )}

      <div className="nav-section">Account</div>
      <NavLink to="/settings"><Key size={16} /> <span className="nav-label">Settings</span></NavLink>

      <div className="sidebar-footer">
        <img src="/octave-logo.png" alt="Octave" className="sidebar-octave-logo" />
      </div>
    </aside>
  );
}
