// ── api.js ────────────────────────────────────────────────────────────────────
// All backend calls. Maps snake_case server responses to the camelCase shape
// the rest of the app expects, and vice-versa for writes.
//
// The server is the single source of truth — there is NO localStorage mirror of
// annotator profile or participant grading state. Mirrors caused a long tail of
// "stale state vs server" bugs (auto-routing to SUS on a fresh annotator, the
// post-Reset-All empty list, the step='done' override after question-switch).
//
// What still uses storage:
//   - sessionStorage `caliber_current_grader` — active PID for refresh-resume
//     in the same tab. Cleared on tab close (handled in App.jsx).
//   - localStorage `admin_token`               — admin JWT, unrelated to this file.
//   - sessionStorage `caliber_study_id` / `caliber_session_id` — captured
//     Prolific URL params (handled in App.jsx).
// ─────────────────────────────────────────────────────────────────────────────

const SS_CURRENT = 'caliber_current_grader';

// ── helpers ───────────────────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(err.error || 'Request failed'), { status: res.status });
  }
  return res.json();
}

// ── Annotator session ─────────────────────────────────────────────────────────

/**
 * loginGrader(prolificId)
 * Start or resume a session. Returns { valid, profile } where profile carries
 * the server's view of onboarding flags, audio pref, survey answers, etc.
 */
export async function loginGrader(prolificId, prolificMeta = {}) {
  try {
    const data = await apiFetch('/api/session/start', {
      method: 'POST',
      body: JSON.stringify({
        prolific_id: prolificId,
        ...(prolificMeta.studyId   ? { study_id:   prolificMeta.studyId }   : {}),
        ...(prolificMeta.sessionId ? { session_id: prolificMeta.sessionId } : {}),
      }),
    });

    const profile = {
      surveyDone:     data.survey_done,
      tutorialDone:   data.tutorial_done,
      onboardingDone: data.onboarding_done,
      consentDone:    data.consent_done || false,
      audioOptIn:     data.audio_opt_in,
      resetVersion:   data.reset_version || 0,
      submittedAt:    data.submitted_at || null,
      isReturning:    data.is_returning_session || false,
      sessionCount:   data.session_count || 1,
      susDone:        data.sus_done || false,
      aiSurveyDone:   data.ai_survey_done || false,
      completionCode: data.completion_code || '',
      surveyAnswers:  data.survey_answers || {},
    };
    return { valid: true, profile };
  } catch (err) {
    if (err.status === 400) return { valid: false, profile: {} };
    if (err.status === 409) return { valid: false, profile: {}, studyFull: true, message: err.message };
    // Network error — surface as invalid so the UI shows a login error rather
    // than silently letting the user through with a guessed profile.
    return { valid: false, profile: {}, networkError: true };
  }
}

/**
 * saveGraderProfile(prolificId, patch)
 * patch keys: surveyDone, tutorialDone, onboardingDone, surveyAnswers, etc.
 * Server is the only persistence target.
 */
export async function saveGraderProfile(prolificId, patch) {
  const body = { prolific_id: prolificId };
  if (patch.surveyDone           !== undefined) body.survey_done            = patch.surveyDone;
  if (patch.tutorialDone         !== undefined) body.tutorial_done          = patch.tutorialDone;
  if (patch.onboardingDone       !== undefined) body.onboarding_done        = patch.onboardingDone;
  if (patch.consentDone          !== undefined) body.consent_done           = patch.consentDone;
  if (patch.audioOptIn           !== undefined) body.audio_opt_in           = patch.audioOptIn;
  if (patch.surveyAnswers        !== undefined) body.survey_answers         = patch.surveyAnswers;
  if (patch.taskAnnotationDone   !== undefined) body.task_annotation_done   = patch.taskAnnotationDone;
  if (patch.taskScoringDone      !== undefined) body.task_scoring_done      = patch.taskScoringDone;
  if (patch.taskBarsDone         !== undefined) body.task_bars_done         = patch.taskBarsDone;
  if (patch.taskChecklistDone    !== undefined) body.task_checklist_done    = patch.taskChecklistDone;
  if (patch.aiSurveyDone         !== undefined) body.ai_survey_done          = patch.aiSurveyDone;
  if (patch.aiSurveyAnswers      !== undefined) body.ai_survey_answers       = patch.aiSurveyAnswers;

  await apiFetch('/api/session/profile', {
    method: 'PATCH',
    body: JSON.stringify(body),
  }).catch(() => {}); // network failures are non-fatal; next /start fetches truth
}

