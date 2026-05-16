import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { workspaces, version, runs as runsApi } from '../api.js';

const Ctx = createContext(null);

export function WorkspaceProvider({ children }) {
  const [list, setList] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [current, setCurrent] = useState(null);
  const [bakeMeta, setBakeMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  // === Phase 4: pipeline run history viewing ===
  // viewingRunId === null OR 'live' means show the live workspace state.
  // Any other value is the archived run's id from workspace.pipelineRunHistory.
  // Components that read opps/signals/briefings thread this into their API
  // calls as `?runId=<viewingRunId>` so the server returns the matching
  // historical snapshot. runsList is the dropdown source; refreshed when
  // the workspace changes or a new pipeline run completes.
  const [viewingRunId, setViewingRunId] = useState(null);
  const [runsList, setRunsList] = useState({ live: null, history: [] });

  const refreshList = useCallback(async () => {
    try {
      const items = await workspaces.list();
      setList(items);
      if (!currentId && items.length) setCurrentId(items[0].id);
      return items;
    } catch (err) {
      console.warn('workspace list failed', err);
      return [];
    }
  }, [currentId]);

  const refreshCurrent = useCallback(async () => {
    if (!currentId) { setCurrent(null); return; }
    try {
      const ws = await workspaces.get(currentId);
      setCurrent(ws);
    } catch (err) {
      console.warn('workspace get failed', err);
    }
  }, [currentId]);

  const refreshRuns = useCallback(async () => {
    if (!currentId) { setRunsList({ live: null, history: [] }); return; }
    try {
      const data = await runsApi.list(currentId);
      setRunsList({ live: data.live, history: data.history || [] });
    } catch (err) {
      // Non-fatal — the switcher just shows "Live" only when history fetch fails.
      console.warn('runs list failed', err);
      setRunsList({ live: null, history: [] });
    }
  }, [currentId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const v = await version();
        setBakeMeta(v.bake);
      } catch {}
      await refreshList();
      setLoading(false);
    })();
  }, [refreshList]);

  useEffect(() => { refreshCurrent(); }, [refreshCurrent]);
  useEffect(() => { refreshRuns(); }, [refreshRuns]);

  // When the user switches workspaces, reset viewing to live — they'd be
  // confused if a stale historical-runId persisted into a different workspace
  // that doesn't have that run id at all.
  useEffect(() => { setViewingRunId(null); }, [currentId]);

  const selectWorkspace = id => setCurrentId(id);

  const createWorkspace = async payload => {
    const ws = await workspaces.create(payload);
    await refreshList();
    setCurrentId(ws.id);
    return ws;
  };

  // Convenience derived value: are we currently viewing a historical run?
  // Used by pages that want to render a read-only badge.
  const isViewingHistorical = !!viewingRunId && viewingRunId !== 'live';

  return (
    <Ctx.Provider value={{
      list, current, currentId, bakeMeta, loading,
      refreshList, refreshCurrent, selectWorkspace, createWorkspace, setCurrent,
      // Phase 4 run history
      viewingRunId, setViewingRunId, isViewingHistorical,
      runsList, refreshRuns
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useWorkspace() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkspace must be inside WorkspaceProvider');
  return v;
}
