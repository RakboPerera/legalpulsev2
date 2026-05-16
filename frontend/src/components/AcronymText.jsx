import React, { useState, useRef, useEffect } from 'react';
import { ACRONYM_REGEX, lookupAcronym } from '../lib/acronyms.js';

/**
 * Renders a string and wraps any known acronyms in clickable definition pills.
 *
 * Pass either `children` (a string) or `text` (a string). Non-string children
 * are passed through unchanged so it composes safely inside JSX.
 *
 * Example:
 *   <AcronymText>BP plc faces OFAC SDN match in EU jurisdictions.</AcronymText>
 * Renders: "BP plc faces [OFAC] [SDN] match in [EU] jurisdictions." with each
 * bracketed token clickable.
 */
export default function AcronymText({ children, text, as: Tag = 'span' }) {
  const input = typeof text === 'string' ? text : children;
  if (typeof input !== 'string') return <Tag>{children ?? text}</Tag>;
  return <Tag>{tokenize(input)}</Tag>;
}

function tokenize(str) {
  // Reset regex state — the constant is /g so lastIndex matters across calls.
  ACRONYM_REGEX.lastIndex = 0;
  const out = [];
  let lastIdx = 0;
  let match;
  let key = 0;
  while ((match = ACRONYM_REGEX.exec(str)) !== null) {
    if (match.index > lastIdx) {
      out.push(str.slice(lastIdx, match.index));
    }
    const term = match[1];
    out.push(<AcronymPill key={`a-${key++}-${match.index}`} term={term} />);
    lastIdx = match.index + term.length;
  }
  if (lastIdx < str.length) out.push(str.slice(lastIdx));
  return out;
}

function AcronymPill({ term }) {
  const def = lookupAcronym(term);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = e => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!def) return <>{term}</>;

  const handleClick = e => {
    // Don't bubble up — links wrapping cards should not navigate when the
    // user clicks an acronym.
    e.preventDefault();
    e.stopPropagation();
    setOpen(o => !o);
  };

  return (
    <span className="acronym-wrap" ref={ref}>
      <button
        type="button"
        className={`acronym-pill ${open ? 'acronym-pill-open' : ''}`}
        onClick={handleClick}
        title={`${def.expansion} — click for definition`}
        aria-label={`Definition of ${term}: ${def.expansion}`}
      >
        {term}
      </button>
      {open && (
        <span className="acronym-popover" role="dialog" aria-label={`Definition of ${term}`}>
          <span className="acronym-popover-term">{term}</span>
          <span className="acronym-popover-expansion">{def.expansion}</span>
          <span className="acronym-popover-desc">{def.description}</span>
        </span>
      )}
    </span>
  );
}