// ── Completion ────────────────────────────────────────────────────────────────

/**
 * completeStudy(prolificId)
 * Marks the annotator as submitted on the server and returns the
 * Prolific completion code to redirect them to.
 */
export async function completeStudy(prolificId) {
  const data = await apiFetch('/api/session/complete', {
    method: 'POST',
    body: JSON.stringify({ prolific_id: prolificId }),
  });
  return data.completion_code || '';
}

// ── Survey ────────────────────────────────────────────────────────────────────

/**
 * saveSurvey(prolificId, payload)
 * Survey answers are saved as part of the profile update.
 */
export async function saveSurvey(prolificId, payload) {
  await saveGraderProfile(prolificId, { surveyAnswers: payload.responses });
}

// ── Participant / SONA items ──────────────────────────────────────────────────

/**
 * fetchAssignedParticipants(prolificId)
 * Returns { participants, currentSessionItems }
 *   participants: { [sonaId]: { q1: ParticipantQ, q2: ParticipantQ } }
 *   currentSessionItems: string[] — IDs drawn in the latest session.
 * ParticipantQ: { html, transcript, grades, step, audioUrl }
 *
 * If the server returns 404 (annotator record was wiped, e.g. by a super-admin
 * Reset All), the local session is cleared and the page reloads so the next
 * mount hits /api/session/start and recovers cleanly.
 */
export async function fetchAssignedParticipants(prolificId) {
  try {
    const { items, current_session_items } =
      await apiFetch(`/api/session/items/${encodeURIComponent(prolificId)}`);

    // Defensive: if server has step='done' but no structural scores (legacy
    // corrupt data from before the stale-closure fix), roll back to step 4 so
    // the annotator can complete the question properly.
    function safeStep(step, grades) {
      const hasScores = grades && Object.keys(grades).some(k => k.endsWith('_sc') || k === 'g_bars');
      if (step === 'done' && !hasScores) return 4;
      return step;
    }

    const result = {};
    Object.entries(items).forEach(([sonaId, data]) => {
      result[sonaId] = {
        q1: {
          transcript:  data.q1.transcript,
          html:        data.q1.annotation_html ?? null,
          grades:      data.q1.grades ?? {},
          step:        safeStep(data.q1.step ?? 1, data.q1.grades),
          audioUrl:    data.q1.audio_url,
        },
        q2: {
          transcript:  data.q2.transcript,
          html:        data.q2.annotation_html ?? null,
          grades:      data.q2.grades ?? {},
          step:        safeStep(data.q2.step ?? 1, data.q2.grades),
          audioUrl:    data.q2.audio_url,
        },
      };
    });

    return {
      participants: result,
      currentSessionItems: Array.isArray(current_session_items) ? current_session_items : null,
    };
  } catch (err) {
    if (err.status === 404) {
      try { sessionStorage.removeItem(SS_CURRENT); } catch { /* ignore */ }
      if (typeof window !== 'undefined') window.location.reload();
    }
    return { participants: {}, currentSessionItems: null };
  }
}

// ── Grades & Annotations ──────────────────────────────────────────────────────

/**
 * saveGrades(payload)
 * payload: { graderId, participantId, question, step, grades, annotationHtml }
 */
export async function saveGrades(payload) {
  await apiFetch('/api/annotations', {
    method: 'POST',
    body: JSON.stringify({
      prolific_id:     payload.graderId,
      sona_id:         payload.participantId,
      question:        payload.question,
      grades:          payload.grades,
      annotation_html: payload.annotationHtml,
      step:            payload.step,
    }),
  }).catch(() => {}); // best-effort; the 15s autosave will retry
}

// ── Telemetry ─────────────────────────────────────────────────────────────────

/**
 * sendTelemetryBatch(events)
 * Called by telemetry.js on a timer and on page unload.
 */
export async function sendTelemetryBatch(events) {
  if (!events.length) return;
  try {
    await fetch('/api/telemetry/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
      keepalive: true, // survives page close
    });
  } catch {
    // Telemetry failures are silent
  }
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export function adminFetch(path, options = {}, token) {
  return apiFetch(path, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
}
