export const DEFAULT_Q1 = `During an internship I did this past summer, we had a project where the deadline was in about a couple weeks and we had to coordinate between teams and not just the Chicago office, but also the Dallas and New York office. The project was essentially putting together a consulting presentation to help a nonprofit meet new goals and kind of improve their revenue for the upcoming year. And what I did to meet the deadline was essentially make sure to touch base with the team every day, whether over a meeting or just, you know, through our teams chat and made sure that every single person knew what they were, what they were gonna work on that day. I would also try to check in throughout each day and make sure that we were making progress and sort of on schedule to meet our upcoming deadline. And this was also kind of helpful to figure out where people needed help, where people might have kind of finished a little bit early and can potentially help someone else out. And yeah, ultimately that led to us being able to meet our deadline and with some extra time we had to, we were able to kind of, you know, go above and beyond a little bit as we seek feedback before we were even, you know, submitting and presenting to project manager.`;

export const DEFAULT_Q2 = `Paste the participant's Q2 transcript here.`;

export const BARS_META = {
  q1: {
    title: 'BARS Score — Q1',
    prompt: '"Tell me about a time when you had to meet a challenging deadline. What did you do?"',
    ref: [
      { label: '5 – Excellent', color: '#059669', desc: 'Strategic planning, resource negotiation, quantifiable outcome ("delivered 2 days early")' },
      { label: '4 – Good',      color: '#3b82f6', desc: 'Some organization but lacks high-level strategic negotiation or delegation' },
      { label: '3 – Average',   color: '#d97706', desc: 'Brute-force effort / longer hours; met deadline but no systemic planning' },
      { label: '2 – Marginal',  color: '#f97316', desc: 'Struggled significantly, barely managed to finish' },
      { label: '1 – Poor',      color: '#ef4444', desc: 'Poor planning, panic, or missed the deadline entirely' },
    ]
  },
  q2: {
    title: 'BARS Score — Q2',
    prompt: '"Tell me about a time when you had too many things to do and you were required to prioritize your tasks."',
    ref: [
      { label: '5 – Excellent', color: '#059669', desc: 'Logical framework (urgency/importance), stakeholder communication, delegation; all critical tasks done' },
      { label: '4 – Good',      color: '#3b82f6', desc: 'Prioritized well but did not actively manage external stakeholder expectations' },
      { label: '3 – Average',   color: '#d97706', desc: 'Basic to-do list, arbitrary prioritization, got most things done' },
      { label: '2 – Marginal',  color: '#f97316', desc: 'Attempted to organize but still dropped some important tasks' },
      { label: '1 – Poor',      color: '#ef4444', desc: 'Chaotic multitasking, got overwhelmed, dropped responsibilities' },
    ]
  }
};

export const GRADE_FIELDS = ['g_s_yn','g_s_sc','g_t_yn','g_t_sc','g_a_yn','g_a_sc','g_r_yn','g_r_sc','g_bars'];

export const QUIZ_QUESTIONS = [
  {
    text: "According to the STAR guidelines, which component should make up the <strong>largest portion (~60%)</strong> of a candidate's response?",
    opts: ['S — Situation', 'T — Task', 'A — Action', 'R — Result'],
    correct: 2
  }
];

export const EXAMPLE_HIGHLIGHTED_HTML = `<span class="hl hl-s" data-frame="S">During an internship I did this past summer<span class="hl-badge">S</span></span>, we had a project where <span class="hl hl-t" data-frame="T">the deadline was in about a couple weeks<span class="hl-badge">T</span></span> and we had to coordinate between teams and <span class="hl hl-s" data-frame="S">not just the Chicago office, but also the Dallas and New York office<span class="hl-badge">S</span></span>. <span class="hl hl-t" data-frame="T">The project was essentially putting together a consulting presentation to help a nonprofit meet new goals<span class="hl-badge">T</span></span> and kind of improve their revenue for the upcoming year. And <span class="hl hl-a" data-frame="A">what I did to meet the deadline was essentially make sure to touch base with the team every day<span class="hl-badge">A</span></span>, whether over a meeting or just, you know, through our teams chat and <span class="hl hl-a" data-frame="A">made sure that every single person knew what they were, what they were gonna work on that day<span class="hl-badge">A</span></span>. <span class="hl hl-a" data-frame="A">I would also try to check in throughout each day and make sure that we were making progress<span class="hl-badge">A</span></span> and sort of on schedule to meet our upcoming deadline. And this was also kind of helpful to figure out where people needed help, where people might have kind of finished a little bit early and can potentially help someone else out. And yeah, <span class="hl hl-r" data-frame="R">ultimately that led to us being able to meet our deadline<span class="hl-badge">R</span></span> and with some extra time we had to, <span class="hl hl-r" data-frame="R">we were able to kind of, you know, go above and beyond a little bit<span class="hl-badge">R</span></span> as we seek feedback before we were even, you know, submitting and presenting to project manager.`;

