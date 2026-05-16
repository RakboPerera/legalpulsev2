import React from 'react';

// Reusable 0-100 confidence indicator. Two visual variants:
//   compact (default): inline bar + numeric score
//   detailed:          adds a per-dimension hover tooltip via title attribute
//
// Color band: ≥80 green, 60-79 amber, <60 red.
export default function ConfidenceBar({ score, dims = null, label = null, width = 140 }) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  const band = s >= 80 ? 'good' : s >= 60 ? 'caution' : 'weak';
  // Tooltip explains the scale and shows per-dimension breakdown when present.
  // Without this, partners see a bare number with no idea what 0.45 means vs 0.85.
  const bandText = band === 'good' ? 'High confidence (≥80) — source signal is recent and named, claim is supported.'
    : band === 'caution' ? 'Moderate (60–79) — usable for a working brief; review the supporting signals before pitching.'
    : 'Low (<60) — treat as monitoring/early lead; not pitch-ready.';
  const dimsText = dims
    ? Object.entries(dims)
        .map(([k, v]) => `${k}: ${Math.round((v || 0) * 100)}%`)
        .join(' · ')
    : null;
  const tooltip = dimsText ? `${bandText}\n\nBreakdown: ${dimsText}` : bandText;
  return (
    <span className={`confidence-bar conf-${band}`} title={tooltip || undefined} style={{ width }}>
      <span className="confidence-fill" style={{ width: `${s}%` }} />
      <span className="confidence-label">{label || `${s}/100`}</span>
    </span>
  );
}
