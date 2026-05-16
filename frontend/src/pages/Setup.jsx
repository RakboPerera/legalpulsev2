import React, { useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Key, Upload, FileText, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useWorkspace } from '../components/WorkspaceContext.jsx';
import { workspaces as wsApi } from '../api.js';
import { useTitle } from '../lib/useTitle.js';

const CLIENTS_TEMPLATE =
  'legalName,knownAliases,sector,hqJurisdiction,size,publicEntityUrl\n' +
  '"Example Corp Ltd","Example;ExampleCo",technology,UK,mid,https://example.com\n' +
  '"Another Co plc","Another",financial_services,UK,large,https://another.example\n';

const MATTERS_TEMPLATE =
  'matterTitle,clientLegalName,practiceArea,leadPartner,status,startDate,feesBilled,currency,services\n' +
  '"Antitrust advisory — UK CMA Phase 1","Example Corp Ltd",competition,Smith,open,2026-04-01,250000,GBP,uk_competition\n' +
  '"Securities class action defense","Another Co plc",litigation_disputes,Jones,closed_won,2024-09-12,420000,GBP,"securities_litigation;regulatory_defense"\n';

function downloadCsv(name, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function Setup() {
  useTitle('Get started');
  const navigate = useNavigate();
  const { createWorkspace } = useWorkspace();
  const [firmName, setFirmName] = useState('');
  const [clientsFile, setClientsFile] = useState(null);
  const [mattersFile, setMattersFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const clientsInputRef = useRef(null);
  const mattersInputRef = useRef(null);

  const startDemo = async () => {
    setBusy(true);
    setError(null);
    try {
      const ws = await createWorkspace({ mode: 'demo' });
      navigate(`/workspaces/${ws.id}`);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally { setBusy(false); }
  };

  const startUserMode = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const ws = await createWorkspace({ mode: 'user_input', name: firmName || 'My Firm' });
      if (clientsFile || mattersFile) {
        const form = new FormData();
        if (clientsFile) form.append('clients', clientsFile);
        if (mattersFile) form.append('matters', mattersFile);
        try {
          const ingest = await wsApi.ingestCsv(ws.id, form);
          setResult({ workspaceId: ws.id, ...ingest });
          // If everything imported cleanly, jump to the workspace. If there
          // were errors, hold on the result so the user can review them.
          const hasErrors =
            (ingest.summary?.clients?.errors?.length || 0) > 0 ||
            (ingest.summary?.matters?.errors?.length || 0) > 0;
          if (!hasErrors) {
            setTimeout(() => navigate(`/workspaces/${ws.id}`), 1200);
          }
        } catch (err) {
          // Workspace was created; CSV import failed. Surface the error but
          // give the user a clear next step rather than orphaning the workspace.
          setError(err.response?.data?.message || err.message);
          setResult({ workspaceId: ws.id, summary: null });
        }
      } else {
        navigate(`/workspaces/${ws.id}`);
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally { setBusy(false); }
  };

  return (
    <div style={{ maxWidth: 820 }}>
      <h1>LegalPulse</h1>
      <p className="caption">Agentic BD intelligence for legal teams. Pick a starting mode.</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 24 }}>
        <div className="panel">
          <h3 style={{ color: '#fff', marginBottom: 8 }}>Demo workspace</h3>
          <p style={{ color: 'var(--octave-n300)', fontSize: 14 }}>
            Hartwell &amp; Stone LLP — a fictional firm seeded with 15 public-company clients and 13 prospects.
            External signals are real.
          </p>
          <div style={{ marginTop: 20 }}>
            <button className="btn btn-accent" onClick={startDemo} disabled={busy}>
              {busy ? 'Opening…' : 'Open demo'}
            </button>
          </div>
        </div>

        <div style={{ border: '1px solid var(--octave-n300)', borderRadius: 16, padding: 28 }}>
          <h3 style={{ marginBottom: 8 }}>Your firm</h3>
          <p style={{ color: 'var(--octave-text-muted)', fontSize: 14, marginBottom: 16 }}>
            Upload clients and matters as CSV to start with your own data. Both files are optional —
            you can skip and add data later.
          </p>

          <label className="caption" style={{ display: 'block', marginBottom: 4 }}>Firm name</label>
          <input
            className="input"
            placeholder="e.g. Hartwell &amp; Stone LLP"
            value={firmName}
            onChange={e => setFirmName(e.target.value)}
            style={{ marginBottom: 16, width: '100%' }}
            disabled={busy}
          />

          <FilePickerRow
            label="Clients CSV"
            sublabel="Columns: legalName (required), knownAliases, sector, hqJurisdiction, size, publicEntityUrl"
            file={clientsFile}
            onPick={setClientsFile}
            onTemplate={() => downloadCsv('clients-template.csv', CLIENTS_TEMPLATE)}
            inputRef={clientsInputRef}
            disabled={busy}
          />
          <div style={{ height: 12 }} />
          <FilePickerRow
            label="Matters CSV"
            sublabel="Columns: matterTitle, clientLegalName (must match a client), practiceArea, leadPartner, status, feesBilled, currency"
            file={mattersFile}
            onPick={setMattersFile}
            onTemplate={() => downloadCsv('matters-template.csv', MATTERS_TEMPLATE)}
            inputRef={mattersInputRef}
            disabled={busy}
          />

          {error && (
            <div className="banner-warn" style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
              <AlertCircle size={14} /> {error}
            </div>
          )}
          {result?.summary && (
            <ImportSummary
              summary={result.summary}
              counts={result.counts}
              onOpen={() => navigate(`/workspaces/${result.workspaceId}`)}
            />
          )}

          <button
            className="btn btn-primary"
            onClick={startUserMode}
            disabled={busy}
            style={{ marginTop: 16 }}
          >
            {busy ? 'Creating workspace…' : 'Create workspace'}
          </button>
        </div>
      </div>

      <div style={{
        marginTop: 32,
        padding: 16,
        border: '1px solid var(--octave-n300)',
        borderRadius: 12,
        display: 'flex', alignItems: 'center', gap: 12,
        color: 'var(--octave-text-muted)'
      }}>
        <Key size={18} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, color: '#fff', marginBottom: 2 }}>LLM provider key</div>
          <div style={{ fontSize: 13 }}>
            Configure your Anthropic, OpenAI, or DeepSeek key in{' '}
            <Link to="/settings" style={{ color: 'var(--octave-accent)' }}>Settings → API Keys</Link>{' '}
            to enable chat, briefings, and engine runs.
          </div>
        </div>
      </div>
    </div>
  );
}