export const STAR_RUBRIC = {
  s: [
    { score: 5, level: 'Complete',    desc: 'Setting + project + complication + exact timeline/deadline (all 4 elements)' },
    { score: 4, level: 'Substantial', desc: 'Setting + project + specific complication faced (3 elements)' },
    { score: 3, level: 'Partial',     desc: 'Setting/role + project only — "At my internship, we were building a presentation…"' },
    { score: 2, level: 'Minimal',     desc: 'One element only, usually just the setting or role (e.g. "At my internship…")' },
    { score: 1, level: 'Absent',      desc: 'Jumps straight to action or relies on generalizations with no context' },
  ],
  t: [
    { score: 5, level: 'Complete (+ Stakes)',            desc: 'Goal + personal "I" responsibility + parameters + explicit stakes ("…because this counted toward my GPA")' },
    { score: 4, level: 'Goal + Responsibility + Params', desc: 'States the personal goal with specific criteria for success ("finish without sacrificing quality")' },
    { score: 3, level: 'Goal + Personal Responsibility', desc: 'Uses "I" to claim ownership of the goal ("My goal was to ensure it was finished")' },
    { score: 2, level: 'General Goal Only',              desc: 'Goal mentioned but ownership is grouped or implied ("We needed to finish the campaign")' },
    { score: 1, level: 'Absent',                         desc: 'No goal or task mentioned at all' },
  ],
  a: [
    { score: 5, level: 'Sequential "I" Actions',     desc: 'Explicit chronological steps with clear ordering ("First I did X, then Y, then Z…")' },
    { score: 4, level: 'Multiple Specific "I" Acts', desc: 'Two or more distinct, specific steps the candidate personally took' },
    { score: 3, level: 'Single Broad "I" Action',    desc: 'Uses "I" but summarizes effort in one sweeping action ("I reorganized and finished it")' },
    { score: 2, level: 'Passive / Team-focused',     desc: 'Relies on "We" or passive voice ("We figured it out" / "The deck was finalized")' },
    { score: 1, level: 'Absent / Trait-based',       desc: 'No concrete actions — relies on traits only ("I just work hard under pressure")' },
  ],
  r: [
    { score: 5, level: 'Quantified Outcome',      desc: 'Outcome + external feedback + explicit numbers/metrics/grades ("submitted 2 days early, scored 95%")' },
    { score: 4, level: 'Outcome + Linkage',       desc: 'Definite outcome AND external validation or key takeaway (nonprofit implemented recommendations)' },
    { score: 3, level: 'Definite Outcome',        desc: 'Specific, concrete outcome with no metrics or external feedback ("We submitted the presentation")' },
    { score: 2, level: 'Vague Outcome',           desc: 'Generic statement only ("It went really well" / "We finished")' },
    { score: 1, level: 'Absent',                  desc: 'No outcome provided — story just ends with no resolution stated' },
  ],
};

export const SURVEY_OPTIONS = [
  { label: 'Disagree strongly', value: '1' },
  { label: 'Disagree a little', value: '2' },
  { label: 'Neutral: no opinion', value: '3' },
  { label: 'Agree a little', value: '4' },
  { label: 'Agree strongly', value: '5' },
];

