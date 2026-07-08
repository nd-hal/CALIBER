import { useState, useEffect, useRef } from 'react';
import './App.css';
import { track, setTelemetryGrader } from './telemetry.js';
import { loginGrader, saveGraderProfile, saveSurvey, fetchAssignedParticipants, saveGrades, completeStudy } from './api.js';
import {
  DEFAULT_Q1, DEFAULT_Q2, BARS_META, GRADE_FIELDS, QUIZ_QUESTIONS,
  EXAMPLE_HIGHLIGHTED_HTML, STAR_RUBRIC, SURVEY_QUESTIONS, SURVEY_OPTIONS, TOUR_STEPS,
  HR_QUESTIONS, DEM_AGE_OPTIONS, DEM_GENDER_OPTIONS, DEM_RACE_OPTIONS,
  SUS_QUESTIONS, SUS_OPTIONS,
  AI_SURVEY_SECTIONS,
} from './data.js';

// ── Post-task AI survey (Automation Desire, Human Agency, AI Attitudes, GAAIS) ─
// Shown after the SUS survey and before the Prolific redirect. Two pages, driven
// by AI_SURVEY_SECTIONS. Calls onComplete(labeledAnswers) when finished. Answers
// live only in this component until submit (a mid-survey refresh restarts it,
// same as the SUS screens).
function AiSurveyScreen({ onComplete }) {
  const [page, setPage]             = useState(1);
  const [answers, setAnswers]       = useState({});
  const [errors, setErrors]         = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const maxPage      = Math.max(...AI_SURVEY_SECTIONS.map(s => s.page));
  const pageSections = AI_SURVEY_SECTIONS.filter(s => s.page === page);
  const reasonVisible = sec => sec.reason && Number(answers[sec.reason.condition.qid]) >= sec.reason.condition.min;

  function setLikert(qid, val) {
    setAnswers(prev => ({ ...prev, [qid]: val }));
    setErrors(prev => prev.filter(e => e !== qid));
  }
  function toggleReason(rid, label) {
    setAnswers(prev => {
      const cur = Array.isArray(prev[rid]) ? prev[rid] : [];
      return { ...prev, [rid]: cur.includes(label) ? cur.filter(x => x !== label) : [...cur, label] };
    });
    setErrors(prev => prev.filter(e => e !== rid));
  }

  // Group a section's questions by their effective option set so a question with
  // its own anchors (e.g. Human Agency Q5) renders under its own header row.
  function optionGroups(sec) {
    const groups = [];
    for (const q of sec.questions) {
      const opts = q.options || sec.options;
      const last = groups[groups.length - 1];
      if (last && last.options === opts) last.questions.push(q);
      else groups.push({ options: opts, questions: [q] });
    }
    return groups;
  }

  function validatePage() {
    const missing = [];
    for (const sec of pageSections) {
      for (const q of sec.questions) if (!answers[q.id]) missing.push(q.id);
      if (reasonVisible(sec)) {
        const arr = answers[sec.reason.id];
        if (!Array.isArray(arr) || arr.length === 0) missing.push(sec.reason.id);
      }
    }
    return missing;
  }

  function buildLabeled() {
    const labeled = {};
    for (const sec of AI_SURVEY_SECTIONS) {
      for (const q of sec.questions) {
        const opts = q.options || sec.options;
        const val  = answers[q.id];
        const opt  = opts.find(o => o.value === val);
        labeled[q.id] = { question: q.text, response_value: val ?? '', response_label: opt ? opt.label : '' };
      }
      if (sec.reason) {
        const shown = reasonVisible(sec);
        const arr   = shown && Array.isArray(answers[sec.reason.id]) ? answers[sec.reason.id] : [];
        labeled[sec.reason.id] = { question: sec.reason.text, response_value: arr, response_label: arr.join(' | '), shown };
      }
    }
    return labeled;
  }

  function next() {
    const missing = validatePage();
    if (missing.length) {
      setErrors(missing);
      const el = document.getElementById('ais-' + missing[0]);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setErrors([]);
    if (page < maxPage) {
      setPage(p => p + 1);
      document.querySelector('.screen')?.scrollTo({ top: 0 });
    } else {
      setSubmitting(true);
      Promise.resolve(onComplete(buildLabeled())).catch(() => setSubmitting(false));
    }
  }

  return (
    <div className="screen" style={{ display: 'flex' }}>
      <div className="sv-inner">
        <div className="screen-logo">Interview <em>Annotation</em> Tool &nbsp;·&nbsp; Prolific Study</div>
        <div className="sv-card">
          <div className="sv-title">A Few Final Questions</div>
          <div className="sv-sub">
            Almost done! Please answer these last questions about AI and this task before we return you to Prolific. (Page {page} of {maxPage})
          </div>
          {errors.length > 0 && (
            <div className="sv-error-banner">Please answer all {errors.length} highlighted item{errors.length > 1 ? 's' : ''} before continuing.</div>
          )}

          {pageSections.map(sec => (
            <div key={sec.key} style={{ marginBottom: 26 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', margin: '6px 0 4px' }}>{sec.title}</h3>
              {sec.intro && <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: '0 0 10px' }}>{sec.intro}</p>}
              {optionGroups(sec).map((grp, gi) => (
                <div key={gi} className="sv-table-wrap" style={{ marginBottom: 8 }}>
                  <table className="sv-table">
                    <thead>
                      <tr>
                        <th className="sv-th-q" />
                        {grp.options.map(o => <th key={o.value} className="sv-th-opt">{o.label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {grp.questions.map((q, i) => {
                        const hasError = errors.includes(q.id);
                        return (
                          <tr key={q.id} id={'ais-' + q.id} className={`sv-row${i % 2 === 0 ? ' sv-row-alt' : ''}${hasError ? ' sv-row-error' : ''}`}>
                            <td className="sv-td-q">{q.text}</td>
                            {grp.options.map(o => (
                              <td key={o.value} className="sv-td-opt" onClick={() => setLikert(q.id, o.value)}>
                                <div className={`sv-radio${answers[q.id] === o.value ? ' sel' : ''}`} />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
              {reasonVisible(sec) && (
                <div id={'ais-' + sec.reason.id} style={{ marginTop: 10, padding: 12, border: `1px solid ${errors.includes(sec.reason.id) ? '#dc2626' : '#e5e7eb'}`, borderRadius: 8, background: errors.includes(sec.reason.id) ? '#fef2f2' : '#f9fafb' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: '#374151', marginBottom: 8 }}>{sec.reason.text}</div>
                  {sec.reason.options.map(opt => {
                    const arr = Array.isArray(answers[sec.reason.id]) ? answers[sec.reason.id] : [];
                    return (
                      <label key={opt} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '4px 0', fontSize: 13, color: '#374151', cursor: 'pointer' }}>
                        <input type="checkbox" checked={arr.includes(opt)} onChange={() => toggleReason(sec.reason.id, opt)} style={{ marginTop: 3 }} />
                        <span>{opt}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          ))}

          <button className="sv-next" disabled={submitting} onClick={next}>
            {page < maxPage ? 'Next  →' : (submitting ? 'Submitting…' : 'Submit  →')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Session storage key ──────────────────────────────────────────────────────
// Only the active Prolific ID is persisted, and only for the duration of the
// browser tab — refresh inside the tab resumes; closing the tab or opening a
// new one requires a fresh login (which is what Prolific expects). Profile
// flags, grading state, and reset-version tracking all live on the server.
const SS_CURRENT = 'caliber_current_grader';

function newPData()        { return { q1: { html: null, transcript: DEFAULT_Q1, grades: {}, step: 1, audioUrl: null }, q2: { html: null, transcript: DEFAULT_Q2, grades: {}, step: 1, audioUrl: null } }; }


// ── Tutorial audio player ─────────────────────────────────────────────────────
// Plays a list of URLs sequentially; calls onDone when all have finished.
// If `optIn` is false, no autoplay and `onDone` is called immediately so the
// surrounding UI never blocks progression on audio.
function TutAudioPlayer({ urls, onDone, done, optIn }) {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const ref = useRef(null);

  // When the URL list changes (new step), reset index
  useEffect(() => { setIdx(0); setPlaying(false); }, [urls]);

  // Apply playback rate whenever it changes or the src changes
  useEffect(() => {
    if (ref.current) ref.current.playbackRate = rate;
  }, [rate, idx, urls]);

  // Auto-play when src is ready, but only if the user opted in
  useEffect(() => {
    if (!ref.current || !urls?.[idx]) return;
    if (optIn === false) return; // text-only mode — don't autoplay
    ref.current.load();
    ref.current.playbackRate = rate;
    ref.current.play().then(() => setPlaying(true)).catch(() => {});
  }, [idx, urls, optIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // If user opted out of audio, mark done immediately so the Next button isn't gated
  useEffect(() => {
    if (optIn === false && urls?.length > 0 && !done) onDone?.();
  }, [optIn, urls, done, onDone]);

  function handleEnded() {
    const next = idx + 1;
    if (next < urls.length) {
      setIdx(next);
    } else {
      setPlaying(false);
      onDone?.();
    }
  }

  if (!urls?.length) return null;

  const multiPart = urls.length > 1;

  return (
    <div className="tut-audio-wrap">
      <audio
        ref={ref}
        src={urls[idx]}
        onEnded={handleEnded}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        controls
        style={{ width: '100%' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>Speed:</span>
          {[1, 1.25, 1.5, 2].map(r => (
            <button
              key={r}
              type="button"
              onClick={() => setRate(r)}
              style={{
                fontSize: 11,
                padding: '3px 9px',
                borderRadius: 4,
                border: `1px solid ${rate === r ? '#2563eb' : '#cbd5e1'}`,
                background: rate === r ? '#dbeafe' : '#fff',
                color: rate === r ? '#1e40af' : '#475569',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {r}x
            </button>
          ))}
        </div>
        {multiPart && (
          <div className="tut-audio-progress" style={{ margin: 0 }}>
            Part {idx + 1} of {urls.length}
          </div>
        )}
      </div>
      {optIn === false ? (
        <div className="tut-audio-status" style={{ background: '#f1f5f9', color: '#6b7280' }}>
          Audio optional — you can play it if you want, but it's not required
        </div>
      ) : done ? (
        <div className="tut-audio-status tut-audio-done">✓ Audio complete — you may proceed</div>
      ) : (
        <div className="tut-audio-status tut-audio-pending">
          {playing ? '▶ Playing — listen before proceeding' : '▶ Press play to listen before proceeding'}
        </div>
      )}
    </div>
  );
}

// ── Tour audio (single clip, with speed control) ──────────────────────────────
function TourAudio({ src, autoPlay, onEnded }) {
  const [rate, setRate] = useState(1);
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.playbackRate = rate;
    if (autoPlay) ref.current.play().catch(() => {});
  }, [src, autoPlay, rate]);

  return (
    <div style={{ marginTop: 10 }}>
      <audio
        ref={ref}
        src={src}
        controls
        onEnded={onEnded}
        style={{ width: '100%' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>Speed:</span>
        {[1, 1.25, 1.5, 2].map(r => (
          <button
            key={r}
            type="button"
            onClick={() => setRate(r)}
            style={{
              fontSize: 11,
              padding: '3px 9px',
              borderRadius: 4,
              border: `1px solid ${rate === r ? '#2563eb' : '#cbd5e1'}`,
              background: rate === r ? '#dbeafe' : '#fff',
              color: rate === r ? '#1e40af' : '#475569',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {r}x
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen]           = useState('login');
  const [graderId, setGraderId]       = useState(() => {
    try { return sessionStorage.getItem(SS_CURRENT) || ''; } catch { return ''; }
  });
  // `graders` is per-tab profile state only — server is authoritative on every
  // page load via loginGrader → /api/session/start. Initial empty object is
  // fine; handleLogin fills it from the server response.
  const [graders, setGraders]         = useState({});
  const [participants, setParticipants] = useState({});
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError]   = useState('');
  const [consentChoice, setConsentChoice] = useState(null);
  const [audioOptIn, setAudioOptIn]   = useState(null); // null = not yet chosen; true = want audio; false = text-only
  const [completionCode, setCompletionCode] = useState('');
  const [submittedAt, setSubmittedAt]       = useState(null);
  const [isReturning, setIsReturning]       = useState(false);
  const [susDone, setSusDone]               = useState(false);
  const [aiSurveyDone, setAiSurveyDone]     = useState(false);
  const [susAnswers, setSusAnswers]         = useState({});
  const [susErrors, setSusErrors]           = useState([]);
  const [susSubmitting, setSusSubmitting]   = useState(false);
  const [countdown, setCountdown]           = useState(3);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const stepEnteredAtRef              = useRef(null); // for step-time telemetry
  const screenEnteredAtRef            = useRef(null); // for screen-time telemetry
  const prevScreenRef                 = useRef(null);

  // grading state
  const [currentPid, setCurrentPid]     = useState(null);
  const [currentQ, setCurrentQ]         = useState('q1');
  const [currentAudioUrl, setCurrentAudioUrl] = useState(null);
  const [gradingStep, setGradingStep] = useState(1);
  const [grades, setGrades]           = useState({});      // { g_s_yn, g_s_sc, ... }
  const [activeRubric, setActiveRubric] = useState('s');
  const [barsQTab, setBarsQTab]       = useState('q1');    // instructions modal bars tab
  const [rubricTab, setRubricTab]     = useState('s');     // instructions modal rubric tab
  const [saveFlash, setSaveFlash]     = useState(false);
  const lastSavedAtRef                = useRef(null); // timestamp of last saveData() call
  const autosaveRef                   = useRef(null);

  // modals & overlays
  const [showInstructions, setShowInstructions] = useState(false);
  const [showOnboarding, setShowOnboarding]     = useState(false);
  const [showLlmIntro, setShowLlmIntro]         = useState(false);
  const [confirmState, setConfirmState] = useState({ show: false, msg: '', okText: 'Yes, continue', cancelText: 'Go back' });
  const confirmResolveRef = useRef(null);
  // Separate state for the 3-button skip-reason dialog
  const [skipState, setSkipState] = useState({ show: false, msg: '' });
  const skipResolveRef = useRef(null);
  const [popup, setPopup]             = useState({ show: false, x: 0, y: 0, isExisting: false });
  const savedRangeRef                 = useRef(null);
  const activeHlSpanRef               = useRef(null);

  // transcript
  const transcriptRef = useRef(null);
  const mdPosRef      = useRef({ x: 0, y: 0 });

  // survey
  const [surveyAnswers, setSurveyAnswers] = useState({});
  const [surveyErrors, setSurveyErrors]   = useState([]);
  const [surveyPage, setSurveyPage]       = useState(1);

  // tutorial
  const [tutStep, setTutStep]   = useState(1);
  const [quizState, setQuizState] = useState({ answers: {}, checked: false, passed: false });
  const [tutAudioUrls, setTutAudioUrls] = useState(null);
  const [tutAudioDone, setTutAudioDone] = useState({});

  // onboarding
  const [obStep, setObStep]     = useState(1);
  const [obSubStep, setObSubStep] = useState(0);
  const [gateOk, setGateOk]    = useState(false);
  const [gateTimer, setGateTimer] = useState(10);
  const [gateScrollOk, setGateScrollOk] = useState(false);
  const gateIntervalRef = useRef(null);

  // tour
  const [tourActive, setTourActive] = useState(false);
  const [tourStepIdx, setTourStepIdx] = useState(0);
  const [tourPos, setTourPos]       = useState({ top: 0, left: 0, transform: '' });
  const [tourErrorMsg, setTourErrorMsg] = useState(null);
  const [tourStepAudioDone, setTourStepAudioDone] = useState(false);
  const tourErrorTimerRef = useRef(null);
  const tourHlClickedRef  = useRef(false);
  const tourHlRemovedRef  = useRef(false);
  const tourCardRef       = useRef(null);

  // ── Init: if we recognise this device's grader and they're fully onboarded,
  //          go straight to the dashboard. Otherwise show login so they go
  //          through the proper first-time flow.
  useEffect(() => {
    track('session_start');

    // Auto-login when Prolific passes the participant ID in the URL.
    // Also capture STUDY_ID and SESSION_ID so we can store them on the
    // annotator record for later auditing.
    const params = new URLSearchParams(window.location.search);
    const prolificPid = params.get('PROLIFIC_PID');
    const studyId     = params.get('STUDY_ID');
    const sessionId   = params.get('SESSION_ID');
    if (studyId)   sessionStorage.setItem('caliber_study_id', studyId);
    if (sessionId) sessionStorage.setItem('caliber_session_id', sessionId);
    if (prolificPid) {
      handleLogin(prolificPid);
      return;
    }

    let storedId = '';
    try { storedId = sessionStorage.getItem(SS_CURRENT) || ''; } catch { /* ignore */ }
    if (storedId) {
      // Always re-run handleLogin so /api/session/start fires and the server
      // is the source of truth for onboarding flags, audio pref, etc.
      handleLogin(storedId);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Track the latest saveData function via a ref so the interval always calls
  // the freshest version (with current currentQ, currentPid, grades closure).
  // Without this, switching Q1→Q2 leaves the interval calling stale saveData
  // which writes Q2's DOM data to the backend tagged as Q1, destroying Q1.
  const saveDataRef = useRef(null);

  // Auto-save every 15 s while grading a real participant
  useEffect(() => {
    clearInterval(autosaveRef.current);
    if (screen !== 'grading' || !currentPid || currentPid === 'Example') return;
    lastSavedAtRef.current = null; // reset when entering a new participant
    autosaveRef.current = setInterval(() => {
      if (gradingStepRef.current !== 'done') saveDataRef.current?.();
    }, 15000);
    return () => clearInterval(autosaveRef.current);
  }, [screen, currentPid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Warn on tab close / page refresh if there are unsaved changes
  useEffect(() => {
    function onBeforeUnload(e) {
      if (screen !== 'grading' || !currentPid || currentPid === 'Example') return;
      const age = lastSavedAtRef.current ? Date.now() - lastSavedAtRef.current : Infinity;
      if (age > 5000) { e.preventDefault(); e.returnValue = ''; }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [screen, currentPid]);

  // Keep the telemetry singleton aware of the current annotator so the
  // global mouse + click handlers stamp the right prolific_id on every event.
  useEffect(() => { setTelemetryGrader(graderId); }, [graderId]);

  // Throttled scroll telemetry on the transcript area while grading.
  // Captures scrollTop / scrollHeight / clientHeight so we can replay what part
  // of the transcript the annotator was looking at over time.
  useEffect(() => {
    if (screen !== 'grading' || !graderId) return;
    const tbody = document.querySelector('.t-body');
    if (!tbody) return;
    let lastTs = 0;
    function onScroll() {
      const now = Date.now();
      if (now - lastTs < 2000) return; // 0.5 Hz cap
      lastTs = now;
      track('scroll', {
        target:       't-body',
        scroll_top:   Math.round(tbody.scrollTop),
        scroll_height:Math.round(tbody.scrollHeight),
        client_height:Math.round(tbody.clientHeight),
        participant:  currentPid,
        question:     currentQ,
        graderId,
      });
    }
    tbody.addEventListener('scroll', onScroll, { passive: true });
    return () => tbody.removeEventListener('scroll', onScroll);
  }, [screen, graderId, currentPid, currentQ]);

  // Time-on-screen telemetry — emit when leaving an initial-flow screen
  useEffect(() => {
    if (!graderId) { prevScreenRef.current = screen; return; }
    const prev = prevScreenRef.current;
    const now = Date.now();
    // Emit duration of the screen we just left, but only for initial-flow screens
    if (prev && screenEnteredAtRef.current && prev !== screen) {
      const TRACKED = ['consent', 'welcome', 'survey', 'tutorial'];
      if (TRACKED.includes(prev)) {
        const ms = now - screenEnteredAtRef.current;
        if (ms > 0 && ms < 60 * 60 * 1000) { // ignore > 1 h (tab-left-open)
          track('screen_time', { from_screen: prev, ms, graderId });
        }
      }
    }
    screenEnteredAtRef.current = now;
    prevScreenRef.current = screen;
  }, [screen, graderId]);

  // Heartbeat — keeps last_seen fresh while annotator is on the app
  useEffect(() => {
    if (!graderId || screen === 'login' || screen === 'consent' || screen === 'audioPref' || screen === 'declined' || screen === 'studyFull' || screen === 'redirectCountdown') return;
    const ping = () => fetch('/api/session/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prolific_id: graderId }),
    }).catch(() => {});
    ping();
    const id = setInterval(ping, 60000);
    return () => clearInterval(id);
  }, [graderId, screen]);

  // Load assigned participants from backend whenever the dashboard becomes visible
  const [participantsFetched, setParticipantsFetched] = useState(false);
  const [currentSessionItems, setCurrentSessionItems] = useState(null); // null = no filter (legacy)
  useEffect(() => {
    // Reset the fetched flag whenever we leave the participant list so the next
    // visit must re-fetch before the auto-redirect can fire.
    if (screen !== 'participantList') { setParticipantsFetched(false); return; }
    if (!graderId) return;
    fetchAssignedParticipants(graderId).then(({ participants: serverParts, currentSessionItems: sessIds }) => {
      // Server is the source of truth — replace state outright.
      setParticipants(serverParts || {});
      setCurrentSessionItems(sessIds && sessIds.length ? sessIds : null);
      setParticipantsFetched(true);
    }).catch(() => setParticipantsFetched(true));
  }, [screen, graderId]);

  // Auto-route to SUS / redirect countdown when the annotator arrives at the
  // participant list with everything already complete and hasn't yet submitted.
  // Gated on `participantsFetched` so we never trigger off stale localStorage
  // data that was loaded into state before the server fetch returns. (Without
  // this, finishing the tour could send a fresh annotator straight to SUS if
  // their browser cache had stale 'done' items from a prior session.)
  useEffect(() => {
    if (screen !== 'participantList' || submittedAt) return;
    if (!participantsFetched) return;
    if (!allItemsDone()) return;
    setScreen(nextScreenAfterAllDone());
  }, [screen, participants, submittedAt, susDone, isReturning, participantsFetched]); // eslint-disable-line react-hooks/exhaustive-deps

  // Redirect-countdown effect: when the user lands on this screen we mark them
  // submitted on the backend, then count down from 3 and redirect to Prolific.
  useEffect(() => {
    if (screen !== 'redirectCountdown') return;
    setCountdown(3);
    let cancelled = false;
    let finalCode = completionCode;
    (async () => {
      try {
        const code = await completeStudy(graderId);
        if (code) finalCode = code;
        setSubmittedAt(new Date().toISOString());
        track('study_submitted', { graderId, returning: isReturning });
      } catch { /* still attempt redirect below */ }
    })();
    const tick = setInterval(() => {
      if (cancelled) return;
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(tick);
          if (finalCode) {
            window.location.href = `https://app.prolific.com/submissions/complete?cc=${encodeURIComponent(finalCode)}`;
          }
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => { cancelled = true; clearInterval(tick); };
  }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Grader helpers ────────────────────────────────────────────────────────
  function updateGrader(id, patch) {
    setGraders(prev => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));
    saveGraderProfile(id, patch).catch(() => {});
  }

  async function handleLogin(id) {
    if (!id.trim()) return;
    const gid = id.trim();
    setLoginLoading(true);
    setLoginError('');
    setConsentChoice(null);
    setSurveyPage(1);

    const prolificMeta = {
      studyId:   sessionStorage.getItem('caliber_study_id')   || undefined,
      sessionId: sessionStorage.getItem('caliber_session_id') || undefined,
    };
    const { valid, profile, studyFull, message } = await loginGrader(gid, prolificMeta);

    if (studyFull) {
      setLoginLoading(false);
      track('study_full', { graderId: gid });
      setScreen('studyFull');
      return;
    }
    if (!valid) {
      setLoginLoading(false);
      setLoginError(message || 'This Prolific ID was not found. Check your ID and try again.');
      track('grader_login_rejected', { graderId: gid });
      return;
    }

    try { sessionStorage.setItem(SS_CURRENT, gid); } catch { /* ignore */ }
    setGraderId(gid);
    setLoginLoading(false);
    track('grader_login', { graderId: gid, returning: !!(profile.surveyDone) });

    // Sync the returned profile into per-tab grader state (not persisted).
    if (Object.keys(profile).length) {
      setGraders(prev => ({ ...prev, [gid]: { ...(prev[gid] || {}), ...profile } }));
    }

    // Restore stored audio preference (defaults to true if missing on a returning user)
    if (profile.audioOptIn !== undefined && profile.audioOptIn !== null) {
      setAudioOptIn(profile.audioOptIn);
    }
    setCompletionCode(profile.completionCode || '');
    setSubmittedAt(profile.submittedAt || null);
    setIsReturning(!!profile.isReturning);
    setSusDone(!!profile.susDone);
    setAiSurveyDone(!!profile.aiSurveyDone);

    if (profile.onboardingDone && profile.consentDone) {
      setScreen('participantList');
    } else if (profile.consentDone) {
      // Already consented — check if audio pref was set
      if (profile.audioOptIn === undefined || profile.audioOptIn === null) {
        setScreen('audioPref');
      } else {
        setScreen(profile.surveyDone ? 'welcome' : 'survey');
      }
    } else {
      setScreen('consent');
    }
  }

  function handleLogout() {
    try { sessionStorage.removeItem(SS_CURRENT); } catch { /* ignore */ }
    setGraderId('');
    setCurrentPid(null);
    setScreen('login');
  }

  // ── Confirm dialog ────────────────────────────────────────────────────────
  function showConfirm(msg, okText = 'Yes, continue', cancelText = 'Go back') {
    return new Promise(resolve => {
      setConfirmState({ show: true, msg, okText, cancelText });
      confirmResolveRef.current = resolve;
    });
  }
  // 3-button dialog for annotation skip reasons — kept separate so it doesn't affect confirmOk
  function showSkipDialog(frameName) {
    return new Promise(resolve => {
      setSkipState({ show: true, msg: `You haven't highlighted any <strong>${frameName}</strong> text. Please select a reason to continue, or go back and add the annotation.` });
      skipResolveRef.current = resolve;
    });
  }
  function confirmOk()     { setConfirmState(s => ({ ...s, show: false })); confirmResolveRef.current?.(true); }
  function confirmCancel() { setConfirmState(s => ({ ...s, show: false })); confirmResolveRef.current?.(false); }

  // ── Survey ────────────────────────────────────────────────────────────────
  function svSelect(qId, val) {
    setSurveyAnswers(prev => ({ ...prev, [qId]: val }));
    setSurveyErrors(prev => prev.filter(e => e !== qId));
  }

  function surveyNext() {
    setSurveyErrors([]);

    if (surveyPage === 1) {
      const required = SURVEY_QUESTIONS.map((_, i) => `sv-q${i + 1}`);
      const missing  = required.filter(id => !surveyAnswers[id]);
      if (missing.length) {
        setSurveyErrors(missing);
        track('survey_submit_blocked', { missing_count: missing.length, page: 1 });
        const el = document.getElementById(missing[0]);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      setSurveyPage(2);
      document.querySelector('.screen')?.scrollTo({ top: 0 });
      return;
    }

    if (surveyPage === 2) {
      const missing = HR_QUESTIONS.map(q => q.id).filter(id => !surveyAnswers[id]);
      if (missing.length) {
        setSurveyErrors(missing);
        const el = document.getElementById(missing[0]);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      setSurveyPage(3);
      document.querySelector('.screen')?.scrollTo({ top: 0 });
      return;
    }

    // Page 3 — demographics
    const demMissing = ['dem_age', 'dem_gender'].filter(id => !surveyAnswers[id]);
    const raceSelected = (surveyAnswers['dem_race'] || []).length > 0;
    if (demMissing.length || !raceSelected) {
      setSurveyErrors([...demMissing, ...(!raceSelected ? ['dem_race'] : [])]);
      return;
    }

    // Build full labelled payload across all three pages
    const labeled = {};
    SURVEY_QUESTIONS.forEach((text, i) => {
      const key = `sv-q${i + 1}`;
      const val = surveyAnswers[key];
      const opt = SURVEY_OPTIONS.find(o => o.value === val);
      labeled[key] = { question: text, response_value: val, response_label: opt?.label ?? '' };
    });
    HR_QUESTIONS.forEach(q => {
      labeled[q.id] = { question: q.text, response_value: surveyAnswers[q.id], response_label: surveyAnswers[q.id] };
    });
    labeled['dem_age']    = { question: 'Age',             response_value: surveyAnswers['dem_age'],    response_label: surveyAnswers['dem_age'] };
    labeled['dem_gender'] = { question: 'Gender identity',  response_value: surveyAnswers['dem_gender'], response_label: surveyAnswers['dem_gender'] };
    const raceVal   = surveyAnswers['dem_race'] || [];
    const raceOther = surveyAnswers['dem_race_other'] || '';
    labeled['dem_race'] = {
      question: 'Race/ethnicity',
      response_value: raceVal,
      response_label: raceVal.map(v => (v === 'Another race/ethnicity' && raceOther) ? `Another race/ethnicity: ${raceOther}` : v).join(', '),
    };

    const payload = { graderId, submitted_at: new Date().toISOString(), responses: labeled };
    track('survey_completed', { answers: { ...surveyAnswers } });
    saveSurvey(graderId, payload).catch(() => {});
    updateGrader(graderId, { surveyDone: true, surveyAnswers: { ...surveyAnswers } });
    setTutStep(1);
    setQuizState({ answers: {}, checked: false, passed: false });
    setScreen('tutorial');
  }

  // ── Tutorial ──────────────────────────────────────────────────────────────

  // Fetch pre-signed URLs for tutorial + tour narration once when either screen opens
  useEffect(() => {
    if ((screen !== 'tutorial' && screen !== 'grading') || tutAudioUrls !== null) return;
    fetch('/api/session/tutorial-audio')
      .then(r => r.json())
      .then(d => setTutAudioUrls(d.urls || {}))
      .catch(() => setTutAudioUrls({})); // on error, don't block progress
  }, [screen, tutAudioUrls]);

  // Reset audio-done gate when the step changes
  useEffect(() => {
    if (screen !== 'tutorial') return;
    setTutAudioDone(prev => ({ ...prev })); // keep prior done steps, just re-render
  }, [tutStep, screen]);

  const TUT_TITLES = ['Part 1: STAR Method Training', 'Task Introduction', 'The STAR Framework', 'Example STAR Response', 'Quick Knowledge Check', 'Your Four Tasks'];
  const TUT_SUBS   = ['Welcome to the training', 'What this task involves', "What you'll be grading", 'See the components in action', 'Test your understanding before continuing', 'What you will do for each interview'];

  function tutGo(step) {
    setTutStep(step);
    if (step === 5) setQuizState({ answers: {}, checked: false, passed: false });
    document.querySelector('.screen')?.scrollTo({ top: 0 });
  }

  const STEPS_WITH_AUDIO = [2, 3, 4, 6];

  function tutNextBlocked() {
    if (STEPS_WITH_AUDIO.includes(tutStep) && tutAudioUrls && !tutAudioDone[tutStep]) return true;
    if (tutStep === 5 && !quizState.passed) return true;
    return false;
  }

  function tutNext() {
    if (tutNextBlocked()) return;
    if (tutStep < 6) { tutGo(tutStep + 1); return; }
    updateGrader(graderId, { tutorialDone: true });
    saveGraderProfile(graderId, { tutorialDone: true }).catch(() => {});
    openOnboarding();
  }

  function quizSelect(qi, oi) {
    if (quizState.checked) return;
    setQuizState(prev => ({ ...prev, answers: { ...prev.answers, [qi]: oi } }));
  }

  function checkQuiz() {
    const allAnswered = QUIZ_QUESTIONS.every((_, qi) => quizState.answers[qi] !== undefined);
    if (!allAnswered) return;
    let correct = 0;
    QUIZ_QUESTIONS.forEach((q, qi) => { if (quizState.answers[qi] === q.correct) correct++; });
    const passed = correct === QUIZ_QUESTIONS.length;
    setQuizState(prev => ({ ...prev, checked: true, passed }));
    track('quiz_submitted', { correct, total: QUIZ_QUESTIONS.length, passed });
  }

  // ── Onboarding ────────────────────────────────────────────────────────────
  const OB_TITLES = ['STAR Annotation', 'STAR Detail Rubric (1–5)', 'BARS Behavioral Anchors', 'Grading Rules'];
  const OB_SUBS   = ['s','t','a','r'];
  const OB_NAMES  = ['Situation','Task','Action','Result'];

  function openOnboarding() {
    // Onboarding modal removed — skip directly to grading + tour.
    // Mark onboarding done so we don't loop back here on next login.
    setScreen('grading');
    updateGrader(graderId, { onboardingDone: true });
    track('onboarding_skipped_legacy', { graderId });
    // Training (the guided tour) comes FIRST; the AI-assisted-highlights intro is
    // shown AFTER training completes — see tourActionClick (isEnd) / skipToGrading.
    startTour();
  }

  function dismissLlmIntro() {
    setShowLlmIntro(false);
    track('llm_intro_dismissed', { graderId });
    setScreen('participantList');
  }

  function startGateFor(_step) {
    clearInterval(gateIntervalRef.current);
    setGateScrollOk(false);
    setGateOk(false);
    setGateTimer(10);
    gateIntervalRef.current = setInterval(() => {
      setGateTimer(prev => {
        if (prev <= 1) { clearInterval(gateIntervalRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);
    // If content fits on screen without scrolling, satisfy the scroll gate immediately
    setTimeout(() => {
      const el = document.querySelector('.ob-body.active');
      if (el && el.scrollHeight <= el.clientHeight + 5) setGateScrollOk(true);
    }, 150);
  }

  useEffect(() => {
    if (gateTimer === 0 && gateScrollOk) setGateOk(true);
    else if (gateTimer === 0 && gateScrollOk) setGateOk(true);
  }, [gateTimer, gateScrollOk]);

  useEffect(() => {
    const timerDone = gateTimer === 0;
    setGateOk(timerDone && gateScrollOk);
  }, [gateTimer, gateScrollOk]);

  function obGoTo(n) {
    const next = Math.max(1, Math.min(4, n));
    setObStep(next);
    if (next === 2) setObSubStep(0);
    startGateFor(next);
  }

  function obNext() {
    if (!gateOk) return;
    if (obStep === 2 && obSubStep < 3) {
      setObSubStep(s => s + 1);
      startGateFor(2);
      return;
    }
    if (obStep === 4) {
      setShowOnboarding(false);
      updateGrader(graderId, { onboardingDone: true });
      track('onboarding_completed', { graderId });
      startTour();
      return;
    }
    obGoTo(obStep + 1);
  }

  function obBack() {
    if (obStep === 2 && obSubStep > 0) {
      setObSubStep(s => s - 1);
      startGateFor(2);
      return;
    }
    obGoTo(obStep - 1);
  }

  function handleObScroll(e) {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop <= el.clientHeight + 30) setGateScrollOk(true);
  }

  // ── Participant list ──────────────────────────────────────────────────────
  function beginGrading(pid) {
    track('grading_started', { participant: pid, graderId });
    persistSilent();
    setCurrentPid(pid);
    const pdata = participants[pid] || newPData();
    // If Q1 is already done and Q2 isn't, jump straight to Q2 so the annotator
    // resumes where they left off instead of re-landing on the completed Q1.
    const q1Done = qStatus(pid, 'q1') === 'done';
    const q2Done = qStatus(pid, 'q2') === 'done';
    const startQ = (q1Done && !q2Done) ? 'q2' : 'q1';
    setCurrentQ(startQ);
    const qdata = pdata[startQ];
    setGrades(qdata.grades || {});
    setGradingStep(qdata.step || 1);
    setActiveRubric('s');
    setCurrentAudioUrl(qdata.audioUrl || null);
    setScreen('grading');
    setTimeout(() => loadTranscript(pid, startQ, pdata), 50);
  }

  // ── Q switching ───────────────────────────────────────────────────────────
  function switchQ(q) {
    if (q === currentQ) return;
    persistSilent();
    track('question_switched', { question: q, participant: currentPid, graderId });
    setCurrentQ(q);
    const pdata = participants[currentPid] || newPData();
    const qdata = pdata[q] || { grades: {}, step: 1 };
    setGrades(qdata.grades || {});
    const newStep = qdata.step || 1;
    setGradingStep(newStep);
    gradingStepRef.current = newStep; // keep ref in sync so autosave sees the correct step
    setActiveRubric('s');
    setCurrentAudioUrl(qdata.audioUrl || null);
    setTimeout(() => loadTranscript(currentPid, q, pdata), 20);
  }

  // ── Transcript DOM management ─────────────────────────────────────────────
  function loadTranscript(pid, q, pdata) {
    if (!transcriptRef.current) return;
    const qdata = (pdata || participants[pid])?.[q];
    if (qdata?.html) {
      transcriptRef.current.innerHTML = qdata.html;
    } else {
      transcriptRef.current.innerText = qdata?.transcript || '';
    }
    reattachAll();
  }

  function reattachAll() {
    if (!transcriptRef.current) return;
    transcriptRef.current.querySelectorAll('.hl').forEach(attachHlListener);
  }

  function attachHlListener(span) {
    // Normalize LLM-hydrated spans to match annotator-created ones.
    // server/lib/hydrate.js emits `<span class="hl hl-s">…</span>` with no
    // data-frame attribute and no letter badge, whereas applyHighlight() sets
    // both. Without data-frame the span is invisible to getAnnotatedFrames()
    // (causing a false "you haven't highlighted any X" dialog on Next) and to
    // the relabel/remove + telemetry paths. Derive the frame from the hl-{x}
    // class and backfill data-frame + badge so LLM and human highlights behave
    // identically. The guards make this idempotent (already-normalized spans
    // are skipped, so applyHighlight's own spans aren't double-badged).
    if (!span.dataset.frame) {
      const m = (span.className || '').match(/hl-([star])\b/i);
      if (m) span.dataset.frame = m[1].toUpperCase();
    }
    // Check for a DIRECT-CHILD badge only — querySelector('.hl-badge') would
    // match a nested inner highlight's badge and wrongly skip the outer span
    // (highlights can now be nested when LLM frames overlap).
    const hasOwnBadge = Array.from(span.children).some(c => c.classList?.contains('hl-badge'));
    if (span.dataset.frame && !hasOwnBadge) {
      const badge = document.createElement('span');
      badge.className = 'hl-badge';
      badge.textContent = span.dataset.frame;
      span.appendChild(badge);
    }

    // Click-on-existing-highlight is also handled by the el-level mouseup
    // (which checks for .hl via target.closest), so this listener is
    // effectively a no-op now. Kept as a hook in case per-span behavior
    // (cursor, hover) needs to attach later.
    span.dataset.hlAttached = '1';
  }

  function snapToWords(range) {
    const isW = c => /\w/.test(c);
    const sn = range.startContainer;
    if (sn.nodeType === Node.TEXT_NODE) {
      let off = range.startOffset;
      while (off > 0 && isW(sn.textContent[off - 1])) off--;
      range.setStart(sn, off);
    }
    const en = range.endContainer;
    if (en.nodeType === Node.TEXT_NODE) {
      let off = range.endOffset;
      while (off < en.textContent.length && isW(en.textContent[off])) off++;
      range.setEnd(en, off);
    }
  }

  // transcript mouse handlers via ref effects
  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;

    function onMouseDown(e) { mdPosRef.current = { x: e.clientX, y: e.clientY }; }

    function onMouseUp(e) {
      if (gradingStepRef.current !== 1) return;
      // Capture event state synchronously — the event object is recycled
      // after the handler returns, so we can't read clientX/target inside
      // the deferred callback below.
      const x = e.clientX, y = e.clientY;
      const target = e.target;
      const dx = Math.abs(x - mdPosRef.current.x);
      const dy = Math.abs(y - mdPosRef.current.y);

      // Defer the getSelection() read. Safari finalizes the selection
      // slightly AFTER mouseup fires, so reading it synchronously sees
      // the old (collapsed) selection and the popup never appears.
      // setTimeout(0) yields to the browser's selection-commit step.
      setTimeout(() => {
        const sel = window.getSelection();
        const hasSel = sel && !sel.isCollapsed && sel.toString().trim().length > 0;

        if (hasSel) {
          const range = sel.getRangeAt(0).cloneRange();
          snapToWords(range);
          if (!range.toString().trim().length) return;
          sel.removeAllRanges(); sel.addRange(range);
          savedRangeRef.current = range;
          activeHlSpanRef.current = null;
          track('text_selected', { participant: currentPid, question: currentQ, graderId, char_count: range.toString().length });
          showFramePopup(x, y, false);
          return;
        }
        if (dx < 5 && dy < 5) {
          const hlSpan = target.closest?.('.hl');
          if (hlSpan) {
            activeHlSpanRef.current = hlSpan;
            savedRangeRef.current = null;
            showFramePopup(x, y, true);
          }
        }
      }, 0);
    }

    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('mouseup', onMouseUp);
    return () => { el.removeEventListener('mousedown', onMouseDown); el.removeEventListener('mouseup', onMouseUp); };
  }, [currentPid, currentQ]);

  const gradingStepRef = useRef(gradingStep);
  useEffect(() => { gradingStepRef.current = gradingStep; }, [gradingStep]);

  // dismiss popup on outside click
  useEffect(() => {
    function onDown(e) {
      const fp = document.getElementById('framePopup');
      if (fp && !fp.contains(e.target) && transcriptRef.current && !transcriptRef.current.contains(e.target)) {
        hideFramePopup();
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { setShowInstructions(false); hideFramePopup(); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // ── Frame popup ───────────────────────────────────────────────────────────
  function showFramePopup(x, y, isExisting) {
    setPopup({ show: true, x, y, isExisting });
    if (isExisting && tourActive) {
      tourHlClickedRef.current = true;
      tourCheckFn();
    }
  }
  function hideFramePopup() {
    setPopup(p => ({ ...p, show: false }));
    activeHlSpanRef.current = null;
    savedRangeRef.current = null;
  }

  // Compute character offset of `node` (start) within the transcript root.
  // Counts only text-node characters so it's stable across HTML re-renders.
  function getCharOffset(root, target, targetOffset) {
    if (!root || !target) return -1;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let count = 0;
    let node;
    while ((node = walker.nextNode())) {
      if (node === target) return count + (targetOffset || 0);
      count += node.textContent.length;
    }
    return -1;
  }

  // Returns { text, start, end } for an existing highlight span, computed
  // against the transcript's plain text.
  function describeSpan(span) {
    const root = transcriptRef.current;
    if (!root || !span) return null;
    // Build full transcript text without the badge inserts so offsets are stable
    const cloneRoot = root.cloneNode(true);
    cloneRoot.querySelectorAll('.hl-badge').forEach(b => b.remove());
    const plainText = cloneRoot.textContent || '';
    // Match the span's text (sans badge) inside plainText
    const spanClone = span.cloneNode(true);
    spanClone.querySelectorAll('.hl-badge').forEach(b => b.remove());
    const text = spanClone.textContent || '';
    const start = plainText.indexOf(text);
    return { text: text.slice(0, 500), start, end: start >= 0 ? start + text.length : -1 };
  }

  function applyHighlight(frame) {
    const isUpdate = !!activeHlSpanRef.current;
    // Capture selected text + character offsets (relative to transcript text)
    // and a rough HTML length so we can reconstruct the annotation timeline.
    let sel = null;
    if (savedRangeRef.current) {
      const r = savedRangeRef.current;
      const start = getCharOffset(transcriptRef.current, r.startContainer, r.startOffset);
      const end   = getCharOffset(transcriptRef.current, r.endContainer,   r.endOffset);
      sel = { text: r.toString().slice(0, 500), start, end };
    } else if (activeHlSpanRef.current) {
      sel = describeSpan(activeHlSpanRef.current);
    }
    track(isUpdate ? 'annotation_updated' : 'annotation_created', {
      frame,
      participant: currentPid,
      question:    currentQ,
      graderId,
      selected_text: sel?.text,
      span_start:    sel?.start,
      span_end:      sel?.end,
      html_len:      transcriptRef.current?.innerHTML?.length,
    });

    if (tourActive && !isUpdate) {
      const step = TOUR_STEPS[tourStepIdx];
      if (step?.frame && frame !== step.frame) {
        const names = { s: 'Situation (S)', t: 'Task (T)', a: 'Action (A)', r: 'Result (R)' };
        clearTimeout(tourErrorTimerRef.current);
        setTourErrorMsg(`<span style="color:#ef4444;font-weight:600">Wrong label.</span> This step needs <strong>${names[step.frame]}</strong>.`);
        tourErrorTimerRef.current = setTimeout(() => setTourErrorMsg(null), 3000);
        hideFramePopup();
        return;
      }
    }

    if (isUpdate) {
      const span = activeHlSpanRef.current;
      span.className = `hl hl-${frame}`;
      span.dataset.frame = frame.toUpperCase();
      const badge = span.querySelector('.hl-badge');
      if (badge) badge.textContent = frame.toUpperCase();
    } else {
      const range = savedRangeRef.current;
      if (!range) { hideFramePopup(); return; }
      const span = document.createElement('span');
      span.className = `hl hl-${frame}`;
      span.dataset.frame = frame.toUpperCase();
      const badge = document.createElement('span');
      badge.className = 'hl-badge';
      badge.textContent = frame.toUpperCase();
      try {
        range.surroundContents(span);
        span.appendChild(badge);
      } catch {
        const frag = range.extractContents();
        span.appendChild(frag);
        span.appendChild(badge);
        range.insertNode(span);
      }
      attachHlListener(span);
      window.getSelection().removeAllRanges();
    }
    hideFramePopup();
    tourCheckFn();
  }

  function removeCurrentHighlight() {
    const span = activeHlSpanRef.current;
    if (!span) return;
    {
      const desc = describeSpan(span);
      track('annotation_removed', {
        frame: span.dataset.frame,
        participant: currentPid,
        question: currentQ,
        graderId,
        selected_text: desc?.text,
        span_start:    desc?.start,
        span_end:      desc?.end,
        html_len:      transcriptRef.current?.innerHTML?.length,
      });
    }
    const parent = span.parentNode;
    Array.from(span.childNodes).forEach(node => {
      if (!node.classList?.contains('hl-badge')) parent.insertBefore(node, span);
    });
    parent.removeChild(span);
    hideFramePopup();
    if (tourActive) { tourHlRemovedRef.current = true; setTimeout(tourCheckFn, 100); }
  }

  function clearAnnotations() {
    if (!tourActive && !window.confirm('Remove all highlights from this transcript?')) return;
    track('annotations_cleared', { participant: currentPid, question: currentQ, graderId });
    if (transcriptRef.current) transcriptRef.current.innerText = transcriptRef.current.innerText;
    if (tourActive) setTimeout(tourCheckFn, 100);
  }

  function getAnnotatedFrames() {
    const s = new Set();
    transcriptRef.current?.querySelectorAll('.hl').forEach(el => {
      // Prefer data-frame (annotator-created spans); fall back to the hl-{x}
      // class so LLM-hydrated spans still count even if not yet normalized.
      let f = (el.dataset.frame || '').toLowerCase();
      if (!f) f = (el.className.match(/hl-([star])\b/i)?.[1] || '').toLowerCase();
      if (f) s.add(f);
    });
    return s;
  }

  // ── Persist / Save ────────────────────────────────────────────────────────
  function collectGrades() {
    const g = {};
    GRADE_FIELDS.forEach(name => {
      const el = document.querySelector(`input[name="${name}"]:checked`);
      if (el) g[name] = el.value;
    });
    return g;
  }

  function persistSilent() {
    if (!currentPid) return;
    // Capture ALL values at call time. Reading them inside the updater would
    // run later (after React batches), by which point switchQ may have already
    // updated gradingStepRef.current to the new question's step → corrupting Q1.
    const html = transcriptRef.current?.innerHTML || null;
    const collected = collectGrades();
    const pid  = currentPid;
    const q    = currentQ;
    const step = gradingStepRef.current;
    setParticipants(prev => ({
      ...prev,
      [pid]: { ...prev[pid], [q]: { ...prev[pid]?.[q], html, grades: collected, step } },
    }));
  }

  function saveData() {
    if (!currentPid || currentPid === 'Example') return; // never auto-save the tour example
    persistSilent();
    // Use the ref (updated synchronously in doSetStep) so we always send the
    // latest step even when called immediately after doSetStep('done').
    const step = gradingStepRef.current;
    const gradePayload = {
      graderId,
      participantId: currentPid,
      question: currentQ,
      step,
      grades: collectGrades(),
      annotationHtml: transcriptRef.current?.innerHTML || null,
    };
    track('grades_saved', { participant: currentPid, question: currentQ, graderId, step });
    saveGrades(gradePayload).catch(() => {});
    lastSavedAtRef.current = Date.now();
    setSaveFlash(true);
    setTimeout(() => setSaveFlash(false), 1500);
  }
  // Keep ref pointing to latest saveData so the autosave interval calls a fresh closure
  saveDataRef.current = saveData;

  // ── Grading step wizard ───────────────────────────────────────────────────
  function stepsStatus(step, n) {
    if (step === 'done' || (typeof step === 'number' && n < step)) return 'gs-done';
    if (n === step) return 'gs-active';
    return '';
  }

  async function gradingNext() {
    const inTour = tourActiveRef.current;
    const frameNames = { s: 'Situation', t: 'Task', a: 'Action', r: 'Result' };

    // During the tour, only allow advancing the grading step when the current
    // tour step explicitly expects it (has needsStep matching the next grading
    // step, or needsDone when moving to 'done'). This prevents users from
    // bypassing tour substeps like "Clear highlights" → "Restore Highlights".
    if (inTour) {
      const tourStep = TOUR_STEPS[tourStepIdxRef.current];
      const nextGradingStep = gradingStep === 4 ? 'done' : (typeof gradingStep === 'number' ? gradingStep + 1 : gradingStep);
      const allows =
        (tourStep?.needsStep !== undefined && tourStep.needsStep === nextGradingStep) ||
        (tourStep?.needsDone && nextGradingStep === 'done');
      if (!allows) return; // tour isn't ready — silently ignore the click
    }

    if (gradingStep === 1) {
      if (!inTour) {
        const present = getAnnotatedFrames();
        for (const f of ['s','t','a','r']) {
          if (!present.has(f)) {
            const choice = await showSkipDialog(frameNames[f]);
            if (choice === false) return; // go back
            setGrades(prev => ({ ...prev, [`g_${f}_skip`]: choice }));
          }
        }
        const sure = await showConfirm('Ready to move to scoring? You <strong>cannot go back</strong> to the annotation step.', 'Yes, start scoring', 'Not yet');
        if (!sure) return;
      }
      persistSilent();
      doSetStep(2);
      if (!inTour && currentPid !== 'Example') { saveData(); saveGraderProfile(graderId, { taskAnnotationDone: true }).catch(() => {}); }

    } else if (gradingStep === 2) {
      if (!inTour) {
        // Require a 1–5 score for ALL frames — including ones marked "Not Present"
        // or "Not Sure" in Task 1. For skipped frames the score communicates the
        // annotator's confidence in the absence.
        const missingScores = ['s','t','a','r'].filter(f => !grades[`g_${f}_sc`]);
        if (missingScores.length > 0) {
          const names = missingScores.map(f => frameNames[f]).join(', ');
          await showConfirm(
            `Please score <strong>${names}</strong> before continuing.`,
            'OK', ''
          );
          return;
        }
        const sure = await showConfirm("Move on to BARS rating? You <strong>cannot go back</strong> to score editing.", 'Yes, continue', 'Not yet');
        if (!sure) return;
      }
      persistSilent();
      doSetStep(3);
      if (!inTour && currentPid !== 'Example') { saveData(); saveGraderProfile(graderId, { taskScoringDone: true }).catch(() => {}); }

    } else if (gradingStep === 3) {
      if (!inTour) {
        if (!grades['g_bars']) {
          await showConfirm('Please select a <strong>BARS score</strong> before continuing.', 'OK', '');
          return;
        }
        const sure = await showConfirm("Move on to the presence check? You <strong>cannot go back</strong> to BARS.", 'Yes, continue', 'Not yet');
        if (!sure) return;
      }
      persistSilent();
      doSetStep(4);
      if (!inTour && currentPid !== 'Example') { saveData(); saveGraderProfile(graderId, { taskBarsDone: true }).catch(() => {}); }

    } else if (gradingStep === 4) {
      if (inTour) {
        // Tour handles the ending — just mark done and let the tour card take over
        doSetStep('done');
        return;
      }
      // Require Yes/No for all non-skipped frames
      const missingYN = ['s','t','a','r'].filter(f =>
        !grades[`g_${f}_skip`] && !grades[`g_${f}_yn`]
      );
      if (missingYN.length > 0) {
        const names = missingYN.map(f => frameNames[f]).join(', ');
        await showConfirm(
          `Please select <strong>Yes</strong> or <strong>No</strong> for <strong>${names}</strong> before completing.`,
          'OK', ''
        );
        return;
      }
      // Stop autosave before the final confirm — prevents a race where
      // a 15-s autosave with step=4 arrives after the step='done' save.
      clearInterval(autosaveRef.current);
      const sure = await showConfirm('Mark this question complete? You <strong>cannot go back</strong> to any previous step.', 'Complete', 'Not yet');
      if (!sure) {
        // User cancelled — restart autosave
        autosaveRef.current = setInterval(() => {
          if (gradingStepRef.current !== 'done') saveData();
        }, 15000);
        return;
      }
      doSetStep('done');
      saveData();
      if (currentQ === 'q1') {
        // Q1 done — go straight to Q2 with no extra confirmation
        switchQ('q2');
      } else {
        const q1done = participants[currentPid]?.q1?.step === 'done';
        if (q1done) {
          saveGraderProfile(graderId, { taskChecklistDone: true }).catch(() => {});
          // Check if this was the LAST item — every other assigned item also done.
          // If so, skip the "back to list" prompt and go straight to SUS or
          // the auto-redirect countdown.
          const pids = Object.keys(participants).filter(p => p !== 'Example');
          const lastOne = pids.length > 0 && pids.every(pid =>
            (pid === currentPid)
              ? true
              : (qStatus(pid, 'q1') === 'done' && qStatus(pid, 'q2') === 'done')
          );
          persistSilent();
          if (lastOne) {
            setScreen(nextScreenAfterAllDone());
          } else {
            // Find the next un-completed SONA item and auto-load it
            const nextPid = Object.keys(participants)
              .filter(p => p !== 'Example' && p !== currentPid)
              .find(p => qStatus(p, 'q1') !== 'done' || qStatus(p, 'q2') !== 'done');
            if (nextPid) {
              await showConfirm(
                `Item complete! You'll now start annotating the next item: <strong>${nextPid}</strong>.`,
                'Continue →', ''
              );
              beginGrading(nextPid);
            } else {
              setScreen('participantList');
            }
          }
        }
      }
    }
  }

  function doSetStep(step) {
    // Emit time-on-step telemetry before transitioning
    if (stepEnteredAtRef.current !== null && currentPid) {
      const ms = Date.now() - stepEnteredAtRef.current;
      track('step_time', { participant: currentPid, question: currentQ, from_step: gradingStepRef.current, ms, graderId });
    }
    stepEnteredAtRef.current = Date.now();
    track('step_entered', { participant: currentPid, question: currentQ, step, graderId });

    setGradingStep(step);
    gradingStepRef.current = step;
    setTimeout(tourCheckFn, 50);
    const scroll = document.querySelector('.g-step-scroll');
    if (scroll) scroll.scrollTop = 0;
  }


  function getSummaryVal(f) {
    const yn = grades[`g_${f}_yn`];
    const sc = grades[`g_${f}_sc`];
    const ynText = yn ? (yn === 'yes' ? 'Yes' : 'No') : '—';
    const scText = sc || '—';
    return `${ynText}  ·  ${scText}/5`;
  }

  function getStructureCount() {
    return ['s','t','a','r'].filter(f => grades[`g_${f}_yn`] === 'yes').length;
  }

  function gradeChange(name, value) {
    setGrades(prev => {
      // Emit telemetry on EVERY radio click so we can replay hesitations
      // (e.g. clicked 3, then 5). Only fire when the value actually changes.
      if (prev[name] !== value) {
        track('grade_changed', {
          name,
          value,
          prev_value:   prev[name],
          participant:  currentPid,
          question:     currentQ,
          grading_step: gradingStepRef.current,
          graderId,
        });
      }
      return { ...prev, [name]: value };
    });
    const f = name.match(/_([star])_sc/)?.[1];
    if (f) { setActiveRubric(f); setTimeout(tourCheckFn, 50); }
    setTimeout(tourCheckFn, 50);
  }

  // ── Tour ──────────────────────────────────────────────────────────────────
  function startTour() {
    track('tour_started', { graderId });
    tourHlClickedRef.current  = false;
    tourHlRemovedRef.current  = false;
    setTourActive(true);
    setTourStepIdx(0);

    // load Example participant for tour
    // Tour Example participant is in-memory only — refreshing mid-tour
    // restarts the tour (acceptable; tour is short and replayable).
    const example = newPData();
    setParticipants(prev => ({ ...prev, Example: example }));
    setCurrentPid('Example');
    setCurrentQ('q1');
    setGrades({});
    setGradingStep(1);
    gradingStepRef.current = 1;
    setTimeout(() => { loadTranscript('Example', 'q1', example); positionTourCard(0); }, 100);
  }

  function positionTourCard(idx) {
    const step = TOUR_STEPS[idx];
    if (!step) return;
    const card = tourCardRef.current;
    const cardW = 310, margin = 18;

    if (!step.target) {
      setTourPos({ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' });
      return;
    }
    const target = document.getElementById(step.target);
    if (!target) { setTourPos({ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }); return; }

    target.classList.add('tour-spotlight');
    const rect = target.getBoundingClientRect();
    const cardH = card?.offsetHeight || 220;
    const clampX = x => Math.max(10, Math.min(x, window.innerWidth - cardW - 10));
    const clampY = y => Math.max(60, Math.min(y, window.innerHeight - cardH - 10));

    let top, left;
    if (step.pos === 'bottom-fixed') {
      // Anchor right below the transcript TEXT (the #transcript element), not
      // the column. If the text only takes half the panel, the card sits in
      // the empty space directly below it. Falls back to viewport bottom if
      // the text overflows past the visible area.
      const tpanel     = document.querySelector('.t-panel');
      const transcript = document.getElementById('transcript');
      const panelRect  = tpanel ? tpanel.getBoundingClientRect() : { left: 0, right: window.innerWidth };
      const textRect   = transcript ? transcript.getBoundingClientRect() : null;
      const colW = panelRect.right - panelRect.left;
      left = Math.max(10, Math.round(panelRect.left + (colW - cardW) / 2));
      const belowText = textRect ? textRect.bottom + 12 : window.innerHeight * 0.55;
      top = Math.max(60, Math.min(belowText, window.innerHeight - cardH - 10));
    } else if (step.pos === 'left') {
      const lp = rect.left - cardW - margin;
      left = clampX(lp > 10 ? lp : rect.right + margin);
      top  = clampY(rect.top);
    } else if (step.pos === 'top') {
      left = clampX(rect.left + rect.width / 2 - cardW / 2);
      const tp = rect.top - cardH - margin;
      top  = clampY(tp > 10 ? tp : rect.bottom + margin);
    } else {
      left = clampX(rect.left);
      top  = clampY(rect.bottom + margin);
    }
    setTourPos({ top, left, transform: '' });
  }

  function showTourStep(idx) {
    document.querySelectorAll('.tour-spotlight').forEach(el => el.classList.remove('tour-spotlight'));
    tourHlClickedRef.current = false;
    tourHlRemovedRef.current = false;
    clearTimeout(tourErrorTimerRef.current);
    setTourErrorMsg(null);
    setTourStepIdx(idx);
    setTourStepAudioDone(false);
    setTimeout(() => positionTourCard(idx), 60);
  }

  const tourStepIdxRef = useRef(tourStepIdx);
  useEffect(() => { tourStepIdxRef.current = tourStepIdx; }, [tourStepIdx]);

  const tourActiveRef = useRef(tourActive);
  useEffect(() => { tourActiveRef.current = tourActive; }, [tourActive]);

  // Keep the Score Reference tab in sync with the tour's currently-active frame
  // so the rubric on the right matches the row the annotator is scoring.
  useEffect(() => {
    if (!tourActive) return;
    const step = TOUR_STEPS[tourStepIdx];
    if (step?.needsScore) setActiveRubric(step.needsScore);
  }, [tourStepIdx, tourActive]);

  function tourCheckFn() {
    if (!tourActiveRef.current) return;
    const idx  = tourStepIdxRef.current;
    const step = TOUR_STEPS[idx];
    if (!step || step.manual) return;

    let done = false;
    if (step.frame) {
      done = getAnnotatedFrames().has(step.frame);
    } else if (step.needsHighlightClick) {
      done = tourHlClickedRef.current;
    } else if (step.needsHighlightRemove) {
      done = tourHlRemovedRef.current;
    } else if (step.needsClear) {
      done = (transcriptRef.current?.querySelectorAll('.hl').length || 0) === 0;
    } else if (step.needsStep !== undefined) {
      done = gradingStepRef.current === step.needsStep;
    } else if (step.needsScore) {
      done = !!document.querySelector(`input[name="g_${step.needsScore}_sc"]:checked`);
    } else if (step.needsAllScores) {
      done = ['s','t','a','r'].every(f => !!document.querySelector(`input[name="g_${f}_sc"]:checked`));
    } else if (step.needsBars) {
      done = !!document.querySelector('input[name="g_bars"]:checked');
    } else if (step.needsAllYN) {
      done = ['s','t','a','r'].every(f => !!document.querySelector(`input[name="g_${f}_yn"]:checked`));
    } else if (step.needsDone) {
      done = gradingStepRef.current === 'done';
    }

    if (done) setTimeout(() => advanceTour(), 400);
  }

  function advanceTour() {
    if (!tourActiveRef.current) return;
    const next = tourStepIdxRef.current + 1;
    if (next >= TOUR_STEPS.length) { endTour(); return; }
    showTourStep(next);
  }

  function tourActionClick() {
    const step = TOUR_STEPS[tourStepIdx];
    if (step?.isRestore) {
      if (transcriptRef.current) transcriptRef.current.innerHTML = EXAMPLE_HIGHLIGHTED_HTML;
      reattachAll();
      advanceTour();
      return;
    }
    if (step?.isEnd) {
      endTour();
      markOnboardingDone();
      // Training complete — now show the AI-assisted-highlights intro. Its
      // dismiss button advances to the participant list.
      setShowLlmIntro(true);
      track('llm_intro_shown', { graderId });
      return;
    }
    advanceTour();
  }

  function endTour() {
    track('tour_completed', { steps_seen: tourStepIdx + 1, graderId });
    setTourActive(false);
    document.querySelectorAll('.tour-spotlight').forEach(el => el.classList.remove('tour-spotlight'));
  }

  function markOnboardingDone() {
    updateGrader(graderId, { onboardingDone: true });
    // Completing the tour means the annotator has practised all 4 grading tasks
    saveGraderProfile(graderId, {
      onboardingDone:       true,
      taskAnnotationDone:   true,
      taskScoringDone:      true,
      taskBarsDone:         true,
      taskChecklistDone:    true,
    }).catch(() => {});
  }

  function skipToGrading() {
    setShowOnboarding(false);
    markOnboardingDone();
    // Even when training is skipped, show the AI-assist intro before grading.
    setShowLlmIntro(true);
    track('llm_intro_shown', { graderId });
  }

  // ── Mini rubric highlight sync ────────────────────────────────────────────
  function getSrmClass(f, score) {
    const sel = grades[`g_${f}_sc`];
    if (sel && parseInt(sel) === score) return `sel-${f}`;
    return '';
  }

  // ── Participant card helper ───────────────────────────────────────────────
  function qStatus(pid, q) {
    const qd = participants[pid]?.[q] || {};
    if (qd.step === 'done') return 'done';
    if (qd.step > 1 || Object.keys(qd.grades || {}).length > 0) return 'prog';
    return 'none';
  }
  const badgeMap = { done: ['plist-bd-done','Done'], prog: ['plist-bd-prog','In progress'], none: ['plist-bd-none','Not started'] };

  // IDs the annotator is expected to grade THIS session. Returning annotators
  // only see their freshly-drawn items; first-time annotators see everything.
  function visibleParticipantIds() {
    const all = Object.keys(participants).filter(p => p !== 'Example');
    if (!currentSessionItems) return all;
    const cur = new Set(currentSessionItems);
    return all.filter(p => cur.has(p));
  }

  // True when every visible participant has both Q1 and Q2 marked done.
  function allItemsDone() {
    const pids = visibleParticipantIds();
    return pids.length > 0 && pids.every(pid =>
      qStatus(pid, 'q1') === 'done' && qStatus(pid, 'q2') === 'done'
    );
  }

  // What screen do we land on after the LAST item is completed?
  //   First-time annotator who hasn't done SUS yet → 'sus'
  //   Otherwise (returning, or already did SUS) → 'redirectCountdown'
  function nextScreenAfterAllDone() {
    if (!susDone && !isReturning) return 'sus';
    if (!aiSurveyDone && !isReturning) return 'aiSurvey';
    return 'redirectCountdown';
  }

  // ── Popup position ────────────────────────────────────────────────────────
  function popupStyle() {
    const m = 10, popW = 238, popH = 150;
    let x = popup.x + m, y = popup.y + m;
    if (x + popW > window.innerWidth - m)  x = popup.x - popW - m;
    if (y + popH > window.innerHeight - m) y = popup.y - popH - m;
    return { left: x, top: y };
  }

  // ── Recent graders (for login screen) ────────────────────────────────────
  const recentGraders = Object.keys(graders).filter(g => g !== graderId).slice(0, 3);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Login Screen ───────────────────────────────────────────── */}
      {screen === 'login' && (
        <div className="screen" style={{ display: 'flex' }}>
          <div className="login-inner">
            <div className="screen-logo">Interview <em>Annotation</em> Tool &nbsp;·&nbsp; Prolific Study</div>
            <div className="login-card">
              <div className="login-card-head">
                <h2>Sign In</h2>
                <p>Enter your grader ID to begin or continue your session.</p>
              </div>
              <div className="login-card-body">
                <label className="login-field-label">Grader ID</label>
                <input
                  className={`login-input${loginError ? ' login-input-error' : ''}`}
                  type="text"
                  placeholder="Enter your Prolific ID"
                  value={graderId}
                  onChange={e => { setGraderId(e.target.value); setLoginError(''); }}
                  onKeyDown={e => { if (e.key === 'Enter' && graderId.trim() && !loginLoading) handleLogin(graderId); }}
                  disabled={loginLoading}
                  autoFocus
                />
                {loginError && (
                  <div className="login-error">{loginError}</div>
                )}
                <button
                  className="login-continue"
                  disabled={!graderId.trim() || loginLoading}
                  onClick={() => handleLogin(graderId)}
                >
                  {loginLoading ? 'Checking…' : 'Continue →'}
                </button>
                {!loginLoading && recentGraders.length > 0 && (
                  <>
                    <div className="login-divider" />
                    <div className="login-recent-label">Recent</div>
                    {recentGraders.map(gid => (
                      <button key={gid} className="login-recent-btn" onClick={() => { setGraderId(gid); handleLogin(gid); }}>
                        {gid}
                      </button>
                    ))}
                  </>
                )}
                <div className="login-footer">Enter the Prolific ID you were given for this study.</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Consent Screen ─────────────────────────────────────────── */}
      {screen === 'consent' && (
        <div className="screen" style={{ display: 'flex' }}>
          <div className="consent-inner">
            <div className="screen-logo">Interview <em>Annotation</em> Tool &nbsp;·&nbsp; Prolific Study</div>
            <div className="consent-card">
              <div className="wc-head">
                <h2>Informed Consent</h2>
                <p style={{ color: '#94a3b8', fontSize: 13, margin: '6px 0 0' }}>
                  Please read the consent form below before continuing.
                </p>
              </div>
              <div className="consent-body">
                <div className="consent-pages">
                  <img src="/consent_p1.png" alt="Consent form page 1" className="consent-page-img" />
                  <img src="/consent_p2.png" alt="Consent form page 2" className="consent-page-img" />
                </div>
                <div className="consent-choices">
                  <label className={`consent-choice${consentChoice === 'agree' ? ' selected' : ''}`}>
                    <input
                      type="radio"
                      name="consent"
                      value="agree"
                      checked={consentChoice === 'agree'}
                      onChange={() => setConsentChoice('agree')}
                    />
                    I agree to participate in this study
                  </label>
                  <label className={`consent-choice consent-choice-no${consentChoice === 'decline' ? ' selected-no' : ''}`}>
                    <input
                      type="radio"
                      name="consent"
                      value="decline"
                      checked={consentChoice === 'decline'}
                      onChange={() => setConsentChoice('decline')}
                    />
                    I do not agree to participate
                  </label>
                </div>
                <button
                  className="wc-begin"
                  disabled={!consentChoice}
                  onClick={() => {
                    if (consentChoice === 'agree') {
                      track('consent_agreed', { graderId, returning: isReturning });
                      saveGraderProfile(graderId, { consentDone: true }).catch(() => {});
                      updateGrader(graderId, { consentDone: true });
                      // Returning annotators skip training and go straight to a
                      // "Welcome Back" screen, then to the participant list.
                      setScreen(isReturning ? 'welcomeBack' : 'audioPref');
                    } else {
                      track('consent_declined', { graderId });
                      setScreen('declined');
                    }
                  }}
                >
                  Continue →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Audio Preference Screen ─────────────────────────────────── */}
      {screen === 'audioPref' && (
        <div className="screen" style={{ display: 'flex' }}>
          <div className="wc-inner">
            <div className="screen-logo">Interview <em>Annotation</em> Tool &nbsp;·&nbsp; Prolific Study</div>
            <div className="wc-card">
              <div className="wc-head">
                <h2>Audio Narration</h2>
              </div>
              <div className="wc-body">
                <p className="wc-intro">
                  Some instruction screens include a short audio narration in addition to the written text.
                  Would you like the audio to play automatically?
                </p>
                <div className="consent-choices" style={{ marginBottom: 20 }}>
                  <label className={`consent-choice${audioOptIn === true ? ' selected' : ''}`}>
                    <input
                      type="radio"
                      name="audioPref"
                      value="yes"
                      checked={audioOptIn === true}
                      onChange={() => setAudioOptIn(true)}
                    />
                    Yes — play audio narration automatically (recommended)
                  </label>
                  <label className={`consent-choice${audioOptIn === false ? ' selected' : ''}`}>
                    <input
                      type="radio"
                      name="audioPref"
                      value="no"
                      checked={audioOptIn === false}
                      onChange={() => setAudioOptIn(false)}
                    />
                    No — I'll read the text. Audio is still available if I want to listen.
                  </label>
                </div>
                <button
                  className="wc-begin"
                  disabled={audioOptIn === null}
                  onClick={() => {
                    track('audio_pref_set', { graderId, optIn: audioOptIn });
                    saveGraderProfile(graderId, { audioOptIn }).catch(() => {});
                    setScreen('welcome');
                  }}
                >
                  Continue →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Declined Screen ─────────────────────────────────────────── */}
      {screen === 'studyFull' && (
        <div className="screen" style={{ display: 'flex' }}>
          <div className="wc-inner">
            <div className="screen-logo">Interview <em>Annotation</em> Tool &nbsp;·&nbsp; Prolific Study</div>
            <div className="wc-card">
              <div className="wc-head">
                <h2>This study is currently full.</h2>
              </div>
              <div className="wc-body">
                <p className="wc-intro">
                  All available interview responses have already been assigned to other participants. Please return your submission on Prolific so you can take a different study.
                </p>
                <p className="wc-intro">
                  If you believe this is a mistake, please contact the researcher through Prolific.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {screen === 'declined' && (
        <div className="screen" style={{ display: 'flex' }}>
          <div className="wc-inner">
            <div className="screen-logo">Interview <em>Annotation</em> Tool &nbsp;·&nbsp; Prolific Study</div>
            <div className="wc-card">
              <div className="wc-head">
                <h2>Thank you for your time.</h2>
              </div>
              <div className="wc-body">
                <p className="wc-intro">
                  Since you chose not to participate, your session has ended. No data has been collected.
                </p>
                <p className="wc-intro">
                  You may now close this window. If you have any questions, please contact the research team through Prolific.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Welcome Screen ─────────────────────────────────────────── */}
      {/* ── Welcome Back (returning annotators) ─────────────────────── */}
      {screen === 'welcomeBack' && (
        <div className="screen" style={{ display: 'flex' }}>
          <div className="wc-inner">
            <div className="screen-logo">Interview <em>Annotation</em> Tool &nbsp;·&nbsp; Prolific Study</div>
            <div className="wc-card">
              <div className="wc-head">
                <h2>Welcome back!</h2>
              </div>
              <div className="wc-body">
                <p className="wc-intro">
                  Thank you for returning to this study.
                </p>
                <div className="tut-info-block tut-info-block-highlight" style={{ marginBottom: 14 }}>
                  <div className="tut-info-label">No training this time</div>
                  <p>
                    Because you completed the STAR method training in your previous session, <strong>you will NOT be taking the training again</strong>. We'll go straight to the evaluation phase.
                  </p>
                </div>
                <p className="wc-intro">
                  You've been assigned <strong>3 new behavioral interview responses</strong> to evaluate. This session will take approximately <strong>30 minutes</strong>. Please ensure you are in a quiet environment before clicking <strong>Next</strong> to begin.
                </p>
                <button className="wc-begin" onClick={() => setScreen('participantList')}>Next &nbsp;→</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SUS feedback survey (first-time annotators, after all items done) ── */}
      {screen === 'sus' && (
        <div className="screen" style={{ display: 'flex' }}>
          <div className="sv-inner">
            <div className="screen-logo">Interview <em>Annotation</em> Tool &nbsp;·&nbsp; Prolific Study</div>
            <div className="sv-card">
              <div className="sv-title">Feedback Survey</div>
              <div className="sv-sub">
                You've completed all your assigned interviews — thank you! Before we send you back to Prolific, please rate the magnitude of your agreement with each statement regarding the digital guidance system you encountered.
              </div>
              {susErrors.length > 0 && (
                <div className="sv-error-banner">Please answer all {susErrors.length} highlighted statement{susErrors.length > 1 ? 's' : ''} before continuing.</div>
              )}
              <div className="sv-table-wrap">
                <table className="sv-table">
                  <thead>
                    <tr>
                      <th className="sv-th-q" />
                      {SUS_OPTIONS.map(o => (
                        <th key={o.value} className="sv-th-opt">{o.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {SUS_QUESTIONS.map((q, i) => {
                      const hasError = susErrors.includes(q.id);
                      return (
                        <tr key={q.id} id={q.id} className={`sv-row${i % 2 === 0 ? ' sv-row-alt' : ''}${hasError ? ' sv-row-error' : ''}`}>
                          <td className="sv-td-q">{q.text}</td>
                          {SUS_OPTIONS.map(o => (
                            <td key={o.value} className="sv-td-opt" onClick={() => {
                              setSusAnswers(prev => ({ ...prev, [q.id]: o.value }));
                              setSusErrors(prev => prev.filter(e => e !== q.id));
                            }}>
                              <div className={`sv-radio${susAnswers[q.id] === o.value ? ' sel' : ''}`} />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button
                className="sv-next"
                disabled={susSubmitting}
                onClick={async () => {
                  const missing = SUS_QUESTIONS.map(q => q.id).filter(id => !susAnswers[id]);
                  if (missing.length) {
                    setSusErrors(missing);
                    const el = document.getElementById(missing[0]);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    return;
                  }
                  setSusSubmitting(true);
                  // Build labelled payload mirroring the survey export shape
                  const labeled = {};
                  SUS_QUESTIONS.forEach(q => {
                    const val = susAnswers[q.id];
                    const opt = SUS_OPTIONS.find(o => o.value === val);
                    labeled[q.id] = { question: q.text, response_value: val, response_label: opt?.label ?? '' };
                  });
                  track('sus_completed', { graderId, answers: { ...susAnswers } });
                  try {
                    await saveGraderProfile(graderId, { susDone: true, susAnswers: labeled });
                  } catch { /* non-fatal */ }
                  setSusDone(true);
                  setScreen('aiSurvey');
                }}
              >
                {susSubmitting ? 'Submitting…' : 'Submit Feedback  →'}
              </button>
              <div className="sv-note">After submitting, you'll be redirected back to Prolific automatically.</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Post-task AI survey (after SUS, before redirect) ───────────── */}
      {screen === 'aiSurvey' && (
        <AiSurveyScreen onComplete={async (labeled) => {
          track('ai_survey_completed', { graderId });
          try { await saveGraderProfile(graderId, { aiSurveyDone: true, aiSurveyAnswers: labeled }); } catch { /* non-fatal; next /start re-fetches */ }
          setAiSurveyDone(true);
          setScreen('redirectCountdown');
        }} />
      )}

      {/* ── Redirect countdown to Prolific ─────────────────────────────── */}
      {screen === 'redirectCountdown' && (
        <div className="screen" style={{ display: 'flex' }}>
          <div className="wc-inner">
            <div className="screen-logo">Interview <em>Annotation</em> Tool &nbsp;·&nbsp; Prolific Study</div>
            <div className="wc-card">
              <div className="wc-head">
                <h2>Thank you! 🎉</h2>
              </div>
              <div className="wc-body">
                <p className="wc-intro" style={{ fontSize: 15 }}>
                  <strong>Please don't close your browser.</strong> You will be redirected to Prolific to validate your task in <strong>{countdown}</strong> second{countdown === 1 ? '' : 's'}…
                </p>
                <p className="wc-intro" style={{ fontSize: 12, color: '#6b7280' }}>
                  If the redirect doesn't happen automatically, the page will not advance — please contact the researcher through Prolific.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {screen === 'welcome' && (
        <div className="screen" style={{ display: 'flex' }}>
          <div className="wc-inner">
            <div className="screen-logo">Interview <em>Annotation</em> Tool &nbsp;·&nbsp; Prolific Study</div>
            <div className="wc-card">
              <div className="wc-head">
                <h2>Welcome, and thank you for participating!</h2>
              </div>
              <div className="wc-body">
                <p className="wc-intro">In this evaluation module, you will assess four behavioral interview responses. The session consists of two distinct parts:</p>
                <p className="wc-intro" style={{ marginLeft: 12 }}>
                  <strong>Part 1:</strong> A brief training on the STAR method to familiarize you with the scoring process.<br />
                  <strong>Part 2:</strong> The evaluation phase, where you will score the interview audio clips.
                </p>
                <p className="wc-intro">As these candidates received STAR method training, your objective is to measure how clearly they structure the <strong>Situation</strong>, <strong>Task</strong>, <strong>Action</strong>, and <strong>Result</strong> in their answers. You will grade each dimension independently using the provided rubric.</p>
                <p className="wc-intro">This session requires approximately <strong>30 minutes</strong>. Please ensure you are in a quiet environment before clicking <strong>Next</strong> to begin.</p>
                <button className="wc-begin" onClick={() => setScreen('survey')}>Next &nbsp;→</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Survey Screen ──────────────────────────────────────────── */}
      {screen === 'survey' && (
        <div className="screen" style={{ display: 'flex' }}>
          <div className="sv-inner">
            <div className="screen-logo">Interview <em>Annotation</em> Tool &nbsp;·&nbsp; Prolific Study</div>
            <div className="sv-card">

              {/* Page progress */}
              <div className="sv-progress">
                {['Personality', 'HR Experience', 'Demographics'].map((label, i) => (
                  <div key={i} className={`sv-progress-step${surveyPage === i + 1 ? ' active' : surveyPage > i + 1 ? ' done' : ''}`}>
                    <div className="sv-progress-dot">{surveyPage > i + 1 ? '✓' : i + 1}</div>
                    <span>{label}</span>
                  </div>
                ))}
              </div>

              {/* ── Page 1: Personality ── */}
              {surveyPage === 1 && <>
                <div className="sv-title">Personality Survey</div>
                <div className="sv-sub">
                  Please rate how well each statement describes you. There are no right or wrong answers — answer honestly based on how you typically think, feel, and behave.
                </div>
                {surveyErrors.length > 0 && (
                  <div className="sv-error-banner">Please answer all {surveyErrors.length} highlighted question{surveyErrors.length > 1 ? 's' : ''} before continuing.</div>
                )}
                <div className="sv-table-wrap">
                  <table className="sv-table">
                    <thead>
                      <tr>
                        <th className="sv-th-q" />
                        {SURVEY_OPTIONS.map(o => (
                          <th key={o.value} className="sv-th-opt">{o.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {SURVEY_QUESTIONS.map((q, i) => {
                        const qId = `sv-q${i + 1}`;
                        const hasError = surveyErrors.includes(qId);
                        return (
                          <tr key={qId} id={qId} className={`sv-row${i % 2 === 0 ? ' sv-row-alt' : ''}${hasError ? ' sv-row-error' : ''}`}>
                            <td className="sv-td-q">{q}</td>
                            {SURVEY_OPTIONS.map(o => (
                              <td key={o.value} className="sv-td-opt" onClick={() => svSelect(qId, o.value)}>
                                <div className={`sv-radio${surveyAnswers[qId] === o.value ? ' sel' : ''}`} />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <button className="sv-next" onClick={surveyNext}>Next &nbsp;→</button>
                <div className="sv-note">Your responses are confidential and used only for research purposes.</div>
              </>}

              {/* ── Page 2: HR Experience ── */}
              {surveyPage === 2 && <>
                <div className="sv-title">HR Experience</div>
                <div className="sv-sub">
                  Please answer the following questions about your professional background. There are no right or wrong answers.
                </div>
                {surveyErrors.length > 0 && (
                  <div className="sv-error-banner">Please answer all highlighted questions before continuing.</div>
                )}
                <div className="sv-qlist">
                  {HR_QUESTIONS.map((q, qi) => {
                    const hasError = surveyErrors.includes(q.id);
                    return (
                      <div key={q.id} id={q.id} className={`sv-qblock${hasError ? ' sv-qblock-error' : ''}`}>
                        <div className="sv-qblock-text">{qi + 1}. {q.text}</div>
                        <div className="sv-qblock-opts">
                          {q.options.map(opt => (
                            <label key={opt} className={`sv-opt-label${surveyAnswers[q.id] === opt ? ' sv-opt-selected' : ''}`}>
                              <input
                                type="radio"
                                name={q.id}
                                value={opt}
                                checked={surveyAnswers[q.id] === opt}
                                onChange={() => {
                                  setSurveyAnswers(prev => ({ ...prev, [q.id]: opt }));
                                  setSurveyErrors(prev => prev.filter(e => e !== q.id));
                                }}
                              />
                              {opt}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button className="sv-next" onClick={surveyNext}>Next &nbsp;→</button>
                <div className="sv-note">Your responses are confidential and used only for research purposes.</div>
              </>}

              {/* ── Page 3: Demographics ── */}
              {surveyPage === 3 && <>
                <div className="sv-title">Demographics</div>
                <div className="sv-sub">
                  These questions help us understand our participant population. All responses are confidential.
                </div>
                {surveyErrors.length > 0 && (
                  <div className="sv-error-banner">Please answer all highlighted questions before submitting.</div>
                )}
                <div className="sv-qlist">
                  {/* Age */}
                  <div id="dem_age" className={`sv-qblock${surveyErrors.includes('dem_age') ? ' sv-qblock-error' : ''}`}>
                    <div className="sv-qblock-text">1. Age</div>
                    <div className="sv-qblock-opts sv-qblock-opts-wrap">
                      {DEM_AGE_OPTIONS.map(opt => (
                        <label key={opt} className={`sv-opt-label${surveyAnswers['dem_age'] === opt ? ' sv-opt-selected' : ''}`}>
                          <input
                            type="radio"
                            name="dem_age"
                            value={opt}
                            checked={surveyAnswers['dem_age'] === opt}
                            onChange={() => {
                              setSurveyAnswers(prev => ({ ...prev, dem_age: opt }));
                              setSurveyErrors(prev => prev.filter(e => e !== 'dem_age'));
                            }}
                          />
                          {opt}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Gender */}
                  <div id="dem_gender" className={`sv-qblock${surveyErrors.includes('dem_gender') ? ' sv-qblock-error' : ''}`}>
                    <div className="sv-qblock-text">2. Gender identity</div>
                    <div className="sv-qblock-opts">
                      {DEM_GENDER_OPTIONS.map(opt => (
                        <label key={opt} className={`sv-opt-label${surveyAnswers['dem_gender'] === opt ? ' sv-opt-selected' : ''}`}>
                          <input
                            type="radio"
                            name="dem_gender"
                            value={opt}
                            checked={surveyAnswers['dem_gender'] === opt}
                            onChange={() => {
                              setSurveyAnswers(prev => ({ ...prev, dem_gender: opt }));
                              setSurveyErrors(prev => prev.filter(e => e !== 'dem_gender'));
                            }}
                          />
                          {opt}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Race/ethnicity */}
                  <div id="dem_race" className={`sv-qblock${surveyErrors.includes('dem_race') ? ' sv-qblock-error' : ''}`}>
                    <div className="sv-qblock-text">
                      3. Race/ethnicity <span className="sv-qblock-note">(select all that apply; U.S.-style categories)</span>
                    </div>
                    <div className="sv-qblock-opts">
                      {DEM_RACE_OPTIONS.map(opt => {
                        const checked = (surveyAnswers['dem_race'] || []).includes(opt);
                        return (
                          <label key={opt} className={`sv-opt-label${checked ? ' sv-opt-selected' : ''}`}>
                            <input
                              type="checkbox"
                              value={opt}
                              checked={checked}
                              onChange={() => {
                                const current = surveyAnswers['dem_race'] || [];
                                const next = checked ? current.filter(v => v !== opt) : [...current, opt];
                                setSurveyAnswers(prev => ({ ...prev, dem_race: next }));
                                if (next.length > 0) setSurveyErrors(prev => prev.filter(e => e !== 'dem_race'));
                              }}
                            />
                            {opt}
                          </label>
                        );
                      })}
                      {(surveyAnswers['dem_race'] || []).includes('Another race/ethnicity') && (
                        <input
                          type="text"
                          className="sv-other-input"
                          placeholder="Please specify…"
                          value={surveyAnswers['dem_race_other'] || ''}
                          onChange={e => setSurveyAnswers(prev => ({ ...prev, dem_race_other: e.target.value }))}
                        />
                      )}
                    </div>
                  </div>
                </div>
                <button className="sv-next" onClick={surveyNext}>Submit Survey &nbsp;→</button>
                <div className="sv-note">Your responses are confidential and used only for research purposes.</div>
              </>}

            </div>
          </div>
        </div>
      )}

      {/* ── Tutorial Screen ────────────────────────────────────────── */}
      {screen === 'tutorial' && (
        <div className="screen" style={{ display: 'flex' }}>
          <div className="tut-inner">
            <div className="screen-logo">Interview <em>Annotation</em> Tool &nbsp;·&nbsp; Prolific Study</div>
            <div className="tut-card">
              <div className="tut-head">
                <div className="tut-head-left">
                  <h3>{TUT_TITLES[tutStep - 1]}</h3>
                  <p>{TUT_SUBS[tutStep - 1]}</p>
                </div>
                <div className="tut-dots">
                  {[1,2,3,4,5,6].map(n => (
                    <div key={n} className={`tut-dot${n === tutStep ? ' active' : n < tutStep ? ' done' : ''}`} />
                  ))}
                </div>
              </div>
              <div className="tut-body">
                {/* Step 1 — Part 1 Begins */}
                {tutStep === 1 && (
                  <div>
                    <div className="tut-step-intro">
                      We will now begin <strong>Part 1</strong>. This section provides a brief training on the four scoring dimensions you will use to evaluate the behavioral interviews using the STAR method.
                    </div>
                  </div>
                )}
                {/* Step 2 — Task Introduction */}
                {tutStep === 2 && (
                  <div>
                    <div className="tut-step-intro">
                      Hi! Welcome to this annotation task. You will evaluate brief behavioral interview responses. For each response, you will review both an audio recording and a text transcript.
                    </div>
                    <div className="tut-info-block">
                      <div className="tut-info-label">The Context</div>
                      <p>
                        Behavioral interviews predict future performance based on past behavior. Strong answers provide concrete, detailed examples rather than vague claims about a candidate's abilities.
                      </p>
                    </div>
                    <div className="tut-info-block tut-info-block-highlight">
                      <div className="tut-info-label">The Golden Rule</div>
                      <p>
                        <strong>Grade based on evidence, not eloquence.</strong> When scoring, focus strictly on the evidence in the answer. Do not reward a candidate simply for sounding polished, and do not penalize them for filler words, pauses, or stuttering in the audio. Your job is to evaluate whether the required elements are present and how well the candidate demonstrates the relevant behavior.
                      </p>
                    </div>
                    <TutAudioPlayer
                      urls={tutAudioUrls?.[1]}
                      done={!!tutAudioDone[2]}
                      onDone={() => setTutAudioDone(p => ({ ...p, 2: true }))}
                      optIn={audioOptIn}
                    />
                  </div>
                )}
                {/* Step 3 — The STAR Method */}
                {tutStep === 3 && (
                  <div>
                    <div className="tut-step-intro">
                      To evaluate how well candidates structured their answers, you will use the STAR method, the exact same framework they were trained on. STAR is a simple formula for organizing a response so you can clearly understand the candidate's story and their exact contribution.
                    </div>
                    <img src="/STAR.png" alt="The STAR method diagram" className="tut-star-img" />
                    <TutAudioPlayer
                      urls={tutAudioUrls?.[2]}
                      done={!!tutAudioDone[3]}
                      onDone={() => setTutAudioDone(p => ({ ...p, 3: true }))}
                      optIn={audioOptIn}
                    />
                  </div>
                )}
                {/* Step 4 — Example STAR Response */}
                {tutStep === 4 && (
                  <div>
                    <div className="tut-step-intro">
                      Here is an example of what a strong response looks like. Notice how the candidate spends most of their time detailing their specific actions.
                    </div>
                    <div className="tut-example-prompt">
                      Prompt: <em>"Tell me about a time when you had to meet a challenging deadline."</em>
                    </div>
                    <div className="tut-example-blocks">
                      {[
                        { k: 's', label: 'Situation', text: '"Last semester, I was leading a team project for my marketing class. We had to create and present a full campaign strategy for a local nonprofit. The deadline was 2 weeks away, and I realized halfway through that we were behind schedule due to delayed feedback from the nonprofit contact."' },
                        { k: 't', label: 'Task',      text: '"My goal was to ensure we met the deadline without sacrificing quality, because this grade counted toward my final GPA."' },
                        { k: 'a', label: 'Action',    text: '"I took several specific steps. First, I did a project audit to identify exactly where we were losing time. Second, I broke down the remaining work into smaller milestones with daily check-ins instead of weekly. Third, I personally reached out to the nonprofit contact to accelerate feedback. Instead of waiting, I sent them draft versions and asked for rapid comments. Fourth, I reorganized task assignments based on each team member\'s strengths, so work was efficient. I also stayed late two nights that week to finalize the presentation deck myself, rather than bottleneck on group meetings."' },
                        { k: 'r', label: 'Result',    text: '"We submitted the campaign two days early. The nonprofit was so pleased they ended up partially implementing our recommendations. Our team scored 95% on the project, and my teammates later told me they appreciated the clear structure I created."' },
                      ].map(({ k, label, text }) => (
                        <div key={k} className="tut-example-block" style={{ borderLeftColor: `var(--${k}-color)` }}>
                          <div className="tut-example-label" style={{ color: `var(--${k}-color)` }}>
                            <span className={`s-tag tag-${k}`} style={{ width:18, height:18, fontSize:10, borderRadius:4 }}>{k.toUpperCase()}</span>
                            {label}
                          </div>
                          <p className="tut-example-text">{text}</p>
                        </div>
                      ))}
                    </div>
                    <TutAudioPlayer
                      urls={tutAudioUrls?.[3]}
                      done={!!tutAudioDone[4]}
                      onDone={() => setTutAudioDone(p => ({ ...p, 4: true }))}
                      optIn={audioOptIn}
                    />
                  </div>
                )}
                {/* Step 6 — Your Four Tasks */}
                {tutStep === 6 && (
                  <div>
                    <div className="tut-step-intro">
                      For every interview, you will complete four distinct tasks. The platform will guide you through each one:
                    </div>
                    <div className="tut-tasks-list">
                      {[
                        {
                          num: '1',
                          title: 'Text Annotation',
                          body: 'Highlight and label the S, T, A, and R text in the transcript.',
                          note: 'Labels can overlap within a single sentence, or stretch across multiple sentences.',
                        },
                        {
                          num: '2',
                          title: 'Structural Score (1–5)',
                          body: 'Grade the thoroughness of each STAR element. Higher scores require the candidate to build and accumulate specific details (e.g., moving from a vague goal to explicit personal stakes).',
                          note: null,
                        },
                        {
                          num: '3',
                          title: 'Competency Score (1–5)',
                          body: 'Grade the actual quality of their skill (e.g., Time Management).',
                          note: 'Crucial Rule: Grade quality completely independently of structure. Do not give a candidate a 5 just because they used a perfect STAR format if their actual underlying strategy was poor.',
                          noteWarning: true,
                        },
                        {
                          num: '4',
                          title: 'Binary Checklist (Yes / No)',
                          body: 'Perform a final Yes/No check. Did they explicitly state a Situation, Task, Action, and Result? Mark "Yes" if the element is present at all, even if the content was weak.',
                          note: null,
                        },
                      ].map(({ num, title, body, note, noteWarning }) => (
                        <div key={num} className="tut-task-block">
                          <div className="tut-task-head">
                            <span className="tut-task-num">{num}</span>
                            <span className="tut-task-title">{title}</span>
                          </div>
                          <p className="tut-task-body">{body}</p>
                          {note && (
                            <div className={`tut-task-note${noteWarning ? ' tut-task-note-warn' : ''}`}>
                              {noteWarning && <strong>Crucial Rule: </strong>}
                              {noteWarning ? note.replace('Crucial Rule: ', '') : note}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <TutAudioPlayer
                      urls={tutAudioUrls?.[5]}
                      done={!!tutAudioDone[6]}
                      onDone={() => setTutAudioDone(p => ({ ...p, 6: true }))}
                      optIn={audioOptIn}
                    />
                  </div>
                )}

                {/* Step 5: Quiz */}
                {tutStep === 5 && (
                  <div>
                    <div className="quiz-intro">Answer the question correctly to continue. You can retry if you get it wrong.</div>
                    {QUIZ_QUESTIONS.map((q, qi) => (
                      <div className="quiz-q" key={qi}>
                        <div className="quiz-q-text" dangerouslySetInnerHTML={{ __html: `${qi + 1}. ${q.text}` }} />
                        <div className="quiz-opts">
                          {q.opts.map((opt, oi) => {
                            let cls = 'quiz-opt';
                            if (quizState.checked) {
                              cls += ' locked';
                              if (oi === q.correct) cls += ' correct';
                              else if (oi === quizState.answers[qi]) cls += ' wrong';
                            } else if (quizState.answers[qi] === oi) cls += ' sel';
                            return (
                              <div key={oi} className={cls} onClick={() => quizSelect(qi, oi)}>{opt}</div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    {!quizState.checked && (
                      <button
                        className="quiz-check-btn"
                        disabled={QUIZ_QUESTIONS.some((_, qi) => quizState.answers[qi] === undefined)}
                        onClick={checkQuiz}
                      >
                        Check Answers
                      </button>
                    )}
                    {quizState.checked && !quizState.passed && (
                      <button className="quiz-check-btn" onClick={() => setQuizState({ answers:{}, checked:false, passed:false })}>Try Again</button>
                    )}
                    {quizState.checked && (
                      <div className={`quiz-result-bar ${quizState.passed ? 'pass' : 'fail'}`}>
                        {quizState.passed
                          ? `✓ All ${QUIZ_QUESTIONS.length} correct! Click Continue to proceed.`
                          : `Review the highlighted answers and try again.`}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="tut-foot">
                <button className="tut-back-btn" disabled={tutStep === 1} onClick={() => tutGo(tutStep - 1)}>← Back</button>
                <span className="tut-counter">Step {tutStep} of 6</span>
                <button className="tut-next-btn" disabled={tutNextBlocked()} onClick={tutNext}>
                  {tutStep === 6 ? 'Continue to Guide →' : 'Next →'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Participant List Screen ─────────────────────────────────── */}
      {screen === 'participantList' && (
        <div className="screen" style={{ display: 'flex' }}>
          <div className="plist-inner">
            <div className="plist-hdr">
              <div className="plist-hdr-left">
                <h2>Participants</h2>
                <p>Select a participant to begin or continue grading their transcripts. Logged in as <strong style={{ color:'#93c5fd' }}>{graderId}</strong></p>
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <button className="plist-add-btn" onClick={handleLogout} style={{ color:'#9ca3af' }}>Log out</button>
              </div>
            </div>
            {(() => {
              const allDone = allItemsDone();
              if (!allDone) return null;
              return (
                <div className="plist-done-banner">
                  {submittedAt ? (
                    <>
                      <div className="plist-done-title">✓ Submitted to Prolific</div>
                      <div className="plist-done-msg">
                        You submitted on {new Date(submittedAt).toLocaleString()}. You can close this tab.
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="plist-done-title">🎉 All annotations complete!</div>
                      <div className="plist-done-msg">
                        Thank you for completing every assigned interview. Submit to Prolific so your work can be approved and paid.
                      </div>
                      <button className="plist-done-btn" onClick={() => setScreen(nextScreenAfterAllDone())}>
                        Continue →
                      </button>
                    </>
                  )}
                </div>
              );
            })()}
            <div className="plist-grid">
              {(() => {
                const visible = visibleParticipantIds().sort();
                if (visible.length === 0) {
                  return <div className="plist-empty">No participants assigned yet.</div>;
                }
                return visible.map(pid => {
                  const q1s = qStatus(pid, 'q1'), q2s = qStatus(pid, 'q2');
                  const label = (q1s === 'done' && q2s === 'done') ? 'Review' : (q1s === 'none' && q2s === 'none') ? 'Begin Grading' : 'Continue Grading';
                  return (
                    <div className="plist-card" key={pid}>
                      <div className="plist-card-id">{pid}</div>
                      <div className="plist-status">
                        <div className="plist-status-row"><span>Q1</span><span className={`plist-badge ${badgeMap[q1s][0]}`}>{badgeMap[q1s][1]}</span></div>
                        <div className="plist-status-row"><span>Q2</span><span className={`plist-badge ${badgeMap[q2s][0]}`}>{badgeMap[q2s][1]}</span></div>
                      </div>
                      <button className="plist-grade-btn" onClick={() => beginGrading(pid)}>{label}</button>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── Main Grading View (always in DOM when screen === grading) ─ */}
      {screen === 'grading' && (
        <>
          {/* Header */}
          <header className="app-header">
            <div className="logo">Interview <em>Annotation</em> Tool</div>
            <span className="logo-sep">|</span>
            <div className="pid-group">
              <span className="pid-label">Participant</span>
              <span className="pid-indicator">{currentPid || '—'}</span>
              <button className="hbtn hbtn-ghost" onClick={async () => {
                if (currentPid && currentPid !== 'Example' && gradingStep !== 'done') {
                  const age = lastSavedAtRef.current ? Date.now() - lastSavedAtRef.current : Infinity;
                  if (age > 5000) {
                    saveData();
                    await new Promise(r => setTimeout(r, 400)); // brief pause to let save register
                  }
                }
                persistSilent(); setScreen('participantList');
              }}>All Participants</button>

              <button className="hbtn hbtn-blue" onClick={() => setShowInstructions(true)}>Guide</button>
              <button className={`hbtn ${saveFlash ? 'hbtn-green' : 'hbtn-blue'}`} onClick={saveData}>
                {saveFlash ? '✓ Saved' : 'Save'}
              </button>
            </div>
          </header>

          {/* Main layout */}
          <div className="app-main">
            {/* Transcript Panel */}
            <div className="t-panel">
              <div className="t-bar">
                <div className="q-tabs">
                  <div className={`q-tab${currentQ === 'q1' ? ' active' : ''}`} id="tab-q1" onClick={() => switchQ('q1')}>Q1</div>
                  {!tourActive && (
                    <div className={`q-tab${currentQ === 'q2' ? ' active' : ''}`} id="tab-q2" onClick={() => switchQ('q2')}>Q2</div>
                  )}
                </div>
                <div className="t-controls">
                  <div className="legend">
                    <div className="ld"><div className="ld-dot" style={{ background:'var(--s-color)' }} />Situation</div>
                    <div className="ld"><div className="ld-dot" style={{ background:'var(--t-color)' }} />Task</div>
                    <div className="ld"><div className="ld-dot" style={{ background:'var(--a-color)' }} />Action</div>
                    <div className="ld"><div className="ld-dot" style={{ background:'var(--r-color)' }} />Result</div>
                  </div>
                  {gradingStep === 1 && (
                    <button className="cbtn" id="clearBtn" onClick={clearAnnotations}>Clear</button>
                  )}
                </div>
              </div>
              {currentAudioUrl && (
                <div className="audio-player-bar">
                  <div className="audio-prompt-label">
                    <span className="audio-prompt-tag">Interview Prompt</span>
                    <span className="audio-prompt-text">{BARS_META[currentQ]?.prompt}</span>
                  </div>
                  <audio controls src={currentAudioUrl} className="audio-el">
                    Your browser does not support audio playback.
                  </audio>
                </div>
              )}
              <div className="t-body">
                <div className="t-hint">
                  <span>Drag to highlight → choose S / T / A / R</span>
                  <span>Click any highlight to relabel or remove</span>
                </div>
                <div
                  id="transcript"
                  ref={transcriptRef}
                  className="transcript-area"
                  spellCheck={false}
                />
              </div>
            </div>

            {/* Grading Panel */}
            <div className="g-panel">
              <div className="g-bar" id="gradingHeader">Grading — {currentQ.toUpperCase()}</div>
              <div className="g-inner">
                {/* Step sidebar */}
                <div className="g-steps">
                  {[1,2,3,4].map((n, i) => (
                    <React.Fragment key={n}>
                      {i > 0 && <div className="gs-connector" />}
                      <div className={`gs-item ${stepsStatus(gradingStep, n)}`} id={`gsi-${n}`}>
                        <div className="gs-num">{n}</div>
                        <div className="gs-label">{['Annotate','Score 1–5','BARS','Present?'][i]}</div>
                      </div>
                    </React.Fragment>
                  ))}
                </div>

                {/* Step content */}
                <div className="g-content">
                  <div className="g-step-scroll">
                    {/* Step 1: Annotate */}
                    <div className={`g-step-panel${gradingStep === 1 ? ' active' : ''}`} id="gsp-1">
                      <div className="g-step-title">Task 1: Text Annotation</div>
                      <div className="g-step-instr">Drag to select text in the transcript, then choose a STAR frame label. Highlight every span that belongs to each frame. A single sentence may carry multiple frames.</div>
                      <div className="g-star-legend">
                        {[['s','Situation','Context, role, setting'],['t','Task','Goal or deadline faced'],['a','Action','Steps personally taken'],['r','Result','Outcome achieved']].map(([k,name,desc]) => (
                          <div className="g-legend-row" key={k}>
                            <span className={`s-tag tag-${k}`}>{k.toUpperCase()}</span>
                            <span className="g-legend-name">{name}</span>
                            <span className="g-legend-desc">{desc}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Step 2: Score */}
                    <div className={`g-step-panel${gradingStep === 2 ? ' active' : ''}`} id="gsp-2">
                      <div className="g-step-title">Task 2: Structural Accumulation Score (1–5)</div>
                      <div className="g-sec">
                        {['s','t','a','r'].map((f, fi) => {
                          const skipReason = grades[`g_${f}_skip`];
                          // During the tour, only enable the frame matching the current step's
                          // `needsScore`. The intro step (no needsScore) disables all rows so
                          // annotators don't bulk-score before being walked through each frame.
                          const tourStep = tourActive ? TOUR_STEPS[tourStepIdx] : null;
                          const tourLocked = tourActive && gradingStep === 2 && (!tourStep?.needsScore || tourStep.needsScore !== f);
                          return (
                            <div className={`star-row${tourLocked ? ' star-row-locked' : ''}`} key={f}>
                              <span className={`s-tag tag-${f}`}>{f.toUpperCase()}</span>
                              <span className="s-name">{['Situation','Task','Action','Result'][fi]}</span>
                              {skipReason && (
                                <span className="score-skip-badge" title={`Marked "${skipReason === 'not_present' ? 'Not Present' : 'Not Sure'}" in Task 1 — please still rate your confidence in the absence`}>
                                  {skipReason === 'not_present' ? 'Not Present' : 'Not Sure'}
                                </span>
                              )}
                              <div className="score-btns">
                                {[1,2,3,4,5].map(v => (
                                  <React.Fragment key={v}>
                                    <input type="radio" name={`g_${f}_sc`} id={`${f}${v}`} value={String(v)}
                                      checked={grades[`g_${f}_sc`] === String(v)}
                                      disabled={tourLocked}
                                      onChange={() => gradeChange(`g_${f}_sc`, String(v))} />
                                    <label htmlFor={`${f}${v}`}>{v}</label>
                                  </React.Fragment>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {/* Mini rubric */}
                      <div className="g-sec">
                        <div className="g-sec-title">Score Reference</div>
                        <div className="srm-tabs">
                          {['s','t','a','r'].map(f => (
                            <button key={f} className={`srm-tab srm-tab-${f}${activeRubric === f ? ' active' : ''}`} id={`srm-btn-${f}`} onClick={() => setActiveRubric(f)}>
                              <span className="srm-tab-dot" />
                              {['Situation','Task','Action','Result'][['s','t','a','r'].indexOf(f)]}
                            </button>
                          ))}
                        </div>
                        {['s','t','a','r'].map(f => (
                          <div key={f} className={`srm-panel${activeRubric === f ? ' active' : ''}`} id={`srmp-${f}`}>
                            <div className="srm-card">
                              {STAR_RUBRIC[f].map(row => (
                                <div key={row.score} className={`srm-row ${getSrmClass(f, row.score)}`} data-score={row.score}>
                                  <div className={`srm-num srm-num-${row.score}`}>{row.score}</div>
                                  <div className="srm-body">
                                    <div className="srm-level">{row.level}</div>
                                    <div className="srm-desc">{row.desc}</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Step 3: BARS */}
                    <div className={`g-step-panel${gradingStep === 3 ? ' active' : ''}`} id="gsp-3">
                      <div className="g-step-title">Task 3: Competency Score (BARS)</div>
                      <div className="bars-prompt" id="barsPrompt">{BARS_META[currentQ].prompt}</div>
                      <div className="bars-row" style={{ marginBottom:14 }}>
                        {[['1','Poor'],['2','Marginal'],['3','Average'],['4','Good'],['5','Excellent']].map(([v, lbl]) => (
                          <div className="bars-btn" key={v}>
                            <input type="radio" name="g_bars" id={`b${v}`} value={v}
                              checked={grades['g_bars'] === v}
                              onChange={() => gradeChange('g_bars', v)} />
                            <label htmlFor={`b${v}`}>
                              <span className="bars-num">{v}</span>
                              <span className="bars-lbl">{lbl}</span>
                            </label>
                          </div>
                        ))}
                      </div>
                      <div className="g-sec-title">
                        Anchor Reference
                        <span style={{ marginLeft:'auto', fontWeight:400, textTransform:'none', letterSpacing:0, fontSize:10, cursor:'pointer', color:'#2563eb' }}
                          onClick={() => { setShowInstructions(true); setBarsQTab(currentQ); }}>
                          Full anchors ↗
                        </span>
                      </div>
                      <div className="bars-ref" id="barsRef">
                        {BARS_META[currentQ].ref.map(({ label, color, desc }) => (
                          <div className="bars-ref-row" key={label}>
                            <span className="brs" style={{ color }}>{label}</span>
                            <span className="brd">{desc}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Step 4: Present */}
                    <div className={`g-step-panel${gradingStep === 4 ? ' active' : ''}`} id="gsp-4">
                      <div className="g-step-title">Task 4: Binary Checklist</div>
                      <div className="g-step-instr">Was each STAR component present in the participant's response?</div>
                      {['s','t','a','r'].map((f, fi) => (
                        <div className="star-row" key={f}>
                          <span className={`s-tag tag-${f}`}>{f.toUpperCase()}</span>
                          <span className="s-name">{['Situation','Task','Action','Result'][fi]}</span>
                          <div className="yn">
                            <input type="radio" name={`g_${f}_yn`} id={`${f}_yes`} value="yes"
                              checked={grades[`g_${f}_yn`] === 'yes'}
                              onChange={() => gradeChange(`g_${f}_yn`, 'yes')} />
                            <label htmlFor={`${f}_yes`}>Yes</label>
                            <input type="radio" name={`g_${f}_yn`} id={`${f}_no`} value="no"
                              checked={grades[`g_${f}_yn`] === 'no'}
                              onChange={() => gradeChange(`g_${f}_yn`, 'no')} />
                            <label htmlFor={`${f}_no`}>No</label>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Done: Summary */}
                    <div className={`g-step-panel${gradingStep === 'done' ? ' active' : ''}`} id="gsp-done">
                      <div className="g-step-title">Complete — Score Summary</div>

                      <div className="sumv2">
                        {/* Section 1 — STAR Structure */}
                        <div className="sumv2-card">
                          <div className="sumv2-head">
                            <div className="sumv2-title">STAR Structure</div>
                            <div className="sumv2-sub">For each component: was it present in the response, and how thoroughly was it described?</div>
                          </div>
                          <div className="sumv2-table">
                            <div className="sumv2-thead">
                              <span>Component</span>
                              <span>Present?</span>
                              <span>Detail score</span>
                            </div>
                            {['s','t','a','r'].map((f, fi) => {
                              const yn = grades[`g_${f}_yn`];
                              const sc = grades[`g_${f}_sc`];
                              return (
                                <div className="sumv2-trow" key={f}>
                                  <span className="sumv2-frame">
                                    <span className={`s-tag tag-${f}`} style={{ display:'inline-flex', width:18, height:18, fontSize:10, borderRadius:4, alignItems:'center', justifyContent:'center' }}>{f.toUpperCase()}</span>
                                    <span>{['Situation','Task','Action','Result'][fi]}</span>
                                  </span>
                                  <span className={`sumv2-present ${yn === 'yes' ? 'is-yes' : yn === 'no' ? 'is-no' : 'is-none'}`} id={`sum_${f}`}>
                                    {yn === 'yes' ? '✓ Yes' : yn === 'no' ? '✗ No' : '— Not rated'}
                                  </span>
                                  <span className="sumv2-score">
                                    {sc ? (
                                      <>
                                        <span className="sumv2-dots">
                                          {[1,2,3,4,5].map(n => (
                                            <span key={n} className={`sumv2-dot dot-${f}${n <= Number(sc) ? ' on' : ''}`} />
                                          ))}
                                        </span>
                                        <span className="sumv2-score-num">{sc} / 5</span>
                                      </>
                                    ) : (
                                      <span className="sumv2-score-na">— not scored</span>
                                    )}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                          <div className="sumv2-total" id="sum_struct">
                            <span>Components present</span>
                            <span className="sumv2-total-val">{getStructureCount()} of 4</span>
                          </div>
                        </div>

                        {/* Section 2 — BARS holistic */}
                        <div className="sumv2-card sumv2-card-bars">
                          <div className="sumv2-head">
                            <div className="sumv2-title">Overall Quality (BARS)</div>
                            <div className="sumv2-sub">Holistic competency rating — independent of how completely STAR was used.</div>
                          </div>
                          <div className="sumv2-bars-body" id="sum_bars">
                            {grades['g_bars'] ? (() => {
                              const v = Number(grades['g_bars']);
                              const anchor = BARS_META[currentQ]?.ref?.find(r => r.label.startsWith(`${v} `));
                              return (
                                <>
                                  <div className="sumv2-bars-numwrap">
                                    <span className="sumv2-bars-num" style={{ color: anchor?.color || '#1e3a8a' }}>{v}</span>
                                    <span className="sumv2-bars-of">/ 5</span>
                                  </div>
                                  <div className="sumv2-bars-pill" style={{ background: anchor?.color || '#1e40af' }}>
                                    {anchor?.label?.replace(/^\d+\s*[–-]\s*/, '') || '—'}
                                  </div>
                                </>
                              );
                            })() : (
                              <span className="sumv2-bars-empty">Not scored</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {tourActive ? (
                        <div style={{ marginTop:14, fontSize:12, color:'#1e40af', lineHeight:1.6, padding:'10px 12px', background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:7, fontWeight:500 }}>
                          Click <strong>All Participants</strong> in the upper ribbon to go to your participant dashboard.
                        </div>
                      ) : (
                        <div style={{ marginTop:14, fontSize:11.5, color:'#065f46', lineHeight:1.6, padding:'10px 12px', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:7 }}>
                          This question is complete. Switch to the other question tab to continue grading.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="g-step-foot">
                    {gradingStep !== 'done' && (
                      <button
                        className={`g-next-btn${gradingStep === 4 ? ' g-btn-complete' : ''}`}
                        id="gNextBtn"
                        onClick={gradingNext}
                      >
                        {gradingStep === 4 ? 'Complete ✓' : 'Next →'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Frame Popup ────────────────────────────────────────────── */}
      {popup.show && (
        <div className="popup show" id="framePopup" style={popupStyle()}>
          <div className="popup-title">Label as</div>
          <div className="frame-grid">
            <button className="fbtn fbtn-s" onClick={() => applyHighlight('s')}>S — Situation</button>
            <button className="fbtn fbtn-t" onClick={() => applyHighlight('t')}>T — Task</button>
            <button className="fbtn fbtn-a" onClick={() => applyHighlight('a')}>A — Action</button>
            <button className="fbtn fbtn-r" onClick={() => applyHighlight('r')}>R — Result</button>
            {popup.isExisting && (
              <button className="fbtn fbtn-remove" id="removeHlBtn" onClick={removeCurrentHighlight}>Remove highlight</button>
            )}
          </div>
        </div>
      )}

      {/* ── Confirm Dialog ─────────────────────────────────────────── */}
      {confirmState.show && (
        <div className="cdlg-overlay" style={{ display:'flex' }}>
          <div className="cdlg-box">
            <div className="cdlg-msg" dangerouslySetInnerHTML={{ __html: confirmState.msg }} />
            <div className="cdlg-actions">
              {confirmState.cancelText && <button className="cdlg-cancel" onClick={confirmCancel}>{confirmState.cancelText}</button>}
              <button className="cdlg-ok" onClick={confirmOk}>{confirmState.okText}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Submit-to-Prolific Dialog ──────────────────────────────── */}
      {showSubmitDialog && (
        <div className="cdlg-overlay" style={{ display: 'flex' }}>
          <div className="cdlg-box">
            <div className="cdlg-msg">
              <strong>Submit your work to Prolific?</strong><br /><br />
              You'll be redirected to Prolific to complete the study. Make sure you're happy with your annotations — you cannot return after submitting.
            </div>
            <div className="cdlg-actions">
              <button className="cdlg-cancel" onClick={() => setShowSubmitDialog(false)} disabled={submitting}>Not yet</button>
              <button className="cdlg-ok" disabled={submitting} onClick={async () => {
                setSubmitting(true);
                try {
                  const code = await completeStudy(graderId);
                  setSubmittedAt(new Date().toISOString());
                  track('study_submitted', { graderId });
                  // Use the freshest code returned (in case admin updated it after login)
                  const finalCode = code || completionCode;
                  if (finalCode) {
                    window.location.href = `https://app.prolific.com/submissions/complete?cc=${encodeURIComponent(finalCode)}`;
                  } else {
                    alert('Your submission was recorded, but no Prolific completion code is configured. Please contact the researcher.');
                    setShowSubmitDialog(false);
                  }
                } catch (err) {
                  alert('Submission failed: ' + err.message);
                  setSubmitting(false);
                }
              }}>
                {submitting ? 'Submitting…' : 'Yes, submit to Prolific'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Skip-reason Dialog (3 buttons) ─────────────────────────── */}
      {skipState.show && (
        <div className="cdlg-overlay" style={{ display:'flex' }}>
          <div className="cdlg-box">
            <div className="cdlg-msg" dangerouslySetInnerHTML={{ __html: skipState.msg }} />
            <div className="cdlg-actions">
              <button className="cdlg-cancel" onClick={() => { setSkipState(s => ({ ...s, show: false })); skipResolveRef.current?.(false); }}>Go Back</button>
              <button className="cdlg-third" onClick={() => { setSkipState(s => ({ ...s, show: false })); skipResolveRef.current?.('not_present'); }}>Not Present</button>
              <button className="cdlg-ok"    onClick={() => { setSkipState(s => ({ ...s, show: false })); skipResolveRef.current?.('not_sure'); }}>Not Sure</button>
            </div>
          </div>
        </div>
      )}

      {/* ── LLM-Augmented Intro Modal (shown once, before the tour) ──── */}
      {showLlmIntro && (
        <div className="modal-overlay" style={{ display:'flex' }}>
          <div className="modal" style={{ maxWidth: 1120, width: '94vw' }}>
            <div className="modal-head">
              <h2>Before you begin: AI-assisted highlights</h2>
            </div>
            <div className="modal-body" style={{ maxHeight: '88vh', overflowY: 'auto' }}>
              <p style={{ fontSize:14.5, color:'#374151', lineHeight:1.7, marginBottom:16 }}>
                This is an <strong>AI-assisted annotation task</strong>. An AI model has <strong>pre-filled the
                Situation, Task, Action, and Result (STAR) highlights</strong> for each transcript. The AI
                <strong> only provides these initial highlights</strong>; you are responsible for
                <strong> assigning all 1–5 scores</strong>.
              </p>
              <div style={{ margin: '4px 0 16px' }}>
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center', marginBottom:6 }}>
                  <span style={{ fontWeight:800, fontSize:14, color:'#1e293b' }}>LLM Provided Highlights</span>
                  <span style={{ fontSize:16, lineHeight:1, color:'#475569' }}>↓</span>
                </div>
                <div
                  className="ob-example"
                  style={{ fontSize:13.5, lineHeight:2, textAlign:'left', border:'1px solid #e5e7eb', borderRadius:10, padding:'14px 18px', background:'#fff' }}
                  dangerouslySetInnerHTML={{ __html: EXAMPLE_HIGHLIGHTED_HTML }}
                />
              </div>
              <p style={{ fontSize:14, color:'#374151', lineHeight:1.7, margin:'0 0 8px' }}>
                Your role as the expert is to <strong>review, correct, and finalize</strong> the AI's work
                rather than starting from a blank page:
              </p>
              <ul style={{ fontSize:14, color:'#374151', lineHeight:1.8, margin:'0 0 14px', paddingLeft:24 }}>
                <li><strong>Edit</strong> highlights by re-labeling or resizing if the span is incorrect.</li>
                <li><strong>Delete</strong> any highlights that do not belong.</li>
                <li><strong>Add</strong> any missing highlights.</li>
                <li><strong>Score</strong> each frame yourself in the subsequent steps.</li>
              </ul>
              <p style={{ fontSize:14, color:'#374151', lineHeight:1.7, margin:0 }}>
                The AI is a <strong>starting point</strong>. You <strong>have the final say</strong>, so please
                feel free to change anything that doesn't look accurate.
              </p>
            </div>
            <div className="modal-foot" style={{ display:'flex', justifyContent:'flex-end', padding:'14px 20px', borderTop:'1px solid #e5e7eb' }}>
              <button className="wc-begin" style={{ margin:0 }} onClick={dismissLlmIntro}>Got it, take me to the interviews &nbsp;→</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Instructions Modal ─────────────────────────────────────── */}
      {showInstructions && (
        <div className="modal-overlay" style={{ display:'flex' }} onClick={e => { if (e.target === e.currentTarget) setShowInstructions(false); }}>
          <div className="modal">
            <div className="modal-head">
              <h2>Annotation &amp; Grading Guide</h2>
              <button className="modal-close" onClick={() => setShowInstructions(false)}>✕</button>
            </div>
            <div className="modal-body">
              {/* Task 1 */}
              <div className="modal-section">
                <div className="modal-task-label">Task 1: Text Annotation Definitions</div>
                <p style={{ fontSize:13, color:'#374151', lineHeight:1.65, marginBottom:12 }}>
                  Highlight and label the text spans that correspond to the four STAR frames.
                  A single sentence may contain multiple frames, or a single frame may stretch across multiple sentences.
                  <br /><br />
                  <strong>Grading approach:</strong> Look for evidence, not eloquence — do not penalize for filler words or reward smooth delivery. Avoid "Halo" bias: grade BARS quality completely independent of STAR structure.
                </p>
                <div className="frame-defs">
                  {[
                    { k:'s', name:'Situation', body:'The context, background, or setting of the story.', look:'Look for: time, place, role, or general environment — "During an internship I did this past summer…"' },
                    { k:'t', name:'Task',      body:'The specific problem, goal, or deadline the student had to meet.', look:'Look for: what was required of them — "we had a project where the deadline was in about a couple weeks"' },
                    { k:'a', name:'Action',    body:'The specific, observable steps the student took to solve the problem.', look:'Look for: first-person "I" statements — "make sure to touch base with the team every day"' },
                    { k:'r', name:'Result',    body:'The outcome, impact, or learning that occurred because of the action.', look:'Look for: finishing, grades, feedback — "ultimately that led to us being able to meet our deadline"' },
                  ].map(({ k, name, body, look }) => (
                    <div key={k} className="frame-def" style={{ borderLeftColor:`var(--${k}-color)` }}>
                      <div className="frame-def-head">
                        <span className={`s-tag tag-${k}`} style={{ width:20, height:20, fontSize:10, borderRadius:4 }}>{k.toUpperCase()}</span>
                        <span className="frame-def-name">{name}</span>
                      </div>
                      <div className="frame-def-body">{body}</div>
                      <div className="frame-def-look">{look}</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Task 2 */}
              <div className="modal-section">
                <div className="modal-task-label">Task 2: Structural Accumulation Score (1–5)</div>
                <p style={{ fontSize:13, color:'#374151', lineHeight:1.65, marginBottom:12 }}>
                  Grade the structure based on how many elements the candidate successfully accumulates. Each score level builds on the previous one — a higher score requires the candidate to have stated all the elements of the lower levels plus additional specific details.
                </p>
                <div className="modal-section-title" style={{ marginBottom: 8 }}>Rubric by Frame</div>
                <div className="rubric-tabs">
                  {['s','t','a','r'].map((f, fi) => (
                    <button key={f} className={`rubric-tab rt-${f}${rubricTab === f ? ' active' : ''}`} onClick={() => setRubricTab(f)}>
                      {['S — Situation','T — Task','A — Action','R — Result'][fi]}
                    </button>
                  ))}
                </div>
                {['s','t','a','r'].map(f => (
                  <div key={f} className={`rubric-panel${rubricTab === f ? ' active' : ''}`} id={`rpanel-${f}`}>
                    <div className="rubric-rows">
                      {STAR_RUBRIC[f].map(row => (
                        <div key={row.score} className="rubric-row">
                          <div className="rubric-score" style={{ color: ['#059669','#3b82f6','#d97706','#f97316','#ef4444'][5 - row.score] }}>{row.score}</div>
                          <div className="rubric-content">
                            <div className="rubric-level">{row.level}</div>
                            <div className="rubric-desc">{row.desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="modal-section" id="guide-section-bars">
                <div className="modal-task-label">Task 3: BARS Behavioral Anchors</div>
                <div className="bars-q-tabs">
                  {['q1','q2'].map((q, qi) => (
                    <button key={q} className={`bars-q-tab${barsQTab === q ? ' active' : ''}`} onClick={() => setBarsQTab(q)}>
                      {['Q1','Q2'][qi]}
                    </button>
                  ))}
                </div>
                {['q1','q2'].map(q => (
                  <div key={q} style={{ display: barsQTab === q ? 'block' : 'none' }}>
                    <div className="bars-competency">{q === 'q1' ? 'Question 1' : 'Question 2'}</div>
                    <div className="bars-anchor-prompt">{BARS_META[q].prompt}</div>
                    {q === 'q1' ? (
                      <>
                        <AnchorCard score={5} color="#059669" label="Excellent" short="Strategic planning + resource negotiation + quantifiable outcome"
                          quote='"I broke the project into daily milestones. I proactively asked my manager to reassign two non-essential tasks, and I used a shared calendar to keep the team updated. We delivered the project two days early."'
                          note="Participant explicitly describes strategic planning, resource negotiation, and a successful, quantifiable outcome." />
                        <BetweenCard score={4} color="#2563eb" label="Good" short="Between 3 and 5 — some organization, lacks strategic negotiation"
                          body="Response falls between 3 and 5. They show some organization but lack high-level strategic negotiation or proactive resource management." />
                        <AnchorCard score={3} color="#d97706" label="Average — Read this first" short="Brute force effort, met deadline but no systemic planning"
                          quote='"I just stayed late every night and worked through the weekend until it was done. I drank a lot of coffee and pushed through it. I met the deadline, but I was exhausted."'
                          note="Participant relies on brute-force effort and longer hours rather than systemic planning or communication." />
                        <BetweenCard score={2} color="#ea580c" label="Marginal" short="Between 1 and 3 — struggled significantly, barely finished"
                          body="Response falls between 1 and 3. They struggled significantly but barely managed to finish." />
                        <AnchorCard score={1} color="#dc2626" label="Poor" short="Poor planning, panic, or missed the deadline"
                          quote={"\"I panicked because there wasn't enough time. I tried to do it all at the last minute, ignored my other work, and ended up missing the deadline.\""}
                          note="Participant describes poor planning, panic, or failing to meet the objective entirely." />
                      </>
                    ) : (
                      <>
                        <AnchorCard score={5} color="#059669" label="Excellent" short="Logical framework + stakeholder communication + delegation"
                          quote='"I reviewed all my tasks and categorized them by urgency and importance. I communicated with stakeholders to push back the deadline on lower-priority items, and I delegated one task to a teammate. All critical tasks were completed on time."'
                          note="Participant describes applying a logical framework, communicating with stakeholders, and successfully managing expectations." />
                        <BetweenCard score={4} color="#2563eb" label="Good" short="Between 3 and 5 — prioritized well, no stakeholder management"
                          body="Response falls between 3 and 5. They prioritized well but did not actively manage external stakeholder expectations." />
                        <AnchorCard score={3} color="#d97706" label="Average — Read this first" short="Basic to-do list, arbitrary prioritization"
                          quote='"I wrote down a to-do list and just started working on whatever was due first. I worked really fast and managed to get most of the things done by the end of the day."'
                          note="Participant uses basic, arbitrary prioritization methods without evaluating strategic importance." />
                        <BetweenCard score={2} color="#ea580c" label="Marginal" short="Between 1 and 3 — attempted to organize, dropped tasks"
                          body="Response falls between 1 and 3. They attempted to organize but still dropped some important tasks." />
                        <AnchorCard score={1} color="#dc2626" label="Poor" short="Chaotic multitasking, overwhelmed, dropped responsibilities"
                          quote='"I tried to multitask and do a little bit of everything at once. I got completely overwhelmed, shut down, and forgot to submit the most important assignment."'
                          note="Participant describes a failure to prioritize, chaotic multitasking, and dropped responsibilities." />
                      </>
                    )}
                  </div>
                ))}
              </div>
              {/* Task 4 */}
              <div className="modal-section">
                <div className="modal-task-label">Task 4: Binary Checklist</div>
                <p style={{ fontSize:13, color:'#374151', lineHeight:1.65, marginBottom:12 }}>
                  Check <strong>Yes (1)</strong> or <strong>No (0)</strong> for each STAR element.<br />
                  <strong>Rule:</strong> Focus on <em>presence</em>, not quality. If the candidate explicitly states an action (e.g., <em>"I just worked faster"</em>), mark <strong>Yes</strong> for Action — even if the action itself was weak or ineffective.
                </p>
                <div className="guide-yn-table">
                  {[
                    { k: 's', label: 'Situation', yes: true,  note: 'Candidate described context' },
                    { k: 't', label: 'Task',      yes: true,  note: 'Candidate stated a goal' },
                    { k: 'a', label: 'Action',    yes: true,  note: 'Candidate described what they did (even if vague)' },
                    { k: 'r', label: 'Result',    yes: false, note: 'No outcome was stated' },
                  ].map(({ k, label, yes, note }) => (
                    <div key={k} className="guide-yn-row">
                      <div className="guide-yn-frame">
                        <span className={`s-tag tag-${k}`} style={{ width:18, height:18, fontSize:9, borderRadius:3 }}>{k.toUpperCase()}</span>
                        <span style={{ fontSize:13, fontWeight:600, color:'#374151' }}>{label}</span>
                      </div>
                      <div className="guide-yn-btns">
                        <span className={`guide-yn-btn${yes ? ' yn-yes' : ''}`}>Yes</span>
                        <span className={`guide-yn-btn${!yes ? ' yn-no' : ''}`}>No</span>
                      </div>
                      <div className="guide-yn-note">{note}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="modal-section">
                <div className="modal-section-title">Grading Instructions</div>
                <p style={{ fontSize:12.5, color:'#374151', lineHeight:1.6, marginBottom:12 }}>
                  You will evaluate each response using <strong>two separate tools</strong>: the <strong>STAR Structure Checklist</strong> and the <strong>BARS</strong>. Grade them independently.
                </p>
                {[
                  ['Look for evidence, not eloquence.', 'Do not penalize for stuttering or filler words, and do not reward smooth delivery. Grade strictly on the presence or absence of the required elements.'],
                  ['Track accumulation (STAR scores).', 'Each level (1–5) builds on the previous one. A participant earns a higher score only by successfully accumulating the required elements.'],
                  ['Set your BARS baseline.', 'Always read the Score 3 (Average) anchor first before grading. Then decide if the response is above, below, or at that level.'],
                  ['Avoid Halo bias.', 'Grade BARS quality completely independent of structure. A beautifully formatted STAR answer can still demonstrate poor strategy.'],
                  ['STAR Checklist is presence-only.', 'Mark Yes if the component appears at all — even weakly. Reserve the 1–5 detail score for quality.'],
                ].map(([title, body], i) => (
                  <div className="rule-box" key={i}>
                    <div className="rule-num">{i + 1}</div>
                    <div className="rule-text"><strong>{title}</strong> {body}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Onboarding Modal ───────────────────────────────────────── */}
      {showOnboarding && <OnboardingModal
        obStep={obStep} obSubStep={obSubStep}
        gateOk={gateOk} gateTimer={gateTimer} gateScrollOk={gateScrollOk}
        onNext={obNext} onBack={obBack} onScroll={handleObScroll}
        onSkipToGrading={skipToGrading}
        graderId={graderId}
        OB_TITLES={OB_TITLES} OB_SUBS={OB_SUBS} OB_NAMES={OB_NAMES}
      />}

      {/* ── Tour Card ─────────────────────────────────────────────── */}
      {tourActive && (() => {
        const tourStep = TOUR_STEPS[tourStepIdx];
        const tourAudioUrls = tourStep?.audioKey ? tutAudioUrls?.[tourStep.audioKey] : null;
        return (
          <div className="tour-card" id="tourCard" ref={tourCardRef} style={{ ...tourPos }}>
            <div className="tour-card-head">
              <span className="tour-step-badge">
                {tourStep?.title || `Tutorial · Step ${tourStepIdx + 1} of ${TOUR_STEPS.length}`}
              </span>
              <span className="tour-progress">{tourStepIdx + 1} / {TOUR_STEPS.length}</span>
            </div>
            <div className="tour-card-body">
              <div className="tour-msg" dangerouslySetInnerHTML={{ __html: tourErrorMsg ?? tourStep?.msg ?? '' }} />
              {tourAudioUrls?.length > 0 && (
                <TourAudio
                  key={tourStepIdx}
                  src={tourAudioUrls[0]}
                  autoPlay={audioOptIn !== false}
                  onEnded={() => setTourStepAudioDone(true)}
                />
              )}
              <div className="tour-foot">
                {tourStep?.manual && (
                  <button
                    className="tour-action-btn"
                    id="tourActionBtn"
                    onClick={tourActionClick}
                    disabled={audioOptIn !== false && !!(tourAudioUrls?.length && !tourStepAudioDone)}
                  >
                    {tourStep.actionLabel || 'Next →'}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────
import React from 'react';

function AnchorCard({ score, color, label, short, quote, note }) {
  return (
    <div className="anchor-card">
      <div className="anchor-head">
        <span className="anchor-score" style={{ color }}>{score}</span>
        <span className="anchor-label" style={{ color }}>{label}</span>
        <span className="anchor-short">{short}</span>
      </div>
      <div className="anchor-body">
        <div className="anchor-quote">{quote}</div>
        <div className="anchor-note">{note}</div>
      </div>
    </div>
  );
}

function BetweenCard({ score, color, label, short, body }) {
  return (
    <div className="anchor-card">
      <div className="anchor-head">
        <span className="anchor-score" style={{ color }}>{score}</span>
        <span className="anchor-label" style={{ color }}>{label}</span>
        <span className="anchor-short">{short}</span>
      </div>
      <div className="anchor-between">{body}</div>
    </div>
  );
}

function OnboardingModal({ obStep, obSubStep, gateOk, gateTimer, gateScrollOk, onNext, onBack, onScroll, graderId, OB_TITLES, OB_SUBS, OB_NAMES }) {
  const OB_STEPS = 4;
  const STAR_RUBRIC_DATA = {
    s: [
      { level:'Complete — 4 elements', desc:'Establishes the setting, the project, the complication, AND the exact timeline/deadline', cls:'ob-rrow-5', ncls:'ob-rnum-5' },
      { level:'Substantial — 3 elements', desc:'Establishes setting, project, and the specific complication they faced', cls:'ob-rrow-4', ncls:'ob-rnum-4' },
      { level:'Partial — 2 elements', desc:'Establishes the setting/role and the project (e.g. "At my internship, we were building a presentation…")', cls:'ob-rrow-3', ncls:'ob-rnum-3' },
      { level:'Minimal — 1 element', desc:'Establishes only one element, usually just the setting or role (e.g. "At my internship…")', cls:'ob-rrow-2', ncls:'ob-rnum-2' },
      { level:'Absent', desc:'Jumps straight to the action or relies on generalizations with no contextual setup', cls:'ob-rrow-1', ncls:'ob-rnum-1' },
    ],
    t: [
      { level:'Complete — adds stakes', desc:'Goal + personal responsibility + parameters + explicit stakes (e.g. "…because this grade counted toward my final GPA")', cls:'ob-rrow-5', ncls:'ob-rnum-5' },
      { level:'Goal + Responsibility + Parameters', desc:'States the personal goal and adds specific criteria for success', cls:'ob-rrow-4', ncls:'ob-rnum-4' },
      { level:'Goal + Personal Responsibility', desc:'States the goal and uses "I" to claim personal ownership', cls:'ob-rrow-3', ncls:'ob-rnum-3' },
      { level:'General Goal Only', desc:'A goal is mentioned but ownership is grouped or implied', cls:'ob-rrow-2', ncls:'ob-rnum-2' },
      { level:'Absent', desc:'No goal or task mentioned at all', cls:'ob-rrow-1', ncls:'ob-rnum-1' },
    ],
    a: [
      { level:'Sequential / Chronological "I" Actions', desc:'Explicitly structures multiple personal actions in a clear sequence', cls:'ob-rrow-5', ncls:'ob-rnum-5' },
      { level:'Multiple Specific "I" Actions', desc:'Breaks the effort into two or more distinct, specific steps the candidate personally took', cls:'ob-rrow-4', ncls:'ob-rnum-4' },
      { level:'Single / Broad "I" Action', desc:'Uses "I" but summarizes effort in one sweeping action', cls:'ob-rrow-3', ncls:'ob-rnum-3' },
      { level:'Passive / Team-focused', desc:'Mentions actions but relies on "We" or passive voice', cls:'ob-rrow-2', ncls:'ob-rnum-2' },
      { level:'Absent / Trait-based', desc:'No concrete actions — relies entirely on general traits', cls:'ob-rrow-1', ncls:'ob-rnum-1' },
    ],
    r: [
      { level:'Quantified Outcome', desc:'Outcome + external feedback + explicit numbers/metrics/grades/time saved', cls:'ob-rrow-5', ncls:'ob-rnum-5' },
      { level:'Outcome + Linkage / Feedback', desc:'Definite outcome AND external validation or key takeaway', cls:'ob-rrow-4', ncls:'ob-rnum-4' },
      { level:'Definite Outcome', desc:'Specific, concrete outcome stated but no metrics or external feedback', cls:'ob-rrow-3', ncls:'ob-rnum-3' },
      { level:'Vague Outcome', desc:'States an outcome but it is highly generic', cls:'ob-rrow-2', ncls:'ob-rnum-2' },
      { level:'Absent', desc:'No outcome provided — story just ends with no resolution stated', cls:'ob-rrow-1', ncls:'ob-rnum-1' },
    ],
  };

  const subLabel = obStep === 2 ? ` — ${OB_NAMES[obSubStep]}` : '';
  const btnDisabled = !gateOk;
  const isLast = obStep === OB_STEPS;
  const isStep2NotLast = obStep === 2 && obSubStep < 3;

  function gateHint() {
    if (gateOk) return '';
    const parts = [];
    if (gateTimer > 0) parts.push(`${gateTimer}s`);
    if (!gateScrollOk) parts.push('scroll ↓');
    return parts.join(' · ');
  }

  const curSub = OB_SUBS[obSubStep];

  return (
    <div className="ob-modal-overlay" style={{ display:'flex' }}>
      <div className="ob-modal">
        <div className="ob-head">
          <div className="ob-head-left">
            <h2 id="ob-title">Grading Instructions</h2>
            <p id="ob-subtitle">Step {obStep} of {OB_STEPS} — {OB_TITLES[obStep - 1]}{subLabel}</p>
          </div>
          <div className="ob-head-right">
            <div className="ob-stepper">
              {[1,2,3,4].map(n => (
                <div key={n} className={`ob-dot${n === obStep ? ' active' : n < obStep ? ' done' : ''}`} />
              ))}
            </div>
            <span className="ob-pid-badge">{graderId}</span>
          </div>
        </div>

        {/* Step 1: STAR Annotation */}
        {obStep === 1 && (
          <div className="ob-body ob-step active" onScroll={onScroll}>
            <div className="ob-instr">
              For each transcript, <strong>highlight and label</strong> the text spans that correspond to the four STAR frames below. A single sentence may span multiple frames; a single frame may stretch across multiple sentences.
              <br /><br />
              <strong>How to annotate:</strong> Click and drag to select text → choose a frame label (S / T / A / R) from the popup. Click an existing highlight to edit or remove it.
            </div>
            <div className="ob-section">
              <div className="ob-section-title">The Four Frames</div>
              <div className="frame-defs">
                {[
                  { k:'s', name:'Situation', body:'The context, background, or setting of the story.', look:'Look for: time, place, role — "During an internship I did this past summer…"' },
                  { k:'t', name:'Task',      body:'The specific problem, goal, or deadline the student had to meet.', look:'Look for: what was required — "we had a project where the deadline was in about a couple weeks"' },
                  { k:'a', name:'Action',    body:'The specific, observable steps the student personally took to solve the problem.', look:'Look for: first-person "I" statements — "make sure to touch base with the team every day"' },
                  { k:'r', name:'Result',    body:'The outcome, impact, or learning that occurred because of the action.', look:'Look for: finishing, feedback — "ultimately that led to us being able to meet our deadline"' },
                ].map(({ k, name, body, look }) => (
                  <div key={k} className="frame-def" style={{ borderLeftColor:`var(--${k}-color)`, background:`var(--${k}-bg)` }}>
                    <div className="frame-def-head">
                      <span className={`s-tag tag-${k}`} style={{ width:22, height:22, fontSize:11, borderRadius:5 }}>{k.toUpperCase()}</span>
                      <span className="frame-def-name" style={{ color:`var(--${k}-color)` }}>{name}</span>
                    </div>
                    <div className="frame-def-body">{body}</div>
                    <div className="frame-def-look">{look}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="ob-section">
              <div className="ob-section-title">Correct Annotation Example</div>
              <div className="ob-example" dangerouslySetInnerHTML={{ __html: EXAMPLE_HIGHLIGHTED_HTML }} />
              <div className="ex-list">
                {[
                  ['s', '"[During an internship I did this past summer]… [not just the Chicago office, but also the Dallas and New York office]"'],
                  ['t', '"[we had a project where the deadline was in about a couple weeks]… [The project was essentially putting together a consulting presentation]"'],
                  ['a', '"[what I did to meet the deadline was essentially make sure to touch base with the team every day]… [made sure every single person knew what they were gonna work on that day]"'],
                  ['r', '"[ultimately that led to us being able to meet our deadline]… [we were able to go above and beyond a little bit]"'],
                ].map(([f, text]) => (
                  <div className="ex-item" key={f}>
                    <span className={`ex-tag tag-${f}`}>{f.toUpperCase()}</span>
                    <span>{text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 2: STAR Detail Rubric */}
        {obStep === 2 && (
          <div className="ob-body ob-step active" onScroll={onScroll}>
            <div className="ob-instr">
              For each STAR element, score <strong>1–5</strong> based on how fully the participant expressed that element. Scores are <em>cumulative</em> — each level builds on the one below.
            </div>
            <div className="ob-section">
              <div className="ob-rtabs">
                {['s','t','a','r'].map((f, fi) => (
                  <button key={f} className={`ob-rtab rt-${f}${f === curSub ? ' active' : ''}`}>{OB_NAMES[fi][0]} — {OB_NAMES[fi]}</button>
                ))}
              </div>
              {STAR_RUBRIC_DATA[curSub].map((row, ri) => (
                <div key={ri} className={`ob-rrow ${row.cls}`}>
                  <div className={`ob-rnum ${row.ncls}`}>{5 - ri}</div>
                  <div>
                    <div className="ob-rlevel">{row.level}</div>
                    <div className="ob-rdesc">{row.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: BARS */}
        {obStep === 3 && (
          <div className="ob-body ob-step active" onScroll={onScroll}>
            <div className="ob-instr">
              After annotating, assign a <strong>BARS score (1–5)</strong> that reflects the overall <em>quality</em> of the competency demonstrated — completely independent of STAR structure. <strong>Always read the Score 3 (Average) anchor first</strong>, then decide if the response is above, below, or at that level.
            </div>
            {['q1','q2'].map((q) => (
              <div className="ob-section" key={q}>
                <div className="ob-section-title">{q === 'q1' ? 'Question 1' : 'Question 2'}</div>
                <div className="bars-anchor-prompt">{BARS_META[q].prompt}</div>
                {q === 'q1' ? (
                  <>
                    <AnchorCard score={5} color="#059669" label="Excellent" short="Strategic planning + resource negotiation + quantifiable outcome" quote='"I broke the project into daily milestones. I proactively asked my manager to reassign two non-essential tasks, and I used a shared calendar to keep the team updated. We delivered the project two days early."' note="Participant explicitly describes strategic planning, resource negotiation, and a successful, quantifiable outcome." />
                    <BetweenCard score={4} color="#2563eb" label="Good" short="Between 3 and 5 — some organization, lacks strategic negotiation" body="Response falls between 3 and 5. They show some organization but lack high-level strategic negotiation or proactive resource management." />
                    <AnchorCard score={3} color="#d97706" label="Average — Read this first" short="Brute force effort, met deadline but no systemic planning" quote='"I just stayed late every night and worked through the weekend until it was done. I met the deadline, but I was exhausted."' note="Participant relies on brute-force effort and longer hours rather than systemic planning or communication." />
                    <BetweenCard score={2} color="#ea580c" label="Marginal" short="Between 1 and 3 — struggled significantly, barely finished" body="Response falls between 1 and 3. They struggled significantly but barely managed to finish." />
                    <AnchorCard score={1} color="#dc2626" label="Poor" short="Poor planning, panic, or missed the deadline" quote={"\"I panicked because there wasn't enough time. I tried to do it all at the last minute and ended up missing the deadline.\""} note="Participant describes poor planning, panic, or failing to meet the objective entirely." />
                  </>
                ) : (
                  <>
                    <AnchorCard score={5} color="#059669" label="Excellent" short="Logical framework + stakeholder communication + delegation" quote='"I reviewed all my tasks and categorized them by urgency and importance. I communicated with stakeholders to push back the deadline on lower-priority items, and I delegated one task to a teammate. All critical tasks were completed on time."' note="Participant describes applying a logical framework, communicating with stakeholders, and successfully managing expectations." />
                    <BetweenCard score={4} color="#2563eb" label="Good" short="Between 3 and 5 — prioritized well, no stakeholder management" body="Response falls between 3 and 5. They prioritized well but did not actively manage external stakeholder expectations." />
                    <AnchorCard score={3} color="#d97706" label="Average — Read this first" short="Basic to-do list, arbitrary prioritization" quote='"I wrote down a to-do list and just started working on whatever was due first. I worked really fast and managed to get most of the things done by the end of the day."' note="Participant uses basic, arbitrary prioritization methods without evaluating strategic importance." />
                    <BetweenCard score={2} color="#ea580c" label="Marginal" short="Between 1 and 3 — attempted to organize, dropped tasks" body="Response falls between 1 and 3. They attempted to organize but still dropped some important tasks." />
                    <AnchorCard score={1} color="#dc2626" label="Poor" short="Chaotic multitasking, overwhelmed, dropped responsibilities" quote='"I tried to multitask and do a little bit of everything at once. I got completely overwhelmed and forgot to submit the most important assignment."' note="Participant describes a failure to prioritize, chaotic multitasking, and dropped responsibilities." />
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Step 4: Grading Rules */}
        {obStep === 4 && (
          <div className="ob-body ob-step active" onScroll={onScroll}>
            <div className="ob-instr">
              You will evaluate each response using <strong>two separate tools</strong>: the <strong>STAR Structure Checklist</strong> (measures how the answer was formatted) and the <strong>BARS</strong> (measures the quality of the competency demonstrated). Grade them <em>independently</em> — a well-structured STAR response can still score a 1 on BARS.
            </div>
            <div className="ob-section">
              <div className="ob-section-title">5 Key Rules</div>
              {[
                ['Look for evidence, not eloquence.', 'Do not penalize for stuttering or filler words, and do not reward smooth delivery. Grade strictly on the presence or absence of the required elements.'],
                ['Track accumulation (STAR scores).', 'Each level (1–5) builds on the previous one. A participant earns a higher score only by successfully accumulating the required elements defined in the rubric.'],
                ['Set your BARS baseline.', 'Always read the Score 3 (Average) anchor first before grading. Then decide if the response is above, below, or at that level. Give a 1, 3, or 5 for a clear match; give a 2 or 4 if the response falls strictly between two anchors.'],
                ['Avoid Halo bias.', 'Grade BARS quality completely independent of structure. A beautifully formatted STAR answer can still demonstrate a poor (score 1) strategy. A rambling response can still show excellent judgment.'],
                ['STAR Checklist is presence-only.', 'Mark Yes if the component appears at all — even weakly. "I just worked faster" still earns Yes for Action. Reserve the 1–5 detail score for quality.'],
              ].map(([title, body], i) => (
                <div className="rule-box" key={i}>
                  <div className="rule-num">{i + 1}</div>
                  <div className="rule-text"><strong>{title}</strong> {body}</div>
                </div>
              ))}
            </div>
            <div className="ob-section">
              <div className="ob-section-title">Your Workflow</div>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {['Read the full transcript once without annotating.','Go back and highlight + label all STAR spans (S, T, A, R).','In the grading panel, mark Yes/No for each element and assign a detail score (1–5).','Read the BARS Score 3 anchor, then assign a BARS score (1–5) for overall quality.','Hit Save, then switch to Q2 and repeat the process.'].map((step, i) => (
                  <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'9px 12px', background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:7 }}>
                    <span style={{ fontWeight:800, color:'#2563eb', fontSize:13, flexShrink:0 }}>{i + 1}</span>
                    <span style={{ fontSize:12.5, color:'#374151', lineHeight:1.5 }}>{step}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="ob-foot">
          <div className="ob-foot-left">
            {!(obStep === 1 && obSubStep === 0) && (
              <button className="ob-nav-back" onClick={onBack}>← Back</button>
            )}
            <span className="ob-step-counter">Step {obStep} of {OB_STEPS}</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span className="ob-gate-hint">{gateHint()}</span>
            {isLast ? (
              <button className="ob-begin" disabled={btnDisabled} onClick={onNext}>Begin Grading →</button>
            ) : (
              <button className="ob-nav-next" disabled={btnDisabled} onClick={onNext}>
                {isStep2NotLast ? `${OB_NAMES[obSubStep + 1]} →` : 'Next →'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
