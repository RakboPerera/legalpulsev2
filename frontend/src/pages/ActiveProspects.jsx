import React from 'react';
import OppBoard from '../components/OppBoard.jsx';
import { useTitle } from '../lib/useTitle.js';

// "Active Prospects" tab — the existing prospect-discovery + event-driven
// opportunity board for prospects, unchanged. Sits as the default child
// of the Outreach tabbed layout.
export default function ActiveProspects() {
  useTitle('New client outreach');
  return <OppBoard mode="outreach" />;
}