export const SURVEY_QUESTIONS = [
  'Am the life of the party.',
  'Sympathize with others’ feelings.',
  'Get chores done right away.',
  'Have frequent mood swings.',
  'Have a vivid imagination.',
  'Don’t talk a lot.',
  'Am not interested in other people’s problems.',
  'Often forget to put things back in their proper place.',
  'Am relaxed most of the time.',
  'Am not interested in abstract ideas.',
  'Talk to a lot of different people at parties.',
  'Feel others’ emotions.',
  'Like order.',
  'Get upset easily.',
  'Have difficulty understanding abstract ideas.',
  'Keep in the background.',
  'Am not really interested in others.',
  'Make a mess of things.',
  'Seldom feel blue.',
  'Do not have a good imagination.',
];

// Standard System Usability Scale (SUS) — 10 questions, 5-point Likert
// Odd-numbered items (1,3,5,7,9) are positively worded; even-numbered (2,4,6,8,10) negatively.
export const SUS_QUESTIONS = [
  { id: 'sus_q1',  text: 'I think that I would like to use this system frequently.' },
  { id: 'sus_q2',  text: 'I found the system unnecessarily complex.' },
  { id: 'sus_q3',  text: 'I thought the system was easy to use.' },
  { id: 'sus_q4',  text: 'I think that I would need the support of a technical person to be able to use this system.' },
  { id: 'sus_q5',  text: 'I found the various functions in this system were well integrated.' },
  { id: 'sus_q6',  text: 'I thought there was too much inconsistency in this system.' },
  { id: 'sus_q7',  text: 'I would imagine that most people would learn to use this system very quickly.' },
  { id: 'sus_q8',  text: 'I found the system very cumbersome to use.' },
  { id: 'sus_q9',  text: 'I felt very confident using the system.' },
  { id: 'sus_q10', text: 'I needed to learn a lot of things before I could get going with this system.' },
];

export const SUS_OPTIONS = [
  { label: 'Strongly disagree', value: '1' },
  { label: 'Disagree',          value: '2' },
  { label: 'Neither agree nor disagree', value: '3' },
  { label: 'Agree',             value: '4' },
  { label: 'Strongly agree',    value: '5' },
];

export const HR_QUESTIONS = [
  {
    id: 'hr_q1',
    text: 'How many years of professional experience do you have in Human Resources, recruiting, or talent acquisition?',
    options: ['Less than 1 year', '1 to 3 years', '4 to 6 years', '7 to 10 years', 'More than 10 years'],
  },
  {
    id: 'hr_q2',
    text: 'Which of the following best describes your primary involvement in the hiring process?',
    options: [
      'I advise on hiring but do not interview candidates',
      'I conduct initial screening interviews',
      'I conduct full interviews and provide direct hiring input',
      'I am the final decision-maker for hiring',
      'I am not currently involved in hiring',
    ],
  },
  {
    id: 'hr_q3',
    text: 'Are you familiar with behavioral interviews?',
    options: ['Yes', 'No'],
  },
  {
    id: 'hr_q4',
    text: 'How frequently do you use behavioral interview techniques (e.g., the STAR method) to evaluate candidates?',
    options: ['Never', 'Rarely', 'Sometimes', 'Frequently', 'Always'],
  },
  {
    id: 'hr_q5',
    text: 'What is your level of experience with using formal scoring rubrics to evaluate interview responses?',
    options: [
      'I have never used a formal scoring rubric',
      'I use informal notes rather than a structured rubric',
      'I occasionally use standardized rubrics',
      'I regularly use standardized rubrics to score responses',
      'I design rubrics or train others on how to use them',
    ],
  },
];

export const DEM_AGE_OPTIONS    = ['18–20','21–23','24–26','27–30','31–35','36–40','40–45','45–50','50+','Prefer not to say'];
export const DEM_GENDER_OPTIONS = ['Woman','Man','Non-binary','Prefer not to say'];
export const DEM_RACE_OPTIONS   = [
  'American Indian or Alaska Native',
  'Asian',
  'Black or African American',
  'Hispanic or Latino/a/x',
  'Middle Eastern or North African',
  'Native Hawaiian or Other Pacific Islander',
  'White',
  'Another race/ethnicity',
  'Prefer not to say',
];

