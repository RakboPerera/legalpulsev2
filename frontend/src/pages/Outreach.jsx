import React from 'react';
import { NavLink, Outlet, useParams } from 'react-router-dom';

// Outreach is now a tabbed parent layout. The default tab (index route)
// renders the existing prospect/event opp board; the second tab renders
// the new Market Screening tool. Child routes are wired in App.jsx.
export default function Outreach() {
  const { id } = useParams();
  const base = `/workspaces/${id}/outreach`;
  return (
    <div>
      <div className="outreach-tabs">
        <NavLink to={base} end className={({ isActive }) => `outreach-tab ${isActive ? 'active' : ''}`}>
          Active Prospects
        </NavLink>
        <NavLink to={`${base}/screening`} className={({ isActive }) => `outreach-tab ${isActive ? 'active' : ''}`}>
          Market Screening
        </NavLink>
        <NavLink to={`${base}/inquiry`} className={({ isActive }) => `outreach-tab ${isActive ? 'active' : ''}`}>
          Event Inquiry
        </NavLink>
      </div>
      <Outlet />
    </div>
  );
}
