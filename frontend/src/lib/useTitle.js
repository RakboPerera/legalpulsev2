import { useEffect } from 'react';

// Set document.title per page so partners with multiple tabs open can tell
// them apart. A bare suffix ("· LegalPulse") sits on every title so the
// product is identifiable even when the page-specific part is truncated.
const SUFFIX = ' · LegalPulse';

export function useTitle(title) {
  useEffect(() => {
    if (!title) return;
    const prev = document.title;
    document.title = title.endsWith(SUFFIX) ? title : (title + SUFFIX);
    return () => { document.title = prev; };
  }, [title]);
}