export const TOUR_STEPS = [
  {
    title: 'Task 1: Text Annotation (1/10)',
    msg: "Your goal is to map out the candidate's story directly on the transcript. Read through the text and highlight the exact words that correspond to the Situation, Task, Action, and Result.<br><br><strong>Keep in mind:</strong><ul class=\"tour-list\"><li><strong>Overlap is normal:</strong> A single sentence might contain multiple labels (e.g., a candidate states their Task and their first Action in the same breath).</li><li><strong>Length varies:</strong> A single label might stretch across a whole paragraph, or it might be just five words long.</li></ul>",
    target: 'transcript', pos: 'left', actionLabel: 'Got it, start →', manual: true, audioKey: 'tour_0',
  },
  {
    title: 'Step 1: Highlight the Situation',
    msg: 'Click and drag to select text describing the background, setting or context of the story, then click <strong>S — Situation</strong> in the pop-up. Only S counts here.<br><br><strong>Look for:</strong> time, place, role<br><em>"During an internship I did this past summer"</em>',
    target: 'transcript', pos: 'bottom-fixed', frame: 's', audioKey: 'tour_1',
  },
  {
    title: 'Step 2: Highlight the Task',
    msg: 'Select text describing the specific problem, goal or deadline the candidate had to meet, then click <strong>T — Task</strong> in the pop-up.<br><br><strong>Look for:</strong> what was required<br><em>"We had a project where the deadline was in about a couple of weeks"</em>',
    target: 'transcript', pos: 'bottom-fixed', frame: 't', audioKey: 'tour_2',
  },
  {
    title: 'Step 3: Highlight the Action',
    msg: 'Select text describing the specific observable steps the candidate took personally to solve the problem, then click <strong>A — Action</strong> in the pop-up.<br><br><strong>Look for:</strong> first person "I" statements<br><em>"I made sure to touch base with the team every day"</em>',
    target: 'transcript', pos: 'bottom-fixed', frame: 'a', audioKey: 'tour_3',
  },
  {
    title: 'Step 4: Highlight the Result',
    msg: 'Select text describing the outcome, impact or learning that occurred because of the candidate\'s actions, then click <strong>R — Result</strong> in the pop-up.<br><br><strong>Look for:</strong> finishing, feedback<br><em>"Ultimately, that led to us being able to meet our deadline"</em>',
    target: 'transcript', pos: 'bottom-fixed', frame: 'r', audioKey: 'tour_4',
  },
  {
    title: 'Step 5: Editing a highlight',
    msg: '<strong>Editing a highlight</strong><br>Click <em>any</em> existing colored highlight in the transcript now — a popup will appear so you can relabel or remove it.',
    target: 'transcript', pos: 'bottom-fixed', needsHighlightClick: true
  },
  {
    title: 'Step 6',
    msg: 'The popup lets you <strong>relabel</strong> by clicking a different frame letter, or <strong>delete</strong> the annotation with the red <em>Remove highlight</em> button at the bottom. Click <strong>Remove highlight</strong> now.',
    target: 'removeHlBtn', pos: 'bottom-fixed', needsHighlightRemove: true, audioKey: 'tour_6',
  },
  {
    title: 'Step 7',
    msg: 'Good — one highlight removed. Now click the <strong>Clear</strong> button in the toolbar above the transcript to wipe all remaining highlights at once.',
    target: 'clearBtn', pos: 'top', needsClear: true, audioKey: 'tour_7',
  },
  {
    title: 'Step 8',
    msg: "All highlights cleared. Let's restore the example annotations so the scoring steps that follow make sense.",
    target: null, pos: 'center', actionLabel: 'Restore Highlights →', manual: true, isRestore: true, audioKey: 'tour_8',
  },
  {
    title: 'Step 9',
    msg: 'All four STAR highlights are back. Now click <strong>Next →</strong> in the grading panel to move to the Structural Score task.',
    target: 'gNextBtn', pos: 'top', needsStep: 2, audioKey: 'tour_9',
  },
  {
    title: 'Task 2: Structural Score (Accumulation) (1/6)',
    msg: 'Here you will grade the thoroughness of the candidate\'s S, T, A, and R on a scale of 1 to 5.<br><br><strong>Keep in mind — look for accumulation:</strong><ul class="tour-list"><li>Each score level <strong>builds on the previous one</strong>. A candidate earns a higher score only by accumulating specific details defined in the rubric.</li><li>For example: To get a 5 on "Situation", they cannot just mention the setting; they must explicitly establish the setting, the project, the complication, <em>and</em> the exact deadline.</li></ul>',
    target: 'gsp-2', pos: 'bottom-fixed', actionLabel: 'Got it →', manual: true, audioKey: 'tour_10',
  },
  {
    title: 'Task 2: Structural Score (2/6)',
    msg: 'Rate the <strong>Situation (S)</strong> — score 1–5 based on how thoroughly the candidate established the setting, project, complication and timeline. Click <strong>Situation</strong> in the panel to expand its rubric.',
    target: 'gsp-2', pos: 'bottom-fixed', needsScore: 's', audioKey: 'tour_11',
  },
  {
    title: 'Task 2: Structural Score (3/6)',
    msg: 'Rate the <strong>Task (T)</strong> — score 1–5 based on how clearly the candidate defined their personal goal, responsibility and success criteria.',
    target: 'gsp-2', pos: 'bottom-fixed', needsScore: 't',
  },
  {
    title: 'Task 2: Structural Score (4/6)',
    msg: 'Rate the <strong>Action (A)</strong> — score 1–5 based on how specifically and personally the candidate described the steps they took.',
    target: 'gsp-2', pos: 'bottom-fixed', needsScore: 'a',
  },
  {
    title: 'Task 2: Structural Score (5/6)',
    msg: 'Rate the <strong>Result (R)</strong> — score 1–5 based on how concretely the candidate described the outcome, feedback or quantified impact.',
    target: 'gsp-2', pos: 'bottom-fixed', needsScore: 'r',
  },
  {
    title: 'Task 2: Structural Score (6/6)',
    msg: 'All scores entered! Click <strong>Next →</strong> to continue to the BARS rating.',
    target: 'gNextBtn', pos: 'top', needsStep: 3,
  },
  {
    title: 'Task 3: Competency Score (BARS) (1/2)',
    msg: 'Now, you are grading the actual quality of the candidate\'s skill (e.g., Time Management or Prioritization), entirely independent of how they formatted their answer.<br><br><strong>Keep in mind:</strong><ul class="tour-list"><li><strong>Set your baseline:</strong> Always read the "Score 3 (Average)" quote on the rubric first before grading. This sets a neutral, middle-ground expectation so you can easily decide if the candidate\'s strategy was more advanced (4 or 5) or more chaotic (1 or 2).</li><li><strong>Avoid the Halo Bias:</strong> Do not give a candidate a high score just because they used a perfect STAR format. A beautifully structured answer can still demonstrate a poor, brute-force strategy (Score 1). Evaluate <em>what they did</em>, not how well they told the story.</li></ul>',
    target: 'gsp-3', pos: 'bottom-fixed', needsBars: true, audioKey: 'tour_16',
  },
  {
    title: 'Task 3: Competency Score (BARS) (2/2)',
    msg: 'BARS selected! Click <strong>Next →</strong> to continue.',
    target: 'gNextBtn', pos: 'top', needsStep: 4,
  },
  {
    title: 'Task 4: Binary Checklist (1/2)',
    msg: 'This is your final step. You will answer four simple Yes (1) or No (0) questions to confirm if the candidate explicitly stated a Situation, Task, Action, and Result.<br><br><strong>Keep in mind — focus on presence, not quality:</strong><ul class="tour-list"><li>If the candidate stated an action (e.g., "I just worked faster"), check <strong>Yes</strong> for Action — even if the action itself was weak or ineffective.</li></ul>',
    target: 'gsp-4', pos: 'bottom-fixed', needsAllYN: true, audioKey: 'tour_18',
  },
  {
    title: 'Task 4: Binary Checklist (2/2)',
    msg: 'All done! Click <strong>Complete ✓</strong> to finish grading this example.',
    target: 'gNextBtn', pos: 'top', needsDone: true,
  },
  {
    title: 'All tasks completed',
    msg: 'You can check your progress in the Score Summary sidebar on the right.<br><br>This concludes the training. You will now begin <strong>Part 2</strong> and apply the rubric to score the actual interview responses.<br><br>Click <strong>All Participants</strong> in the upper ribbon to go to your participant dashboard.',
    target: null, pos: 'center', actionLabel: 'All Participants →', manual: true, isEnd: true,
  }
];

