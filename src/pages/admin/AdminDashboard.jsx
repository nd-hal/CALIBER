import React, { useState, useEffect, useCallback, useRef } from 'react';
import './admin.css';

function api(path, options, token) {
  return fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options?.headers || {}) },
  }).then(async r => {
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || r.statusText);
    return d;
  });
}

export default function AdminDashboard({ token, role, username, onLogout }) {
  const [tab, setTab] = useState('progress');

  return (
    <div className="adm-shell">
      <header className="adm-header">
        <span className="adm-brand">CALIBER-full — Admin</span>
        <div className="adm-header-right">
          <span className="adm-user">{username} ({role})</span>
          <button className="adm-btn-sm" onClick={onLogout}>Sign out</button>
        </div>
      </header>

      <nav className="adm-nav">
        {[
          'progress',
          'insights',
          'time',
          'sona-items',
          'config',
          'export',
          ...(role === 'super_admin' ? ['active', 'accounts', 'danger'] : []),
        ].map(t => (
          <button
            key={t}
            className={`adm-tab ${tab === t ? 'active' : ''}${t === 'danger' ? ' adm-tab-danger' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'sona-items' ? 'SONA Items' : t === 'danger' ? 'Danger Zone' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      <main className="adm-main">
        {tab === 'progress'   && <ProgressTab   token={token} role={role} />}
        {tab === 'insights'   && <InsightsTab   token={token} />}
        {tab === 'time'       && <TimeTab       token={token} />}
        {tab === 'export'     && <ExportTab     token={token} />}
        {tab === 'sona-items' && <SonaItemsTab  token={token} />}
        {tab === 'config'     && <ConfigTab     token={token} />}
        {tab === 'active'     && <ActiveTab     token={token} />}
        {tab === 'accounts'   && <AccountsTab   token={token} currentUsername={username} />}
        {tab === 'danger'     && <DangerTab     token={token} />}
      </main>
    </div>
  );
}

// ── Progress ──────────────────────────────────────────────────────────────────
function ProgressTab({ token, role }) {
  const [data, setData]       = useState(null);
  const [timeMap, setTimeMap] = useState({}); // prolific_id -> total_ms
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [resetting, setResetting] = useState({});
  const [resetMsg, setResetMsg]   = useState({});
  const [search, setSearch]       = useState('');
  const [filterStatus, setFilterStatus]       = useState('all'); // all | not_started | in_progress | complete | submitted
  const [filterTask, setFilterTask]           = useState('all'); // all | task1..task5 (milestone reached)
  const [filterSubmitted, setFilterSubmitted] = useState('all'); // all | yes | no

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api('/api/admin/progress', {}, token).then(setData),
      api('/api/admin/time-spent', {}, token)
        .then(t => setTimeMap(Object.fromEntries(t.annotators.map(a => [a.prolific_id, a.total_ms]))))
        .catch(() => setTimeMap({})), // non-fatal — table still loads without time
    ])
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function resetAnnotator(prolific_id) {
    if (!window.confirm(`Reset ALL annotation data for "${prolific_id}"?\n\nThis deletes their grades and highlights but keeps their survey, tutorial, and assignment.`)) return;
    setResetting(r => ({ ...r, [prolific_id]: true }));
    setResetMsg(m => ({ ...m, [prolific_id]: '' }));
    try {
      const d = await api(`/api/admin/annotators/${prolific_id}/reset`, { method: 'POST' }, token);
      setResetMsg(m => ({ ...m, [prolific_id]: `✓ ${d.deleted} records deleted` }));
      load();
    } catch (err) {
      setResetMsg(m => ({ ...m, [prolific_id]: `Error: ${err.message}` }));
    } finally {
      setResetting(r => ({ ...r, [prolific_id]: false }));
    }
  }

  async function resetTasks(prolific_id) {
    if (!window.confirm(`Reset INITIAL TASK PROGRESS for "${prolific_id}"?\n\nThis clears consent, survey, tutorial, onboarding, and all task milestone flags. The annotator will redo the entire intro flow on next login. Their annotation work is NOT deleted.`)) return;
    setResetting(r => ({ ...r, [prolific_id]: true }));
    setResetMsg(m => ({ ...m, [prolific_id]: '' }));
    try {
      await api(`/api/admin/annotators/${prolific_id}/reset-tasks`, { method: 'POST' }, token);
      setResetMsg(m => ({ ...m, [prolific_id]: `✓ Task progress reset` }));
      load();
    } catch (err) {
      setResetMsg(m => ({ ...m, [prolific_id]: `Error: ${err.message}` }));
    } finally {
      setResetting(r => ({ ...r, [prolific_id]: false }));
    }
  }

  async function deleteAnnotator(prolific_id) {
    if (!window.confirm(`PERMANENTLY DELETE "${prolific_id}"?\n\nThis removes the annotator and all their annotation records. This action cannot be undone.`)) return;
    if (!window.confirm(`Are you absolutely sure? Type-check: this will delete "${prolific_id}" forever.`)) return;
    setResetting(r => ({ ...r, [prolific_id]: true }));
    setResetMsg(m => ({ ...m, [prolific_id]: '' }));
    try {
      await api(`/api/admin/annotators/${prolific_id}`, { method: 'DELETE' }, token);
      // Optimistically remove from local state — DynamoDB scans are eventually
      // consistent, so the next load() might still return this annotator briefly.
      setData(prev => prev
        ? { ...prev, annotators: prev.annotators.filter(a => a.prolific_id !== prolific_id), total: prev.total - 1 }
        : prev
      );
      // Refresh after a short delay to confirm the delete propagated
      setTimeout(load, 1500);
    } catch (err) {
      setResetMsg(m => ({ ...m, [prolific_id]: `Error: ${err.message}` }));
      setResetting(r => ({ ...r, [prolific_id]: false }));
    }
  }

  if (loading) return <p className="adm-info">Loading…</p>;
  if (error)   return <p className="adm-error">{error}</p>;

  const { annotators = [], annotations_per_user, total } = data;
  const isSuperAdmin = role === 'super_admin';

  function annotatorStatus(a) {
    if (a.submitted_at) return 'submitted';
    if (a.assigned_count > 0 && a.completed_count >= a.assigned_count) return 'complete';
    if (a.completed_count > 0 || a.task_annotation_done || a.task_scoring_done || a.task_bars_done || a.task_checklist_done || a.survey_done) return 'in_progress';
    return 'not_started';
  }

  function taskProgressInt(a) {
    return (a.survey_done ? 1 : 0)
         + (a.task_annotation_done ? 1 : 0)
         + (a.task_scoring_done ? 1 : 0)
         + (a.task_bars_done ? 1 : 0)
         + (a.task_checklist_done ? 1 : 0);
  }

  const filtered = annotators.filter(a => {
    if (search && !a.prolific_id.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterStatus    !== 'all' && annotatorStatus(a) !== filterStatus) return false;
    if (filterSubmitted !== 'all' && (!!a.submitted_at) !== (filterSubmitted === 'yes')) return false;
    if (filterTask      !== 'all') {
      const want = parseInt(filterTask, 10);
      if (taskProgressInt(a) !== want) return false;
    }
    return true;
  });
  const filtersActive = !!search || filterStatus !== 'all' || filterSubmitted !== 'all' || filterTask !== 'all';

  return (
    <div className="adm-tab-flex">
      <div className="adm-sticky-head">
        <div className="adm-stat-row">
          <div className="adm-stat"><span className="adm-stat-val">{total}</span><span className="adm-stat-lbl">Total annotators</span></div>
          <div className="adm-stat"><span className="adm-stat-val">{annotations_per_user}</span><span className="adm-stat-lbl">Items per annotator</span></div>
          <div className="adm-stat"><span className="adm-stat-val">{annotators.filter(a => a.completed_count >= annotations_per_user).length}</span><span className="adm-stat-lbl">Fully complete</span></div>
          <div className="adm-stat"><span className="adm-stat-val">{annotators.filter(a => a.submitted_at).length}</span><span className="adm-stat-lbl">Submitted to Prolific</span></div>
        </div>

        <div className="adm-toolbar">
          <input
            className="adm-input adm-search"
            placeholder="Search Prolific ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="adm-btn-sm" onClick={load}>Refresh</button>
        </div>

        <div className="adm-toolbar" style={{ marginBottom: 12 }}>
          <FilterPills
            label="Status"
            value={filterStatus}
            options={[
              { value: 'all',          label: 'All' },
              { value: 'not_started',  label: 'Not started' },
              { value: 'in_progress',  label: 'In progress' },
              { value: 'complete',     label: 'Complete' },
              { value: 'submitted',    label: 'Submitted' },
            ]}
            onChange={setFilterStatus}
          />
          <FilterPills
            label="Submitted"
            value={filterSubmitted}
            options={[{ value: 'all', label: 'All' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
            onChange={setFilterSubmitted}
          />
          <FilterPills
            label="Task milestone"
            value={filterTask}
            options={[
              { value: 'all', label: 'All' },
              { value: '1',   label: '1' },
              { value: '2',   label: '2' },
              { value: '3',   label: '3' },
              { value: '4',   label: '4' },
              { value: '5',   label: '5' },
            ]}
            onChange={setFilterTask}
          />
          {filtersActive && (
            <button
              className="adm-btn-sm"
              onClick={() => { setSearch(''); setFilterStatus('all'); setFilterSubmitted('all'); setFilterTask('all'); }}
            >
              Clear filters
            </button>
          )}
          <span className="adm-muted" style={{ fontSize: 11.5, marginLeft: 'auto' }}>
            {filtered.length} / {annotators.length} shown
          </span>
        </div>
      </div>

      <div className="adm-table-wrap adm-scroll-area">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Prolific ID</th>
              <th>Task Progress <span style={{ fontWeight: 400, fontSize: 10, color: '#9ca3af' }}>(1=Survey 2=Annotate 3=Score 4=BARS 5=Checklist)</span></th>
              <th>Completed</th>
              <th title="Per-session breakdown: how many items completed each time the annotator came back">Sessions</th>
              <th title="Total time spent grading (from telemetry step transitions)">Time spent</th>
              <th>Joined</th>
              {isSuperAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={isSuperAdmin ? 7 : 6} className="adm-empty">
                {annotators.length === 0 ? 'No annotators yet.' : 'No matches.'}
              </td></tr>
            )}
            {filtered.map(a => (
              <tr key={a.prolific_id}>
                <td className="adm-mono">{a.prolific_id}</td>
                <td><TaskProgress a={a} /></td>
                <td title={a.assigned_count !== annotations_per_user ? `${a.assigned_count} items actually assigned to this annotator` : undefined}>
                  <span className={a.completed_count >= annotations_per_user ? 'adm-done' : ''}>
                    {a.completed_count} / {annotations_per_user}
                  </span>
                </td>
                <td><SessionsCell sessions={a.sessions} /></td>
                <td className="adm-mono" style={{ fontSize: 12 }}>{formatDuration(timeMap[a.prolific_id])}</td>
                <td>{a.created_at ? new Date(a.created_at).toLocaleDateString() : '—'}</td>
                {isSuperAdmin && (
                  <td>
                    {resetMsg[a.prolific_id] && resetMsg[a.prolific_id].startsWith('✓') ? (
                      <span className="adm-success" style={{ fontSize: 11 }}>{resetMsg[a.prolific_id]}</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button className="adm-btn-danger" title="Delete grades + highlights only" onClick={() => resetAnnotator(a.prolific_id)} disabled={resetting[a.prolific_id]}>
                          {resetting[a.prolific_id] ? '…' : 'Reset Annotations'}
                        </button>
                        <button className="adm-btn-danger" title="Reset consent, survey, tutorial, onboarding, task flags" onClick={() => resetTasks(a.prolific_id)} disabled={resetting[a.prolific_id]}>
                          Reset Tasks
                        </button>
                        <button className="adm-btn-danger" style={{ background: '#fee2e2', borderColor: '#dc2626', color: '#991b1b' }} title="Permanently delete this Prolific ID" onClick={() => deleteAnnotator(a.prolific_id)} disabled={resetting[a.prolific_id]}>
                          Delete
                        </button>
                        {resetMsg[a.prolific_id] && (
                          <div className="adm-error" style={{ fontSize: 11, width: '100%' }}>{resetMsg[a.prolific_id]}</div>
                        )}
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Badge({ ok }) {
  return <span className={ok ? 'adm-badge adm-badge-ok' : 'adm-badge adm-badge-no'}>{ok ? 'Done' : 'Pending'}</span>;
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return '—';
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const TASK_STEPS = [
  { key: 'survey_done',           label: 'Survey' },
  { key: 'task_annotation_done',  label: 'Annotation' },
  { key: 'task_scoring_done',     label: 'Scoring' },
  { key: 'task_bars_done',        label: 'BARS' },
  { key: 'task_checklist_done',   label: 'Checklist' },
];

function TaskProgress({ a }) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      {TASK_STEPS.map(({ key, label }, i) => {
        const done = !!a[key];
        return (
          <div
            key={key}
            title={label}
            style={{
              width: 28, height: 20, borderRadius: 4, fontSize: 9, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: done ? '#d1fae5' : '#f1f5f9',
              color: done ? '#065f46' : '#9ca3af',
              border: `1px solid ${done ? '#6ee7b7' : '#e2e8f0'}`,
            }}
          >
            {i + 1}
          </div>
        );
      })}
    </div>
  );
}

function SessionsCell({ sessions }) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return <span className="adm-muted" style={{ fontSize: 11 }}>—</span>;
  }
  const fmt = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };
  const tooltip = sessions
    .map(s => `Session ${s.n}: ${s.completed}/${s.assigned} • started ${fmt(s.started_at)}${s.submitted_at ? ` • submitted ${fmt(s.submitted_at)}` : ' • in progress'}`)
    .join('\n');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11 }} title={tooltip}>
      <div style={{ fontWeight: 600, color: '#1e293b' }}>
        {sessions.length}× visit{sessions.length > 1 ? 's' : ''}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
        {sessions.map(s => {
          const done = s.assigned > 0 && s.completed >= s.assigned;
          return (
            <span
              key={s.n}
              style={{
                padding: '1px 5px',
                borderRadius: 3,
                background: done ? '#d1fae5' : (s.submitted_at ? '#fef3c7' : '#dbeafe'),
                color: done ? '#065f46' : (s.submitted_at ? '#92400e' : '#1e40af'),
                border: `1px solid ${done ? '#6ee7b7' : (s.submitted_at ? '#fcd34d' : '#93c5fd')}`,
                fontSize: 10,
                fontWeight: 600,
              }}
            >
              #{s.n}: {s.completed}/{s.assigned}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── Insights ──────────────────────────────────────────────────────────────────
const FRAME_LABEL = { s: 'Situation', t: 'Task', a: 'Action', r: 'Result' };
const BARS_COLOR  = { 1: '#dc2626', 2: '#ea580c', 3: '#d97706', 4: '#16a34a', 5: '#15803d' };

function MiniBar({ pct, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct ?? 0}%`, height: '100%', background: color, borderRadius: 4, transition: 'width .4s' }} />
      </div>
      <span style={{ fontSize: 11, color: '#374151', width: 32, textAlign: 'right' }}>
        {pct === null ? '—' : `${pct}%`}
      </span>
    </div>
  );
}

function QInsights({ label, data }) {
  if (!data) return null;
  const { count, bars_avg, bars_dist, frame_pct, score_avg = {}, score_dist = {} } = data;
  const maxBars = Math.max(...Object.values(bars_dist), 1);
  return (
    <div className="adm-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#1e293b' }}>{label}</h3>
        <span className="adm-muted" style={{ fontSize: 12 }}>{count} completed · avg BARS {bars_avg ?? '—'}</span>
      </div>

      <div className="adm-subsection-title" style={{ marginBottom: 8 }}>BARS distribution</div>
      {[5,4,3,2,1].map(score => (
        <div key={score} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: BARS_COLOR[score], width: 14, textAlign: 'right' }}>{score}</span>
          <div style={{ flex: 1, height: 14, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${Math.round(bars_dist[score] / maxBars * 100)}%`, height: '100%', background: BARS_COLOR[score], borderRadius: 3, transition: 'width .4s' }} />
          </div>
          <span style={{ fontSize: 11, color: '#6b7280', width: 24, textAlign: 'right' }}>{bars_dist[score]}</span>
        </div>
      ))}

      <div className="adm-subsection-title" style={{ marginTop: 16, marginBottom: 8 }}>Structural score by frame (avg 1–5)</div>
      {['s','t','a','r'].map(f => {
        const dist = score_dist[f] || { 1:0, 2:0, 3:0, 4:0, 5:0 };
        const maxScore = Math.max(...Object.values(dist), 1);
        return (
          <div key={f} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
              <span style={{ fontSize: 12, color: '#374151', fontWeight: 500 }}>{FRAME_LABEL[f]}</span>
              <span style={{ fontSize: 11, color: '#6b7280' }}>avg {score_avg[f] ?? '—'}</span>
            </div>
            <div style={{ display: 'flex', gap: 2, height: 12, borderRadius: 3, overflow: 'hidden', background: '#f1f5f9' }}>
              {[1,2,3,4,5].map(s => {
                const w = Math.round((dist[s] / maxScore) * 100);
                return (
                  <div key={s} title={`${s}: ${dist[s]}`}
                    style={{ flex: dist[s] > 0 ? dist[s] : 0.001, background: BARS_COLOR[s], minWidth: dist[s] > 0 ? 4 : 0 }} />
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="adm-subsection-title" style={{ marginTop: 16, marginBottom: 8 }}>STAR frame presence (Yes %)</div>
      {['s','t','a','r'].map(f => (
        <div key={f} style={{ display: 'grid', gridTemplateColumns: '72px 1fr', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: '#374151' }}>{FRAME_LABEL[f]}</span>
          <MiniBar pct={frame_pct[f]} color="#2563eb" />
        </div>
      ))}
    </div>
  );
}

function InsightsTab({ token }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api('/api/admin/insights', {}, token)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="adm-info">Loading…</p>;
  if (error)   return <p className="adm-error">{error}</p>;

  return (
    <div>
      <div className="adm-stat-row" style={{ marginBottom: 24 }}>
        <div className="adm-stat"><span className="adm-stat-val">{data.total}</span><span className="adm-stat-lbl">Completed annotations</span></div>
        <div className="adm-stat"><span className="adm-stat-val">{data.annotators ?? '—'}</span><span className="adm-stat-lbl">Unique annotators</span></div>
        <div className="adm-stat"><span className="adm-stat-val">{data.q1?.bars_avg ?? '—'}</span><span className="adm-stat-lbl">Avg BARS — Q1</span></div>
        <div className="adm-stat"><span className="adm-stat-val">{data.q2?.bars_avg ?? '—'}</span><span className="adm-stat-lbl">Avg BARS — Q2</span></div>
        <button className="adm-btn-sm" onClick={load} style={{ alignSelf: 'center' }}>Refresh</button>
      </div>
      <div className="adm-two-col" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <QInsights label="Question 1" data={data.q1} />
        <QInsights label="Question 2" data={data.q2} />
      </div>
    </div>
  );
}

// ── Config ────────────────────────────────────────────────────────────────────
function ConfigTab({ token }) {
  const [value, setValue]         = useState('');
  const [returningValue, setReturningValue] = useState('');
  const [target, setTarget]       = useState('');
  const [completionCode, setCompletionCode] = useState('');
  const [allowedSonaText, setAllowedSonaText] = useState('');
  const [eligibility, setEligibility] = useState(null);
  const [saved, setSaved]         = useState(false);
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(true);
  const [reassigning, setReassigning] = useState(false);
  const [reassignMsg, setReassignMsg] = useState('');
  const [stats, setStats]         = useState(null);
  const [pool, setPool]           = useState(null);

  useEffect(() => {
    Promise.all([
      api('/api/admin/config', {}, token).then(d => {
        setValue(String(d.annotations_per_user || 2));
        setReturningValue(String(d.returning_annotations_per_user || 4));
        setTarget(String(d.target_annotations_per_item || 1));
        setCompletionCode(d.completion_code || '');
        setAllowedSonaText((Array.isArray(d.allowed_sona_ids) ? d.allowed_sona_ids : []).join('\n'));
        setEligibility(d.eligibility || null);
      }),
      api('/api/admin/progress', {}, token).then(d => {
        const totalAssigned  = d.annotators.reduce((s, a) => s + a.assigned_count, 0);
        const totalCompleted = d.annotators.reduce((s, a) => s + a.completed_count, 0);
        setStats({ annotators: d.total, totalAssigned, totalCompleted, perUser: d.annotations_per_user });
      }),
      api('/api/admin/sona-items', {}, token).then(d => {
        setPool({
          remaining: d.pool_remaining,
          filled:    d.pool_filled,
          total:     d.pool_total,
          target:    d.target_annotations_per_item,
        });
      }),
    ])
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  // Parse the textarea into a deduplicated list of sona_ids. Accept any
  // whitespace or comma as a separator so the admin can paste a CSV line,
  // newline-delimited list, or anything in between.
  function parseAllowedSonaList(text) {
    return [...new Set(
      (text || '')
        .split(/[\s,]+/)
        .map(s => s.trim())
        .filter(Boolean)
    )];
  }

  async function save(e) {
    e.preventDefault();
    setError(''); setSaved(false);
    try {
      await api('/api/admin/config', {
        method: 'PUT',
        body: JSON.stringify({
          annotations_per_user:           Number(value),
          returning_annotations_per_user: Number(returningValue),
          target_annotations_per_item:    Number(target),
          completion_code:                completionCode.trim(),
          allowed_sona_ids:               parseAllowedSonaList(allowedSonaText),
        }),
      }, token);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);

      // Re-fetch so the live eligible-count indicator reflects the new state
      // (server kicks off refreshEligibility() in the background; the GET
      // returns whatever the cache currently shows — usually fresh within
      // ~1 s of the save).
      try {
        const d = await api('/api/admin/config', {}, token);
        setEligibility(d.eligibility || null);
        setAllowedSonaText((Array.isArray(d.allowed_sona_ids) ? d.allowed_sona_ids : []).join('\n'));
      } catch { /* non-fatal */ }
    } catch (err) {
      setError(err.message);
    }
  }

  async function reassign() {
    if (!window.confirm(`Top up every annotator to ${value} items?\n\nThis adds new eligible SONA items where annotators are below target. Completed and in-progress items are NEVER removed. Safe to run anytime.`)) return;
    setReassignMsg(''); setError('');
    setReassigning(true);
    try {
      const d = await api('/api/admin/reassign', { method: 'POST' }, token);
      setReassignMsg(`Done — ${d.updated} of ${d.total} annotators topped up.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setReassigning(false);
    }
  }

  if (loading) return <p className="adm-info">Loading…</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 600 }}>
      {stats && (
        <div className="adm-stat-row">
          <div className="adm-stat"><span className="adm-stat-val">{stats.annotators}</span><span className="adm-stat-lbl">Annotators</span></div>
          <div className="adm-stat"><span className="adm-stat-val">{stats.totalAssigned}</span><span className="adm-stat-lbl">Total assigned</span></div>
          <div className="adm-stat"><span className="adm-stat-val">{stats.totalCompleted}</span><span className="adm-stat-lbl">Total completed</span></div>
        </div>
      )}
      {pool && (
        <div className="adm-stat-row">
          <div className="adm-stat">
            <span className="adm-stat-val" style={{ color: pool.remaining === 0 ? '#dc2626' : '#2563eb' }}>
              {pool.remaining} / {pool.total}
            </span>
            <span className="adm-stat-lbl">Pool remaining (eligible items still under target)</span>
          </div>
          <div className="adm-stat">
            <span className="adm-stat-val" style={{ color: '#059669' }}>{pool.filled}</span>
            <span className="adm-stat-lbl">Items at target</span>
          </div>
          <div className="adm-stat">
            <span className="adm-stat-val">{pool.target}</span>
            <span className="adm-stat-lbl">Target per item</span>
          </div>
        </div>
      )}
      <div className="adm-card">
        <h2 className="adm-section-title">Annotation Settings</h2>
        <form onSubmit={save}>
          <label className="adm-label">Items per annotator (first session)
            <input
              className="adm-input"
              type="number"
              min="1" max="1000"
              value={value}
              onChange={e => setValue(e.target.value)}
            />
            <span className="adm-hint">How many SONA items each new Prolific annotator is drawn from the pool on their first visit.</span>
          </label>
          <label className="adm-label" style={{ marginTop: 14 }}>Items per returning annotator
            <input
              className="adm-input"
              type="number"
              min="1" max="1000"
              value={returningValue}
              onChange={e => setReturningValue(e.target.value)}
            />
            <span className="adm-hint">
              How many <em>additional</em> SONA items to draw when a Prolific annotator returns for a second session. They skip training (~10 min), so a higher number fills the same paid time slot. Default 4.
            </span>
          </label>
          <label className="adm-label" style={{ marginTop: 14 }}>Target annotations per item
            <input
              className="adm-input"
              type="number"
              min="1" max="100"
              value={target}
              onChange={e => setTarget(e.target.value)}
            />
            <span className="adm-hint">
              How many distinct annotators must rate each SONA item. The shrinking pool draws each item up to this many times.
              When all eligible items reach this count the pool is full and new annotators see "study full" — bump this number to start another pass.
            </span>
          </label>
          <label className="adm-label" style={{ marginTop: 14 }}>Prolific completion code
            <input
              className="adm-input"
              type="text"
              placeholder="e.g. CWFE83FY  (code only, not the full URL)"
              value={completionCode}
              onChange={e => {
                // Extract just the code if the user pasted the full Prolific URL
                const v = e.target.value;
                const m = v.match(/[?&]cc=([^&\s]+)/i);
                setCompletionCode(m ? decodeURIComponent(m[1]) : v);
              }}
            />
            <span className="adm-hint">
              Just the code from your Prolific study setup (e.g. <code>CWFE83FY</code>) — NOT the full URL.
              Annotators who finish all assigned items will be redirected to&nbsp;
              <code>https://app.prolific.com/submissions/complete?cc=&lt;CODE&gt;</code>. Leave blank during testing.
            </span>
          </label>

          {/* CALIBER-only: narrow eligibility to a curated subset of sona_ids */}
          <label className="adm-label" style={{ marginTop: 14 }}>
            Allowed SONA IDs (CALIBER subset)
            {eligibility && (
              <span
                style={{
                  marginLeft: 10,
                  padding: '2px 8px',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  background: eligibility.allowlist_size > 0 ? '#dbeafe' : '#dcfce7',
                  color:      eligibility.allowlist_size > 0 ? '#1e3a8a' : '#166534',
                }}
                title={`Last refreshed ${eligibility.last_refresh_at || 'never'}`}
              >
                {eligibility.eligible_count} / {eligibility.llm_pool_size} sonas eligible
              </span>
            )}
            <textarea
              className="adm-input"
              rows={6}
              placeholder={'Leave empty to allow every sona with ' + (eligibility?.model || 'opus4.8max') + ' grades.\nOtherwise, one ID per line (or comma-separated).\n\nExample:\n51769\n51787\n51800'}
              value={allowedSonaText}
              onChange={e => setAllowedSonaText(e.target.value)}
              style={{ fontFamily: 'monospace', resize: 'vertical', minHeight: 100 }}
            />
            <span className="adm-hint">
              When empty, all <strong>{eligibility?.llm_pool_size ?? '—'}</strong> sonas with{' '}
              <code>{eligibility?.model || 'opus4.8max'}</code> grades are draw-eligible.
              When populated, only the listed IDs can be drawn. IDs that don't have LLM grades are
              silently dropped — watch the badge above to confirm your list resolved correctly.
            </span>
          </label>

          {error && <p className="adm-error">{error}</p>}
          {saved && <p className="adm-success">Saved.</p>}
          <button className="adm-btn" type="submit" style={{ marginTop: 4 }}>Save</button>
        </form>
      </div>

      <div className="adm-card">
        <h2 className="adm-section-title">Re-assign Annotators</h2>
        <p className="adm-hint" style={{ marginBottom: 12 }}>
          Tops up every existing annotator to the current items-per-annotator count by adding new eligible SONA items.
          Annotators already at or above the target are not changed. Completed and in-progress items are never removed.
        </p>
        {reassignMsg && <p className="adm-success">{reassignMsg}</p>}
        <button className="adm-btn" onClick={reassign} disabled={reassigning} type="button">
          {reassigning ? 'Re-assigning…' : 'Re-assign All Annotators'}
        </button>
      </div>
    </div>
  );
}

// ── SONA Items ────────────────────────────────────────────────────────────────
function SortTh({ label, col, sortKey, sortDir, onSort, center }) {
  const active = sortKey === col;
  return (
    <th
      onClick={() => onSort(col)}
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', textAlign: center ? 'center' : undefined }}
    >
      {label}{' '}
      <span style={{ opacity: active ? 1 : 0.25, fontSize: 10 }}>{active && sortDir === 'desc' ? '▼' : '▲'}</span>
    </th>
  );
}

function FilterPills({ label, value, options, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ fontSize: 11.5, color: '#6b7280', fontWeight: 500 }}>{label}:</span>
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={{
            padding: '2px 10px', borderRadius: 20, border: '1px solid',
            fontSize: 11.5, fontWeight: 600, cursor: 'pointer', transition: 'all .15s',
            background: value === o.value ? '#2563eb' : '#f1f5f9',
            color:      value === o.value ? '#fff'     : '#374151',
            borderColor: value === o.value ? '#2563eb' : '#d1d5db',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SonaItemsTab({ token }) {
  const [items, setItems]       = useState([]);
  const [pool, setPool]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [error, setError]       = useState('');
  const [search, setSearch]     = useState('');
  const [toggling, setToggling] = useState({});

  const [sortKey, setSortKey]   = useState('sona_id');
  const [sortDir, setSortDir]   = useState('asc');
  const [filterEligible,  setFilterEligible]  = useState('all');
  const [filterComplete,  setFilterComplete]  = useState('all');
  const [filterAnnotated, setFilterAnnotated] = useState('all');
  const [filterPool,      setFilterPool]      = useState('all'); // 'all' | 'available' | 'filled'
  const [filterAllowed,   setFilterAllowed]   = useState('all'); // 'all' | 'yes' | 'no'
  const [allowlistActive, setAllowlistActive] = useState(false);
  const [allowedCount,    setAllowedCount]    = useState(0);
  const allowlistInitRef = useRef(false); // auto-default to the subset only once
  const [backfilling, setBackfilling] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api('/api/admin/sona-items', {}, token)
      .then(d => {
        setItems(d.items || []);
        const active = !!d.allowlist_active;
        setAllowlistActive(active);
        setAllowedCount(d.allowed_count ?? (d.items || []).length);
        // First time we see an active allowlist, default the page to the study
        // subset so it mirrors the config filter. Don't clobber later choices.
        if (active && !allowlistInitRef.current) {
          setFilterAllowed('yes');
          allowlistInitRef.current = true;
        }
        setPool({
          remaining: d.pool_remaining,
          filled:    d.pool_filled,
          total:     d.pool_total,
          target:    d.target_annotations_per_item,
        });
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  function toggleSort(col) {
    if (sortKey === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(col); setSortDir('asc'); }
  }

  async function backfillPool() {
    if (!window.confirm('Reconcile the atomic pool counter (assigned_count) on every SONA meta row with the ground-truth counts from annotator records?\n\nThis fixes historical divergences (pool_count=0 but assigned_count>0) caused by old assignments or scan overwrites. Safe to run anytime.')) return;
    setError(''); setScanResult(null);
    setBackfilling(true);
    try {
      const d = await api('/api/admin/sona-items/backfill-pool', { method: 'POST' }, token);
      setScanResult({ imported: d.updated, errors: 0, scanned: d.total, _backfill: true });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBackfilling(false);
    }
  }

  async function scan() {
    setScanResult(null); setError('');
    setScanning(true);
    try {
      const d = await api('/api/admin/sona-items/scan', { method: 'POST' }, token);
      setScanResult(d);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  }

  async function toggleEligible(sona_id, current) {
    setToggling(t => ({ ...t, [sona_id]: true }));
    try {
      await api(`/api/admin/sona-items/${sona_id}/eligible`, {
        method: 'PATCH',
        body: JSON.stringify({ eligible: !current }),
      }, token);
      setItems(prev => prev.map(it => it.sona_id === sona_id ? { ...it, eligible: !current } : it));
    } catch (err) {
      setError(err.message);
    } finally {
      setToggling(t => ({ ...t, [sona_id]: false }));
    }
  }

  const isComplete = it => it.has_q1_audio && it.has_q1_transcript && it.has_q2_audio && it.has_q2_transcript;

  const filtered = items
    .filter(it => {
      if (search) {
        const q = search.toLowerCase();
        if (!it.sona_id.toLowerCase().includes(q) &&
            !it.experiment.toLowerCase().includes(q) &&
            !it.group.toLowerCase().includes(q)) return false;
      }
      if (filterEligible  !== 'all' && it.eligible            !== (filterEligible  === 'yes')) return false;
      if (filterComplete  !== 'all' && isComplete(it)         !== (filterComplete  === 'yes')) return false;
      if (filterAnnotated !== 'all' && (it.annotation_count > 0) !== (filterAnnotated === 'yes')) return false;
      if (filterAllowed   !== 'all' && (it.allowed !== false)    !== (filterAllowed   === 'yes')) return false;
      if (filterPool !== 'all' && pool) {
        const isAvailable = (it.pool_count || 0) < pool.target;
        if (filterPool === 'available' && !isAvailable) return false;
        if (filterPool === 'filled' && isAvailable) return false;
      }
      return true;
    })
    .sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'boolean') { av = av ? 1 : 0; bv = bv ? 1 : 0; }
      if (typeof av === 'number')  return sortDir === 'asc' ? av - bv : bv - av;
      return sortDir === 'asc'
        ? String(av ?? '').localeCompare(String(bv ?? ''))
        : String(bv ?? '').localeCompare(String(av ?? ''));
    });

  const total    = items.length;
  const complete = items.filter(isComplete).length;
  const eligible = items.filter(i => i.eligible).length;
  const annotated = items.filter(i => i.annotation_count > 0).length;

  const sortProps = { sortKey, sortDir, onSort: toggleSort };

  return (
    <div className="adm-tab-flex">
      <div className="adm-sticky-head">
        <div className="adm-stat-row">
          <div className="adm-stat"><span className="adm-stat-val">{total}</span><span className="adm-stat-lbl">Total SONA IDs</span></div>
          <div className="adm-stat"><span className="adm-stat-val">{eligible}</span><span className="adm-stat-lbl">Eligible</span></div>
          {allowlistActive && (
            <div className="adm-stat">
              <span className="adm-stat-val" style={{ color: '#7c3aed' }}>{allowedCount}</span>
              <span className="adm-stat-lbl">Allowed (config list)</span>
            </div>
          )}
          {pool && (
            <div className="adm-stat">
              <span className="adm-stat-val" style={{ color: pool.remaining === 0 ? '#dc2626' : '#2563eb' }}>
                {pool.remaining} / {pool.total}
              </span>
              <span className="adm-stat-lbl">Pool available (target = {pool.target}×)</span>
            </div>
          )}
          <div className="adm-stat"><span className="adm-stat-val">{annotated}</span><span className="adm-stat-lbl">Annotated ≥1×</span></div>
        </div>

        <div className="adm-toolbar">
        <input
          className="adm-input adm-search"
          placeholder="Search SONA ID, experiment, group…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button className="adm-btn-sm" onClick={load} disabled={loading}>Refresh</button>
        <button className="adm-btn-sm" onClick={backfillPool} disabled={backfilling} title="Reconcile pool counters with annotator records">
          {backfilling ? 'Reconciling…' : 'Reconcile Pool'}
        </button>
        <button className="adm-btn" onClick={scan} disabled={scanning}>
          {scanning ? 'Scanning S3…' : 'Scan S3'}
        </button>
      </div>

      <div className="adm-toolbar" style={{ marginBottom: 12 }}>
        <FilterPills
          label="Eligible"
          value={filterEligible}
          options={[{ value: 'all', label: 'All' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
          onChange={setFilterEligible}
        />
        <FilterPills
          label="Complete"
          value={filterComplete}
          options={[{ value: 'all', label: 'All' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
          onChange={setFilterComplete}
        />
        <FilterPills
          label="Annotated"
          value={filterAnnotated}
          options={[{ value: 'all', label: 'All' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'None' }]}
          onChange={setFilterAnnotated}
        />
        <FilterPills
          label="Pool"
          value={filterPool}
          options={[{ value: 'all', label: 'All' }, { value: 'available', label: 'Available' }, { value: 'filled', label: 'Filled' }]}
          onChange={setFilterPool}
        />
        {allowlistActive && (
          <FilterPills
            label="Allowed"
            value={filterAllowed}
            options={[{ value: 'all', label: 'All' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
            onChange={setFilterAllowed}
          />
        )}
        {(filterEligible !== 'all' || filterComplete !== 'all' || filterAnnotated !== 'all' || filterPool !== 'all' || filterAllowed !== 'all' || search) && (
          <button
            className="adm-btn-sm"
            onClick={() => { setFilterEligible('all'); setFilterComplete('all'); setFilterAnnotated('all'); setFilterPool('all'); setFilterAllowed('all'); setSearch(''); }}
          >
            Clear filters
          </button>
        )}
        <span className="adm-muted" style={{ fontSize: 11.5, marginLeft: 'auto' }}>
          {filtered.length} / {total} shown
        </span>
      </div>

      {error      && <p className="adm-error" style={{ marginBottom: 10 }}>{error}</p>}
      {scanResult && (
        <p className="adm-success" style={{ marginBottom: 10 }}>
          {scanResult._backfill
            ? `Pool reconciled — ${scanResult.imported} of ${scanResult.scanned} meta rows updated.`
            : `Scan complete — ${scanResult.imported} imported, ${scanResult.errors} errors (${scanResult.scanned} total).`}
        </p>
      )}
      </div>

      {loading ? <p className="adm-info">Loading…</p> : (
        <div className="adm-table-wrap adm-scroll-area">
          <table className="adm-table adm-table-sm">
            <thead>
              <tr>
                <SortTh label="SONA ID"     col="sona_id"          {...sortProps} />
                <SortTh label="Exp"         col="experiment"       {...sortProps} />
                <SortTh label="Group"       col="group"            {...sortProps} />
                <th title="Q1 audio, Q1 transcript, Q2 audio, Q2 transcript">Data (Q1🔊 Q1📝 Q2🔊 Q2📝)</th>
                <SortTh label="Eligible"   col="eligible"         {...sortProps} center />
                {allowlistActive && <SortTh label="Allowed" col="allowed" {...sortProps} center />}
                <SortTh label="Pool"       col="pool_count"       {...sortProps} center />
                <SortTh label="Assigned"   col="assigned_count"   {...sortProps} center />
                <SortTh label="Done"       col="annotation_count" {...sortProps} center />
                <th style={{ textAlign: 'center' }} title="Annotators with at least 1 in-progress annotation">In progress</th>
                <SortTh label="Last scanned" col="last_scanned"   {...sortProps} />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={allowlistActive ? 11 : 10} className="adm-empty">{items.length === 0 ? 'No items yet — run Scan S3.' : 'No results.'}</td></tr>
              )}
              {filtered.map(it => (
                <tr key={it.sona_id}>
                  <td className="adm-mono">{it.sona_id}</td>
                  <td>{it.experiment}</td>
                  <td>{it.group}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <Check ok={it.has_q1_audio} />{' '}
                    <Check ok={it.has_q1_transcript} />{' '}
                    <span style={{ color: '#d1d5db' }}>·</span>{' '}
                    <Check ok={it.has_q2_audio} />{' '}
                    <Check ok={it.has_q2_transcript} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      className={`adm-toggle ${it.eligible ? 'adm-toggle-on' : 'adm-toggle-off'}`}
                      onClick={() => toggleEligible(it.sona_id, it.eligible)}
                      disabled={toggling[it.sona_id]}
                      title={it.eligible ? 'Click to mark ineligible — will not be assigned to new annotators' : 'Click to mark eligible'}
                    >
                      {it.eligible ? 'Yes' : 'No'}
                    </button>
                  </td>
                  {allowlistActive && (
                    <td style={{ textAlign: 'center' }} title={it.allowed ? 'In the config allowlist — can be drawn' : 'Not in the config allowlist — excluded from the draw pool'}>
                      {it.allowed
                        ? <span style={{ color: '#7c3aed', fontWeight: 600 }}>Yes</span>
                        : <span className="adm-muted">No</span>}
                    </td>
                  )}
                  <td className="adm-num" title={`Pool counter (incremented atomically when this item is drawn). Target: ${pool?.target ?? '?'}`}>
                    {pool && (it.pool_count || 0) >= pool.target
                      ? <span style={{ color: '#059669', fontWeight: 600 }}>{it.pool_count} ✓</span>
                      : <span>{it.pool_count || 0}{pool && ` / ${pool.target}`}</span>}
                  </td>
                  <td className="adm-num">{it.assigned_count}</td>
                  <td className="adm-num">
                    <span className={it.annotation_count > 0 ? 'adm-done' : ''}>{it.annotation_count}</span>
                  </td>
                  <td className="adm-num">
                    {it.in_progress > 0 ? <span style={{ color: '#d97706', fontWeight: 600 }}>{it.in_progress}</span> : <span className="adm-muted">0</span>}
                  </td>
                  <td className="adm-muted" style={{ fontSize: 11 }}>
                    {it.last_scanned ? new Date(it.last_scanned).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Check({ ok }) {
  return <span className={ok ? 'adm-check-ok' : 'adm-check-no'}>{ok ? '✓' : '✗'}</span>;
}

// ── Active Sessions (super-admin only) ───────────────────────────────────────
function ActiveTab({ token }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api('/api/admin/active', {}, token)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  function statusBadge(minutesAgo) {
    if (minutesAgo <= 2)  return <span className="adm-badge adm-badge-online">● Online</span>;
    if (minutesAgo <= 30) return <span className="adm-badge adm-badge-recent">{minutesAgo}m ago</span>;
    if (minutesAgo <= 60) return <span className="adm-badge adm-badge-recent" style={{ background: '#fee2e2', color: '#991b1b' }}>{minutesAgo}m ago</span>;
    const hrs = Math.floor(minutesAgo / 60);
    return <span className="adm-badge adm-badge-no">{hrs}h ago</span>;
  }

  function whatTheyreDoing(a) {
    if (a.task_progress === 5) return 'Annotating';
    if (a.task_progress === 4) return 'Task 4: Checklist';
    if (a.task_progress === 3) return 'Task 3: BARS';
    if (a.task_progress === 2) return 'Task 2: Scoring';
    if (a.task_progress === 1) return 'Tutorial / Tour';
    if (a.survey_done)         return 'Tutorial';
    return 'Survey';
  }

  const { admins = [], annotators = [], counts = {}, as_of } = data || {};

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 className="adm-section-title" style={{ margin: 0 }}>Active sessions</h2>
        <button className="adm-btn-sm" onClick={load} disabled={loading}>Refresh</button>
        {as_of && <span className="adm-muted" style={{ fontSize: 11 }}>Updated {new Date(as_of).toLocaleTimeString()} · auto-refreshes every 30s</span>}
      </div>

      <div className="adm-stat-row" style={{ marginBottom: 20 }}>
        <div className="adm-stat"><span className="adm-stat-val" style={{ color: counts.annotators_now > 0 ? '#059669' : undefined }}>{counts.annotators_now ?? '—'}</span><span className="adm-stat-lbl">Online now (≤2 min)</span></div>
        <div className="adm-stat"><span className="adm-stat-val">{counts.annotators_30m ?? '—'}</span><span className="adm-stat-lbl">Active recently (30 min)</span></div>
        <div className="adm-stat"><span className="adm-stat-val">{counts.annotators_24h ?? '—'}</span><span className="adm-stat-lbl">Active today (24 h)</span></div>
        <div className="adm-stat"><span className="adm-stat-val">{counts.annotators_7d ?? '—'}</span><span className="adm-stat-lbl">Active this week (7 d)</span></div>
      </div>

      {error && <p className="adm-error" style={{ marginBottom: 12 }}>{error}</p>}
      {loading && !data && <p className="adm-info">Loading…</p>}

      <h3 className="adm-subsection-title">Annotators (last 24 h)</h3>
      <div className="adm-table-wrap" style={{ marginBottom: 24 }}>
        <table className="adm-table adm-table-sm">
          <thead>
            <tr>
              <th>Prolific ID</th>
              <th>Status</th>
              <th>Last seen</th>
              <th>Currently in</th>
              <th>Progress</th>
              <th>Completed</th>
            </tr>
          </thead>
          <tbody>
            {annotators.length === 0 && <tr><td colSpan={6} className="adm-empty">No annotators active in last 24 h.</td></tr>}
            {annotators.map(a => (
              <tr key={a.prolific_id}>
                <td className="adm-mono">{a.prolific_id}</td>
                <td>{statusBadge(a.minutes_ago)}</td>
                <td className="adm-muted" style={{ fontSize: 11 }}>{new Date(a.last_seen).toLocaleString()}</td>
                <td style={{ fontSize: 12.5 }}>{whatTheyreDoing(a)}</td>
                <td><TaskProgress a={{
                  survey_done: a.survey_done,
                  task_annotation_done: a.task_progress >= 2,
                  task_scoring_done: a.task_progress >= 3,
                  task_bars_done: a.task_progress >= 4,
                  task_checklist_done: a.task_progress >= 5,
                }} /></td>
                <td>{a.completed} / {a.assigned}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="adm-subsection-title">Admins</h3>
      <div className="adm-table-wrap">
        <table className="adm-table adm-table-sm">
          <thead>
            <tr><th>Username</th><th>Role</th><th>Status</th><th>Last seen</th></tr>
          </thead>
          <tbody>
            {admins.length === 0 && <tr><td colSpan={4} className="adm-empty">No admins have ever signed in.</td></tr>}
            {admins.map(a => (
              <tr key={a.username}>
                <td className="adm-mono">{a.username}</td>
                <td><span className={`adm-role adm-role-${a.role}`}>{a.role}</span></td>
                <td>{statusBadge(a.minutes_ago)}</td>
                <td className="adm-muted" style={{ fontSize: 11 }}>{new Date(a.last_seen).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Time spent ─────────────────────────────────────────────────────────────
function TimeTab({ token }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [expanded, setExpanded] = useState({}); // prolific_id -> bool

  const load = useCallback(() => {
    setLoading(true);
    api('/api/admin/time-spent', {}, token)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="adm-info">Loading…</p>;
  if (error)   return <p className="adm-error">{error}</p>;

  const annotators = data?.annotators || [];
  const totalMsAll       = annotators.reduce((s, a) => s + a.total_ms, 0);
  const avgMsAll         = annotators.length ? totalMsAll / annotators.length : 0;
  const annotatorsWithInitial = annotators.filter(a => (a.initial_total || 0) > 0);
  const avgInitialMs     = annotatorsWithInitial.length
    ? annotatorsWithInitial.reduce((s, a) => s + (a.initial_total || 0), 0) / annotatorsWithInitial.length
    : 0;
  const annotatorsWithGrading = annotators.filter(a => (a.total_ms - (a.initial_total || 0)) > 0);
  const avgGradingMs     = annotatorsWithGrading.length
    ? annotatorsWithGrading.reduce((s, a) => s + (a.total_ms - (a.initial_total || 0)), 0) / annotatorsWithGrading.length
    : 0;

  function toggle(pid) { setExpanded(e => ({ ...e, [pid]: !e[pid] })); }

  return (
    <div className="adm-tab-flex">
      <div className="adm-sticky-head">
        <div className="adm-stat-row">
          <div className="adm-stat"><span className="adm-stat-val">{annotators.length}</span><span className="adm-stat-lbl">Annotators with time data</span></div>
          <div className="adm-stat"><span className="adm-stat-val">{formatDuration(avgMsAll)}</span><span className="adm-stat-lbl">Avg per annotator</span></div>
          <div className="adm-stat"><span className="adm-stat-val" style={{ color: '#7c3aed' }}>{formatDuration(avgInitialMs)}</span><span className="adm-stat-lbl">Avg initial tasks time</span></div>
          <div className="adm-stat"><span className="adm-stat-val" style={{ color: '#2563eb' }}>{formatDuration(avgGradingMs)}</span><span className="adm-stat-lbl">Avg grading time</span></div>
        </div>

        <div className="adm-toolbar">
          <button className="adm-btn-sm" onClick={load}>Refresh</button>
          <p className="adm-hint" style={{ margin: 0, flex: 1 }}>
            Time is computed from <code>step_time</code> telemetry events. Outliers &gt; 30 min are ignored. Click a row to drill into per-participant breakdown.
          </p>
        </div>
      </div>

      <div className="adm-table-wrap adm-scroll-area">
        <table className="adm-table adm-table-sm">
          <thead>
            <tr>
              <th>Prolific ID</th>
              <th>Initial tasks</th>
              <th>Grading</th>
              <th>Total time</th>
              <th>Participants graded</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {annotators.length === 0 && <tr><td colSpan={6} className="adm-empty">No time data yet — annotators must complete at least one task transition.</td></tr>}
            {annotators.map(a => {
              const gradingMs = a.total_ms - (a.initial_total || 0);
              return (
                <React.Fragment key={a.prolific_id}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => toggle(a.prolific_id)}>
                    <td className="adm-mono">{a.prolific_id}</td>
                    <td className="adm-mono" style={{ fontSize: 12, color: '#7c3aed' }}>{formatDuration(a.initial_total)}</td>
                    <td className="adm-mono" style={{ fontSize: 12, color: '#2563eb' }}>{formatDuration(gradingMs)}</td>
                    <td className="adm-mono" style={{ fontWeight: 600 }}>{formatDuration(a.total_ms)}</td>
                    <td>{a.participants.length}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 11, color: '#6b7280' }}>{expanded[a.prolific_id] ? '▲ Hide' : '▼ Show breakdown'}</span>
                    </td>
                  </tr>
                  {expanded[a.prolific_id] && (
                    <tr>
                      <td colSpan={6} style={{ background: '#f8fafc', padding: 12 }}>
                        {/* Initial-task breakdown */}
                        <div className="adm-subsection-title" style={{ marginBottom: 6, color: '#7c3aed' }}>Initial tasks</div>
                        <table className="adm-table adm-table-sm" style={{ marginBottom: 16 }}>
                          <thead>
                            <tr>
                              <th>Consent</th>
                              <th>Welcome</th>
                              <th>Survey</th>
                              <th>Tutorial</th>
                              <th>Initial total</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td className="adm-mono" style={{ fontSize: 11 }}>{formatDuration(a.initial?.consent)}</td>
                              <td className="adm-mono" style={{ fontSize: 11 }}>{formatDuration(a.initial?.welcome)}</td>
                              <td className="adm-mono" style={{ fontSize: 11 }}>{formatDuration(a.initial?.survey)}</td>
                              <td className="adm-mono" style={{ fontSize: 11 }}>{formatDuration(a.initial?.tutorial)}</td>
                              <td className="adm-mono" style={{ fontWeight: 600 }}>{formatDuration(a.initial_total)}</td>
                            </tr>
                          </tbody>
                        </table>

                        {/* Per-participant grading breakdown */}
                        <div className="adm-subsection-title" style={{ marginBottom: 6, color: '#2563eb' }}>Grading per participant</div>
                        <table className="adm-table adm-table-sm" style={{ marginBottom: 0 }}>
                          <thead>
                            <tr>
                              <th>SONA ID</th>
                              <th colSpan={4} style={{ textAlign: 'center', background: '#dbeafe' }}>Q1 time per task</th>
                              <th colSpan={4} style={{ textAlign: 'center', background: '#fde68a' }}>Q2 time per task</th>
                              <th>Total</th>
                            </tr>
                            <tr>
                              <th></th>
                              <th style={{ background: '#eff6ff' }}>Annotate</th>
                              <th style={{ background: '#eff6ff' }}>Score</th>
                              <th style={{ background: '#eff6ff' }}>BARS</th>
                              <th style={{ background: '#eff6ff' }}>Check</th>
                              <th style={{ background: '#fef3c7' }}>Annotate</th>
                              <th style={{ background: '#fef3c7' }}>Score</th>
                              <th style={{ background: '#fef3c7' }}>BARS</th>
                              <th style={{ background: '#fef3c7' }}>Check</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {a.participants.length === 0 && (
                              <tr><td colSpan={10} className="adm-empty" style={{ fontSize: 11 }}>No grading time yet.</td></tr>
                            )}
                            {a.participants.map(p => (
                              <tr key={p.sona_id}>
                                <td className="adm-mono">{p.sona_id}</td>
                                {['1','2','3','4'].map(step => (
                                  <td key={`q1${step}`} className="adm-mono" style={{ fontSize: 11 }}>{formatDuration(p.q1?.[step])}</td>
                                ))}
                                {['1','2','3','4'].map(step => (
                                  <td key={`q2${step}`} className="adm-mono" style={{ fontSize: 11 }}>{formatDuration(p.q2?.[step])}</td>
                                ))}
                                <td className="adm-mono" style={{ fontWeight: 600 }}>{formatDuration(p.total_ms)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Export ────────────────────────────────────────────────────────────────────
const COLUMN_DICTIONARY = {
  'Annotations (annotations_*.csv)': [
    ['prolific_id',     'Annotator\'s Prolific identifier'],
    ['sona_id',         'SONA interview item ID'],
    ['question',        '"q1" or "q2" — which of the two interview questions this row scores'],
    ['step',            'Current step the annotator was on. Values: 1 (annotating), 2 (scoring), 3 (BARS), 4 (checklist), "done" (fully complete)'],
    ['updated_at',      'ISO timestamp of last save'],
    ['g_{s,t,a,r}_yn',  'Task 4 binary checklist — "yes" if the candidate stated this STAR element at all, "no" if absent'],
    ['g_{s,t,a,r}_sc',  'Task 2 structural accumulation score, 1–5 — how thoroughly this frame is built up'],
    ['g_{s,t,a,r}_skip','Skip reason if the annotator did not highlight this frame: "not_present" or "not_sure"'],
    ['g_bars',          'Task 3 Competency / BARS score, 1–5 — overall behavioral rating'],
    ['situation_text',  'Concatenated text of all spans labelled S. Multiple spans joined with " | "'],
    ['task_text',       'Concatenated text of all spans labelled T'],
    ['action_text',     'Concatenated text of all spans labelled A'],
    ['result_text',     'Concatenated text of all spans labelled R'],
    ['annotation_html', 'Full transcript HTML with <span class="hl hl-{s,t,a,r}" data-frame="X">…</span> markup'],
  ],
  'Annotators (annotators_*.csv)': [
    ['prolific_id',                    'Prolific participant ID'],
    ['study_id, session_id',           'Prolific study + session IDs captured from the URL on first visit'],
    ['created_at, last_seen, submitted_at', 'First visit, latest heartbeat, and final "Submit to Prolific" click timestamps'],
    ['consent_done, survey_done, tutorial_done, onboarding_done', 'Onboarding milestone booleans'],
    ['task_{annotation,scoring,bars,checklist}_done', 'First time the annotator reached each of the 4 grading tasks'],
    ['audio_opt_in',                   'true = autoplay tutorial narration, false = text-only, null = not yet chosen'],
    ['reset_version',                  'Bumped by the admin Reset/Delete actions to invalidate the annotator\'s local browser cache'],
    ['assigned_sona_ids',              'Pipe-separated list ("a|b|c") of SONA items drawn from the pool for this annotator'],
    ['completed_sona_ids',             'Pipe-separated list of items where both Q1 and Q2 reached step="done"'],
    ['{question}_value, {question}_label', 'Personality / HR / demographic survey answers. value = raw choice, label = human-readable label'],
    ['sus_done',                          'true if the annotator completed the SUS feedback survey at the end of their first session'],
    ['sus_q1_value..sus_q10_value',       'SUS Likert raw value 1–5. Items 1,3,5,7,9 are positive-worded; 2,4,6,8,10 reverse-coded'],
    ['sus_q1_label..sus_q10_label',       'Human-readable Likert label (e.g. "Strongly agree")'],
    ['is_returning_session',              'true while the annotator is mid-way through a 2nd+ session (between draw and Prolific submit)'],
    ['session_count',                     'Number of times this Prolific ID has come back. 1 on first visit, +1 each time they submit and return.'],
    ['sessions_count',                    'Length of the sessions_history array (mirror of session_count)'],
    ['sessions_history',                  'Per-session breakdown. Pipe-separated entries "n=N;items=A,B,C;started=ISO;submitted=ISO". One entry per visit, in order. submitted is empty while the session is still in progress.'],
    ['current_session_items',             'Pipe-separated SONA IDs drawn for the most recent session — these are the items the returning annotator is shown (previous sessions\' items are hidden).'],
  ],
  'Pool / Randomization (pool_status_*.csv)': [
    ['sona_id',                   'SONA interview item ID'],
    ['experiment, group',         'Cohort metadata from the original S3 path'],
    ['eligible',                  '"yes" / "no" — whether the item can currently be drawn from the pool'],
    ['pool_count',                'How many times this item has been drawn (atomic counter on the meta row). The authoritative pool number.'],
    ['target',                    'Configured target draws per item (from admin Config)'],
    ['remaining',                 'target − pool_count. 0 means filled; negative means over-drawn (rare)'],
    ['status',                    '"Untouched" (0 draws), "Available" (under target), "Filled" (at target), "Over-target", or "Ineligible"'],
    ['assigned_count',            'Number of annotators currently holding this item (derived from annotators table)'],
    ['completed_count',           'Number of annotators with Q1+Q2 both step="done" for this item (from annotations table)'],
    ['in_progress_count',         'Annotators who started but haven\'t finished both Q1 and Q2'],
    ['annotators_assigned',       'Pipe-separated list of prolific_ids who were drawn this item'],
    ['annotators_completed_*',    'Pipe-separated lists from two sources: the annotator record\'s completed_sona_ids vs. the actual annotations records'],
    ['annotators_in_progress',    'Pipe-separated list of prolific_ids who have started but not finished'],
    ['last_scanned',              'When this item was last refreshed from S3'],
  ],
  'Telemetry (telemetry_*.csv)': [
    ['event_id',     'Unique row ID (UUID)'],
    ['prolific_id',  'Annotator the event belongs to ("anonymous" before login)'],
    ['event_type',   'click | mouse_move | step_time | screen_time | session_meta | other'],
    ['ts',           'ISO timestamp of when the event fired on the client'],
    ['session_id',   'Per-tab session identifier (resets on full page reload)'],
    ['elapsed_s',    'Seconds since the session started'],
    ['x, y',         'Coordinates relative to viewport (click + mouse_move only)'],
    ['vw, vh',       'Viewport width/height (mouse_move only)'],
    ['tag, element_id, cls, text', 'Click target details (click only). tag = HTML element, text = first 60 chars of textContent'],
    ['participant, question, from_step, ms', 'step_time events: which SONA × which question × which step the annotator was leaving × ms spent there'],
    ['frame',         'annotation_created / _updated / _removed: which STAR frame (s/t/a/r) the event acted on'],
    ['selected_text', 'annotation events: the highlighted text (≤ 500 chars). Use with span_start/span_end to reconstruct what was annotated when'],
    ['span_start, span_end', 'Character offsets of the selected text within the transcript\'s plain text (excluding badges)'],
    ['html_len',      'Length of the transcript HTML at the moment of the annotation event — a quick proxy for "how built-up are the annotations so far"'],
    ['char_count',    'text_selected events: length of the highlighted text BEFORE the user picks a frame label'],
    ['grade_name, grade_value, grade_prev_value, grading_step', 'grade_changed events: which grade field was clicked, the new and previous value, and which task step they were on. Captures hesitations.'],
    ['scroll_top, scroll_height, client_height', 'scroll events (sampled 0.5 Hz on the transcript). Use the ratio to know what portion of the transcript was visible.'],
    ['from_screen',  'screen_time events: name of the screen the annotator just left (consent / welcome / survey / tutorial)'],
    // ── session_meta event (one row per session) ─────────────────────────────
    ['screen_w, screen_h, screen_avail_w, screen_avail_h, dpr', 'session_meta: physical screen resolution + devicePixelRatio at session start. Available* excludes OS chrome. dpr=2 for Retina/HiDPI displays.'],
    ['ua, platform',                  'session_meta: navigator.userAgent (full string) and navigator.platform (e.g. "MacIntel", "Win32"). Pair with server_ua for tamper-check.'],
    ['ua_brands, ua_mobile, ua_platform', 'session_meta: structured UA-CH (Chromium/Edge only — undefined on Safari/Firefox). brands = "Chrome 124; Not_A Brand 8". mobile = true/false.'],
    ['language, languages, timezone, tz_offset_min', 'session_meta: navigator.language (primary), full preference list, IANA timezone (e.g. "America/New_York"), and minutes offset from UTC.'],
    ['net_effective_type, net_downlink_mbps, net_rtt_ms, net_save_data', 'session_meta: navigator.connection (Chromium only). effective_type = slow-2g | 2g | 3g | 4g. downlink in Mbps, rtt in ms. Useful for explaining latency-related drop-offs.'],
    ['hw_concurrency, device_memory_gb', 'session_meta: navigator.hardwareConcurrency (logical CPU cores) and navigator.deviceMemory (GB, rounded — Chromium only).'],
    ['touch, max_touch_pts, cookie_enabled', 'session_meta: touch = true if a touchscreen was detected. max_touch_pts = max simultaneous touches (5 on most tablets, 10 on phones).'],
    ['referrer, origin, path',        'session_meta: document.referrer (was Prolific the source?), the app origin, and the entry pathname.'],
    // ── server-stamped on EVERY row (not just session_meta) ──────────────────
    ['client_ip',                     'Server-stamped: real client IP from X-Forwarded-For (preferred) or req.ip. Behind the EB ALB. Treat as PII — ensure the consent form covers IP collection.'],
    ['server_ua',                     'Server-stamped: the User-Agent header as the server saw it. Cross-check against the client-reported `ua` to spot tampering.'],
    ['accept_language',               'Server-stamped: the Accept-Language header (e.g. "en-US,en;q=0.9").'],
    ['server_referrer',               'Server-stamped: the Referer header on the request (where the API call was made from).'],
    ['received_at',                   'Server-stamped: ISO timestamp when the batch arrived at the server. Compare with `ts` (client clock) to detect clock skew.'],
  ],
};

function DataDictionary() {
  const [open, setOpen] = useState(false);
  return (
    <div className="adm-card" style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#1e293b' }}>📖 Data Dictionary</h3>
        <span style={{ fontSize: 11, color: '#6b7280' }}>{open ? '▲ Hide' : '▼ Show'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {Object.entries(COLUMN_DICTIONARY).map(([section, rows]) => (
            <div key={section}>
              <div className="adm-subsection-title" style={{ marginBottom: 6 }}>{section}</div>
              <table className="adm-table adm-table-sm" style={{ tableLayout: 'fixed' }}>
                <thead><tr><th style={{ width: '32%' }}>Column</th><th>Meaning</th></tr></thead>
                <tbody>
                  {rows.map(([col, desc]) => (
                    <tr key={col}>
                      <td className="adm-mono" style={{ fontSize: 11.5, verticalAlign: 'top' }}>{col}</td>
                      <td style={{ fontSize: 12, color: '#374151', lineHeight: 1.55 }}>{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExportTab({ token }) {
  const [busy, setBusy] = useState({});
  const [error, setError] = useState('');

  async function download(label, path, suggestedName) {
    setError('');
    setBusy(b => ({ ...b, [label]: true }));
    try {
      const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = suggestedName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(`${label}: ${err.message}`);
    } finally {
      setBusy(b => ({ ...b, [label]: false }));
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  const exports = [
    {
      key: 'annotations',
      title: 'Annotations',
      description: 'One row per (annotator × SONA × question). Includes structural scores, BARS, yes/no checks, skip reasons, and the full annotation HTML.',
      url: '/api/admin/export/annotations.csv',
      filename: `annotations_${today}.csv`,
    },
    {
      key: 'annotators',
      title: 'Annotators (survey + profile)',
      description: 'One row per annotator with assignment/completion summary, Prolific IDs, all milestone flags, and flattened survey answers (personality + HR + demographics + SUS).',
      url: '/api/admin/export/annotators.csv',
      filename: `annotators_${today}.csv`,
    },
    {
      key: 'pool',
      title: 'Pool / Randomization status',
      description: 'Snapshot of the shrinking-pool state. One row per SONA item with pool counter, target, remaining draws, and the list of annotators who got / completed / are mid-grading each item.',
      url: '/api/admin/export/pool.csv',
      filename: `pool_status_${today}.csv`,
    },
    {
      key: 'clicks',
      title: 'Click events',
      description: 'Every UI click. Columns: x/y, element tag, id, class, text. Use for interaction analysis.',
      url: '/api/admin/export/telemetry.csv?type=click',
      filename: `telemetry_click_${today}.csv`,
    },
    {
      key: 'mouse',
      title: 'Mouse movement',
      description: 'Sampled at 1 Hz while annotator is on the app. Can be a large file — only download when needed.',
      url: '/api/admin/export/telemetry.csv?type=mouse_move',
      filename: `telemetry_mouse_${today}.csv`,
    },
    {
      key: 'step_time',
      title: 'Step transitions (time on task)',
      description: 'Time-on-step events with duration ms per task transition. Underlies the Time tab.',
      url: '/api/admin/export/telemetry.csv?type=step_time',
      filename: `telemetry_step_time_${today}.csv`,
    },
    {
      key: 'screen_time',
      title: 'Initial screen transitions',
      description: 'Time spent on consent / welcome / survey / tutorial screens.',
      url: '/api/admin/export/telemetry.csv?type=screen_time',
      filename: `telemetry_screen_time_${today}.csv`,
    },
    {
      key: 'annotation_events',
      title: 'Annotation events (created / updated / removed)',
      description: 'Every highlight action with the selected text, character offsets in the transcript, and the running HTML length. Lets you replay the build-up of annotations span by span.',
      url: '/api/admin/export/telemetry.csv?type=annotation_created',
      filename: `telemetry_annotation_created_${today}.csv`,
    },
    {
      key: 'grade_changed',
      title: 'Grade clicks (every radio change)',
      description: 'Every time the annotator selected a different score, BARS, or yes/no value — including hesitations (clicked 3, then 5).',
      url: '/api/admin/export/telemetry.csv?type=grade_changed',
      filename: `telemetry_grade_changed_${today}.csv`,
    },
    {
      key: 'scroll',
      title: 'Transcript scroll positions',
      description: 'Sampled 0.5 Hz while grading. scrollTop / scrollHeight / clientHeight lets you reconstruct what part of the transcript was visible at each moment.',
      url: '/api/admin/export/telemetry.csv?type=scroll',
      filename: `telemetry_scroll_${today}.csv`,
    },
    {
      key: 'all_telemetry',
      title: 'All telemetry (everything)',
      description: 'The entire telemetry table. Largest file. Combines clicks, mouse, step transitions, screen transitions, plus any other tracked events.',
      url: '/api/admin/export/telemetry.csv?type=all',
      filename: `telemetry_all_${today}.csv`,
    },
  ];

  return (
    <div>
      <h2 className="adm-section-title" style={{ marginBottom: 14 }}>Data Export</h2>
      <p className="adm-hint" style={{ marginBottom: 18 }}>
        Each download generates a CSV in the browser. Large files may take a few seconds — the button stays disabled while loading.
      </p>
      <DataDictionary />
      {error && <p className="adm-error" style={{ marginBottom: 12 }}>{error}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 14 }}>
        {exports.map(e => (
          <div key={e.key} className="adm-card" style={{ padding: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>{e.title}</div>
            <p className="adm-hint" style={{ marginBottom: 12, lineHeight: 1.55 }}>{e.description}</p>
            <button
              className="adm-btn"
              disabled={busy[e.key]}
              onClick={() => download(e.key, e.url, e.filename)}
            >
              {busy[e.key] ? 'Generating…' : 'Download CSV'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Accounts (super-admin only) ───────────────────────────────────────────────
function AccountsTab({ token, currentUsername }) {
  const [admins, setAdmins]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [form, setForm]         = useState({ username: '', password: '', role: 'admin' });
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState('');
  const [deleting, setDeleting] = useState({});

  function loadAdmins() {
    api('/api/auth/admins', {}, token)
      .then(d => setAdmins(d.admins || []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadAdmins(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function deleteAdmin(username) {
    if (username === currentUsername) { alert('Cannot delete your own account.'); return; }
    if (!window.confirm(`Delete admin account "${username}"?`)) return;
    setDeleting(d => ({ ...d, [username]: true }));
    try {
      await api(`/api/auth/admins/${encodeURIComponent(username)}`, { method: 'DELETE' }, token);
      loadAdmins();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(d => ({ ...d, [username]: false }));
    }
  }

  async function createAdmin(e) {
    e.preventDefault();
    setCreateMsg(''); setError('');
    setCreating(true);
    try {
      await api('/api/auth/create', {
        method: 'POST',
        body: JSON.stringify(form),
      }, token);
      setCreateMsg(`Account "${form.username}" created.`);
      setForm({ username: '', password: '', role: 'admin' });
      loadAdmins();
    } catch (err) {
      setCreateMsg(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="adm-two-col">
      {/* Existing accounts */}
      <div>
        <h2 className="adm-section-title">Admin Accounts</h2>
        {loading && <p className="adm-info">Loading…</p>}
        {error   && <p className="adm-error">{error}</p>}
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>Username</th><th>Role</th><th>Created</th><th>By</th><th>Last seen</th><th></th></tr></thead>
            <tbody>
              {admins.length === 0 && !loading && (
                <tr><td colSpan={6} className="adm-empty">No accounts yet.</td></tr>
              )}
              {admins.map(a => (
                <tr key={a.username}>
                  <td className="adm-mono">{a.username}{a.username === currentUsername && <span className="adm-muted" style={{ fontSize: 10, marginLeft: 6 }}>(you)</span>}</td>
                  <td><span className={`adm-role adm-role-${a.role}`}>{a.role}</span></td>
                  <td>{a.created_at ? new Date(a.created_at).toLocaleDateString() : '—'}</td>
                  <td className="adm-muted">{a.created_by || '—'}</td>
                  <td className="adm-muted" style={{ fontSize: 11 }}>{a.last_seen ? new Date(a.last_seen).toLocaleString() : 'Never'}</td>
                  <td>
                    {a.username !== currentUsername && (
                      <button className="adm-btn-danger" onClick={() => deleteAdmin(a.username)} disabled={deleting[a.username]}>
                        {deleting[a.username] ? '…' : 'Delete'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create account form */}
      <div>
        <h2 className="adm-section-title">Create Account</h2>
        <form className="adm-card" onSubmit={createAdmin}>
          <label className="adm-label">Username
            <input className="adm-input" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
          </label>
          <label className="adm-label">Password
            <input className="adm-input" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
          </label>
          <label className="adm-label">Role
            <select className="adm-input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              <option value="admin">admin</option>
              <option value="super_admin">super_admin</option>
            </select>
          </label>
          {createMsg && <p className={createMsg.includes('created') ? 'adm-success' : 'adm-error'}>{createMsg}</p>}
          <button className="adm-btn" disabled={creating}>{creating ? 'Creating…' : 'Create account'}</button>
        </form>
      </div>
    </div>
  );
}

// ── Danger Zone (super-admin only) ────────────────────────────────────────────
function DangerTab({ token }) {
  const [confirmText, setConfirmText] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  // Sweep stale state
  const [sweepMinutes, setSweepMinutes] = useState(60);
  const [sweepRunning, setSweepRunning] = useState(false);
  const [sweepResult, setSweepResult]   = useState(null);
  const [sweepError, setSweepError]     = useState('');

  const REQUIRED = 'RESET ALL';

  async function runReset() {
    if (confirmText !== REQUIRED) {
      setError(`Type exactly "${REQUIRED}" to enable the button.`);
      return;
    }
    if (!window.confirm(
      'FINAL CONFIRMATION:\n\nThis will permanently delete every annotator, every annotation, and every telemetry event in the database, and reset the SONA pool counters to zero.\n\nSONA items, admins, and config will be preserved.\n\nThis cannot be undone. Continue?'
    )) return;

    setRunning(true);
    setError('');
    setResult(null);
    try {
      const r = await api('/api/admin/reset-all', {
        method: 'POST',
        body: JSON.stringify({ confirm: REQUIRED }),
      }, token);
      setResult(r);
      setConfirmText('');
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  async function runSweep() {
    const minutes = Number(sweepMinutes);
    if (!Number.isFinite(minutes) || minutes < 1) {
      setSweepError('Timeout must be at least 1 minute.');
      return;
    }
    setSweepRunning(true);
    setSweepError('');
    setSweepResult(null);
    try {
      const r = await api('/api/admin/sweep-stale', {
        method: 'POST',
        body: JSON.stringify({ timeout_minutes: minutes }),
      }, token);
      setSweepResult(r);
    } catch (err) {
      setSweepError(err.message);
    } finally {
      setSweepRunning(false);
    }
  }

  return (
    <div>
      <h2 className="adm-section-title" style={{ color: '#991b1b' }}>Danger Zone</h2>

      {/* Sweep stale assignments (recoverable, frequent operation) */}
      <div style={{
        background: '#fff7ed', border: '1.5px solid #f59e0b', borderRadius: 10,
        padding: 18, marginTop: 12, marginBottom: 18, maxWidth: 720,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 22 }}>⏱</span>
          <h3 style={{ margin: 0, fontSize: 16, color: '#92400e' }}>Sweep Stale Assignments</h3>
        </div>

        <p style={{ fontSize: 13, color: '#78350f', lineHeight: 1.6, margin: '0 0 12px' }}>
          Releases items assigned to annotators whose tab has been closed or idle longer than the timeout below. Released items go back to the pool so incoming annotators can pick them up. The next time the released annotator returns, they're issued <strong>different</strong> items they haven't seen before.
        </p>

        <div style={{ background: '#fff', border: '1px solid #fde68a', borderRadius: 6, padding: 12, marginBottom: 14, fontSize: 12.5, color: '#374151', lineHeight: 1.6 }}>
          <strong>The server already does this automatically every 10 minutes</strong> with a 60-minute timeout. Use this button when you want to force a sweep right now (e.g. before recruiting a new wave) or with a shorter timeout for testing.
          <br /><br />
          Active annotators send a heartbeat every 60 s, so anyone with the app open in a foreground tab will <strong>not</strong> be swept.
        </div>

        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#78350f', marginBottom: 6 }}>
          Timeout (minutes): annotators idle longer than this lose their assignments
        </label>
        <input
          type="number"
          className="adm-input"
          value={sweepMinutes}
          min={1}
          onChange={e => { setSweepMinutes(e.target.value); setSweepError(''); }}
          disabled={sweepRunning}
          style={{ marginBottom: 12, maxWidth: 140 }}
        />

        <button
          onClick={runSweep}
          disabled={sweepRunning}
          style={{
            background: sweepRunning ? '#fcd34d' : '#d97706',
            color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 6,
            fontWeight: 700, fontSize: 13, cursor: sweepRunning ? 'not-allowed' : 'pointer',
          }}
        >
          {sweepRunning ? 'Sweeping…' : `Sweep now (${sweepMinutes} min)`}
        </button>

        {sweepError && <p className="adm-error" style={{ marginTop: 10 }}>{sweepError}</p>}
        {sweepResult && (
          <div style={{ marginTop: 14, padding: 12, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#166534', marginBottom: 6 }}>✓ Sweep complete</div>
            <div style={{ fontSize: 12, color: '#14532d', lineHeight: 1.7, fontFamily: 'monospace' }}>
              annotators scanned:    {sweepResult.scanned}<br/>
              annotators swept:      {sweepResult.swept}<br/>
              items released:        {sweepResult.items_released}<br/>
              timeout:               {sweepResult.timeout_minutes} min<br/>
              by:                    {sweepResult.performed_by} at {new Date(sweepResult.performed_at).toLocaleString()}
            </div>
          </div>
        )}
      </div>

      <div style={{
        background: '#fef2f2', border: '2px solid #dc2626', borderRadius: 10,
        padding: 18, marginTop: 12, maxWidth: 720,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 22 }}>⚠</span>
          <h3 style={{ margin: 0, fontSize: 16, color: '#991b1b' }}>Reset All Pilot Data</h3>
        </div>

        <p style={{ fontSize: 13, color: '#7f1d1d', lineHeight: 1.6, margin: '0 0 12px' }}>
          Wipes <strong>every annotator</strong>, <strong>every annotation</strong>, and <strong>every telemetry event</strong> in the database, and resets the SONA pool counters back to zero. Use this once between pilot and real study.
        </p>

        <div style={{ background: '#fff', border: '1px solid #fecaca', borderRadius: 6, padding: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }}>What gets deleted</div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, color: '#374151', lineHeight: 1.7 }}>
            <li><strong>paa-annotators</strong> — all Prolific IDs and their profiles, sessions, assigned items</li>
            <li><strong>paa-annotations</strong> — every grade, highlight, and STAR annotation</li>
            <li><strong>paa-telemetry</strong> — every click, mouse, scroll, step-time and screen-time event</li>
            <li><strong>paa-sona-items meta rows</strong> — pool counters reset to 0 (the items themselves are kept)</li>
          </ul>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginTop: 12, marginBottom: 6 }}>What is preserved</div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, color: '#374151', lineHeight: 1.7 }}>
            <li><strong>paa-admins</strong> — admin accounts</li>
            <li><strong>paa-config</strong> — study configuration</li>
            <li><strong>paa-sona-items</strong> — item transcripts, audio URLs, and eligibility flags</li>
          </ul>
        </div>

        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#7f1d1d', marginBottom: 6 }}>
          Type <code style={{ background: '#fff', padding: '2px 6px', borderRadius: 3, fontFamily: 'monospace', color: '#991b1b' }}>RESET ALL</code> to enable the button:
        </label>
        <input
          className="adm-input"
          value={confirmText}
          onChange={e => { setConfirmText(e.target.value); setError(''); }}
          placeholder="RESET ALL"
          disabled={running}
          style={{ marginBottom: 12, borderColor: confirmText === REQUIRED ? '#16a34a' : '#fecaca' }}
        />

        <button
          onClick={runReset}
          disabled={running || confirmText !== REQUIRED}
          style={{
            background: (running || confirmText !== REQUIRED) ? '#fca5a5' : '#dc2626',
            color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 6,
            fontWeight: 700, fontSize: 13, cursor: (running || confirmText !== REQUIRED) ? 'not-allowed' : 'pointer',
          }}
        >
          {running ? 'Wiping data… (may take a minute)' : 'Reset All Tables'}
        </button>

        {error && <p className="adm-error" style={{ marginTop: 10 }}>{error}</p>}
        {result && (
          <div style={{ marginTop: 14, padding: 12, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#166534', marginBottom: 6 }}>✓ Reset complete</div>
            <div style={{ fontSize: 12, color: '#14532d', lineHeight: 1.7, fontFamily: 'monospace' }}>
              annotators deleted:   {result.annotators_deleted}<br/>
              annotations deleted:  {result.annotations_deleted}<br/>
              telemetry deleted:    {result.telemetry_deleted}<br/>
              pool counters reset:  {result.pool_counters_reset}<br/>
              by:                   {result.performed_by} at {new Date(result.performed_at).toLocaleString()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
