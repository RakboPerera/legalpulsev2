import React from 'react';
import OverviewContent from '../components/OverviewContent.jsx';
import { useTitle } from '../lib/useTitle.js';

// In-shell Overview page. Same content as the standalone landing, rendered
// inside the workspace shell behind the sidebar Overview tab. Used during
// product pitches: open it side-by-side with the live opportunity board.
export default function Overview() {
  useTitle('Overview');
  return <OverviewContent variant="embedded" />;
}