function FilePickerRow({ label, sublabel, file, onPick, onTemplate, inputRef, disabled }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label className="caption" style={{ fontWeight: 500 }}>{label}</label>
        <button type="button" className="btn-link" onClick={onTemplate} disabled={disabled}>
          <FileText size={12} /> Download template
        </button>
      </div>
      <div className="caption" style={{ marginTop: 2, marginBottom: 6 }}>{sublabel}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
        >
          <Upload size={14} /> {file ? 'Replace' : 'Choose file'}
        </button>
        <span style={{ fontSize: 13, color: 'var(--octave-text-muted)' }}>
          {file ? `${file.name} · ${(file.size / 1024).toFixed(1)} KB` : 'No file chosen'}
        </span>
        {file && (
          <button type="button" className="btn-link" onClick={() => onPick(null)} disabled={disabled}>
            Remove
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: 'none' }}
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

function ImportSummary({ summary, counts, onOpen }) {
  const cErrors = summary.clients?.errors || [];
  const mErrors = summary.matters?.errors || [];
  const totalErrors = cErrors.length + mErrors.length;
  return (
    <div style={{ marginTop: 14, padding: 12, border: '1px solid var(--octave-n300)', borderRadius: 8, background: 'var(--octave-n100)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {totalErrors === 0
          ? <><CheckCircle2 size={16} className="audit-stat-good" /><strong>Import complete</strong></>
          : <><AlertCircle size={16} /><strong>Imported with {totalErrors} row error{totalErrors === 1 ? '' : 's'}</strong></>}
      </div>
      <div className="caption">
        Clients added: <strong>{summary.clients?.added ?? 0}</strong>
        {summary.clients?.skipped ? ` · skipped ${summary.clients.skipped}` : ''}
        {' · '}Matters added: <strong>{summary.matters?.added ?? 0}</strong>
        {summary.matters?.skipped ? ` · skipped ${summary.matters.skipped}` : ''}
      </div>
      {counts && (
        <div className="caption" style={{ marginTop: 2 }}>
          Workspace now holds {counts.clientsAfter} client{counts.clientsAfter === 1 ? '' : 's'} and {counts.mattersAfter} matter{counts.mattersAfter === 1 ? '' : 's'}.
        </div>
      )}
      {totalErrors > 0 && (
        <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 18, fontSize: 12, maxHeight: 160, overflowY: 'auto' }}>
          {cErrors.slice(0, 12).map((e, i) => <li key={'c' + i}>clients.csv row {e.row}: {e.message}</li>)}
          {mErrors.slice(0, 12).map((e, i) => <li key={'m' + i}>matters.csv row {e.row}: {e.message}</li>)}
          {totalErrors > 24 && <li className="caption">…and {totalErrors - 24} more.</li>}
        </ul>
      )}
      <button className="btn btn-secondary" onClick={onOpen} style={{ marginTop: 10 }}>
        Open workspace
      </button>
    </div>
  );
}
