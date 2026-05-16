import React from 'react';
import OppBoard from '../components/OppBoard.jsx';
import { useTitle } from '../lib/useTitle.js';

// Existing-clients board: cross-sell + event-driven opportunities on the
// existing client book. Driven by internal coverage data and market news
// affecting clients we already serve.
export default function Dashboard() {
  useTitle('Existing clients');
  return <OppBoard mode="existing" />;
}