// ── Post-task AI survey (shown after the SUS survey, before Prolific redirect) ─
// Five instruments across two pages. Driven generically by AI_SURVEY_SECTIONS so
// the same renderer serves every section. Likert values are stored as strings
// ('1'..'N'); conditional "reason" multi-selects store an array of option labels
// and are only shown/required when their trigger question is answered >= `min`.

export const AI_DEGREE_OPTIONS = [
  { value: '1', label: 'Not at all' },
  { value: '2', label: 'Slightly' },
  { value: '3', label: 'Moderately' },
  { value: '4', label: 'A lot' },
  { value: '5', label: 'Entirely' },
];

export const AI_COLLAB_OPTIONS = [
  { value: '1', label: 'No Collaboration Needed (H1)' },
  { value: '2', label: 'Limited Collaboration Needed (H2)' },
  { value: '3', label: 'Moderate Collaboration Needed (H3)' },
  { value: '4', label: 'Considerable Collaboration Needed (H4)' },
  { value: '5', label: 'Essential Collaboration Needed (H5)' },
];

export const AI_AGREE7_OPTIONS = [
  { value: '1', label: 'Strongly disagree' },
  { value: '2', label: 'Disagree' },
  { value: '3', label: 'Moderately disagree' },
  { value: '4', label: 'Neither' },
  { value: '5', label: 'Moderately agree' },
  { value: '6', label: 'Agree' },
  { value: '7', label: 'Strongly agree' },
];

export const GAAIS_OPTIONS = [
  { value: '1', label: 'Strongly disagree' },
  { value: '2', label: 'Somewhat Disagree' },
  { value: '3', label: 'Neutral' },
  { value: '4', label: 'Somewhat agree' },
  { value: '5', label: 'Strongly agree' },
];

export const AI_SURVEY_SECTIONS = [
  {
    key: 'autodesire', page: 1,
    title: 'Automation Desire',
    options: AI_DEGREE_OPTIONS,
    questions: [
      { id: 'autodesire_q1', text: 'If an AI can do this task for you completely, how worried would you be that your job will be replaced?' },
      { id: 'autodesire_q2', text: 'Without thinking about salary, how much do you enjoy doing this task?' },
      { id: 'autodesire_q3', text: 'If an AI can do this task for you completely, how much do you want an AI to do it for you?' },
    ],
    reason: {
      id: 'autodesire_reasons',
      text: 'Why would you like this task to be automated by AI? (Select all that apply.)',
      condition: { qid: 'autodesire_q3', min: 3 },
      options: [
        'Automating this task would free up my time for higher-value work.',
        'This task is repetitive or tedious.',
        'Automating this task would improve the quality of my work.',
        'The task is stressful or mentally draining.',
        'This task is complicated or difficult.',
        'Automating this task would help me scale and handle higher output.',
      ],
    },
  },
  {
    key: 'humanagency', page: 1,
    title: 'Human Agency Scale',
    options: AI_DEGREE_OPTIONS,
    questions: [
      { id: 'humanagency_q1', text: 'How much does this task require taking physical actions or physical labor?' },
      { id: 'humanagency_q2', text: 'How much does this task require dealing with uncertainty or making high-stake decisions?' },
      { id: 'humanagency_q3', text: 'How much does this task require specific domain expertise (such as specialized knowledge, unspoken wisdom, or insights gained through experience)?' },
      { id: 'humanagency_q4', text: 'How much does this task depend on interpersonal communication or empathy?' },
      { id: 'humanagency_q5', text: 'If AI were to assist in this task, how much of your collaboration would be needed to complete this task effectively?', options: AI_COLLAB_OPTIONS },
    ],
    reason: {
      id: 'humanagency_reasons',
      text: 'Why would collaboration be needed for this task? (Select all that apply.)',
      condition: { qid: 'humanagency_q5', min: 3 },
      options: [
        'This task requires physical actions.',
        'This task involves making high-stake decisions which I would like to control.',
        'This task requires specific domain knowledge.',
        'The task involves nuanced communication or interpersonal skills.',
        'The task needs validation or oversight to ensure quality.',
        'The task is dynamic and requires adapting to changing circumstances.',
        'The task has ethical, sensitive, or subjective aspects.',
      ],
    },
  },
  {
    key: 'aiattitude', page: 1,
    title: 'Attitudes Towards AI Assistance',
    options: AI_AGREE7_OPTIONS,
    questions: [
      { id: 'aiattitude_q1', text: 'I would be willing to use an AI/LLM to produce a first draft of my work.' },
      { id: 'aiattitude_q2', text: 'Using an AI assistant would let me complete my tasks faster.' },
      { id: 'aiattitude_q3', text: 'Using an AI assistant would improve the quality of my output.' },
      { id: 'aiattitude_q4', text: "If my skills are weaker than my colleagues', AI assistance would help me close that gap." },
      { id: 'aiattitude_q5', text: 'If I used an AI assistant for a work task successfully, I would likely keep using it in my job afterward.' },
      { id: 'aiattitude_q6', text: 'I would be comfortable having my AI-assisted output evaluated against work I produced unaided.' },
    ],
  },
  {
    key: 'gaais_pos', page: 2,
    title: 'General Attitudes Toward AI',
    intro: 'In this section, we ask about your general attitudes toward artificial intelligence (AI). Please indicate how much you agree or disagree with each statement. There are no right or wrong answers, just your honest opinions.',
    options: GAAIS_OPTIONS,
    questions: [
      { id: 'gaais_pos_1',  text: 'For routine transactions, I would rather interact with an artificially intelligent system than with a human.' },
      { id: 'gaais_pos_2',  text: 'Artificial Intelligence can provide new economic opportunities for this country.' },
      { id: 'gaais_pos_3',  text: 'Artificially intelligent systems can help people feel happier.' },
      { id: 'gaais_pos_4',  text: 'I am impressed by what Artificial Intelligence can do.' },
      { id: 'gaais_pos_5',  text: 'I am interested in using artificially intelligent systems in my daily life.' },
      { id: 'gaais_pos_6',  text: "Artificial Intelligence can have positive impacts on people's wellbeing." },
      { id: 'gaais_pos_7',  text: 'Artificial Intelligence is exciting.' },
      { id: 'gaais_pos_8',  text: 'An artificially intelligent agent would be better than an employee in many routine jobs.' },
      { id: 'gaais_pos_9',  text: 'There are many beneficial applications of Artificial Intelligence.' },
      { id: 'gaais_pos_10', text: 'Artificially intelligent systems can perform better than humans.' },
      { id: 'gaais_pos_11', text: 'Much of society will benefit from a future full of Artificial Intelligence.' },
      { id: 'gaais_pos_12', text: 'I would like to use Artificial Intelligence in my own job.' },
    ],
  },
  {
    key: 'gaais_neg', page: 2,
    title: 'General Attitudes Toward AI',
    intro: 'Please indicate how much you agree or disagree with each statement. There are no right or wrong answers, just your honest opinions.',
    options: GAAIS_OPTIONS,
    questions: [
      { id: 'gaais_neg_1', text: 'Organizations use Artificial Intelligence unethically.' },
      { id: 'gaais_neg_2', text: 'I think artificially intelligent systems make many errors.' },
      { id: 'gaais_neg_3', text: 'I find Artificial Intelligence sinister.' },
      { id: 'gaais_neg_4', text: 'Artificial Intelligence might take control of people.' },
      { id: 'gaais_neg_5', text: 'I think Artificial Intelligence is dangerous.' },
      { id: 'gaais_neg_6', text: 'I shiver with discomfort when I think about future uses of Artificial Intelligence.' },
      { id: 'gaais_neg_7', text: 'People like me will suffer if Artificial Intelligence is used more and more.' },
      { id: 'gaais_neg_8', text: 'Artificial Intelligence is used to spy on people.' },
    ],
  },
];
