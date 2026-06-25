/*
 * Figwork Hiring Signal Demo - matching engine.
 *
 * This is a transparent, dependency-free retrieval + ranking core. It is not a
 * production model, but it uses the same building blocks a real candidate-role
 * matcher would: tokenization, IDF term weighting (BM25), per-field weighting,
 * cosine similarity between a role vector and a candidate vector, calibrated
 * confidence from evidence mass, and an explainable score decomposition.
 *
 * Everything is rule-based JavaScript so the product loop stays inspectable.
 */

const defaultRoleBrief = `Figwork is building an AI hiring platform that helps the right people find the right opportunities and helps recruiters understand candidates beyond titles, keywords, and resumes.

Role: Software Engineer, Full Stack.
Signals: early-stage ownership, full-stack product execution, AI workflow experience (LLM, agents, RAG, evaluation), recruiter and candidate empathy, ability to convert messy text, audio, and video context into useful hiring signals, reliability, and willingness to work in person in Sunnyvale.`;

// Field weights: a resume claim is worth more than a video impression. These
// feed directly into term-frequency accumulation so the engine trusts written,
// verifiable context more than soft signals.
const FIELD_WEIGHTS = { text: 1.0, audio: 0.7, video: 0.55, tags: 0.4 };

// BM25 parameters. k1 controls term-frequency saturation, b controls
// length normalization so a long resume does not win on volume alone.
const BM25_K1 = 1.4;
const BM25_B = 0.6;

const signalDefinitions = [
  {
    key: "ownership",
    label: "Startup ownership",
    color: "teal",
    // All terms are single tokens so they match the tokenizer output. "scratch"
    // stands in for "from scratch"; phrase matching is out of scope for the demo.
    terms: ["co-founder", "founder", "owned", "ownership", "built", "shipped", "lead", "maintainer", "scratch", "repo", "ci/cd", "release"]
  },
  {
    key: "fullstack",
    label: "Full-stack execution",
    color: "green",
    terms: ["react", "electron", "node", "express", "supabase", "oauth", "fastapi", "backend", "frontend", "typescript", "javascript", "sqlite", "vite", "postgres"]
  },
  {
    key: "aiworkflow",
    label: "AI workflow depth",
    color: "plum",
    terms: ["llm", "agent", "agents", "rag", "evaluation", "eval", "llm-as-judge", "prompt", "multimodal", "audio", "video", "model", "matching", "ranking", "embedding"]
  },
  {
    key: "hiring",
    label: "Hiring-market empathy",
    color: "amber",
    terms: ["recruiter", "recruiters", "candidate", "candidates", "hiring", "job", "resume", "interview", "talent", "portfolio", "outreach", "conversation", "ats"]
  },
  {
    key: "reliability",
    label: "Reliability habits",
    color: "teal",
    terms: ["test", "tests", "tdd", "ci/cd", "quality", "metrics", "audit", "privacy", "pii", "sanitization", "production", "monitoring", "observability"]
  }
];

const SEED_CANDIDATES = [
  {
    id: "koutian",
    name: "Koutian Wu",
    headline: "Full-stack AI builder, Ph.D. student at UT Austin",
    availability: "Open to Sunnyvale relocation; visa logistics discussable",
    location: "relocating",
    text: "Technical Co-Founder at Tacite.AI. Designed and built Atomize, a local-first React/Electron AI assistant, owned most implementation, repo management, CI/CD, tests, and release workflow across 600+ commits. Co-Lead and maintainer of ResearchSkills.ai, a Node.js/Express, React/Vite, Supabase, GitHub OAuth platform for research-skill submissions and review. Built an LLM-as-judge evaluation system for a production RAG agent at 19Pine.AI with PII sanitization, Q&A extraction, concurrent evaluation, and quality metrics.",
    audio: "Audio transcript: I care about building tools where AI makes messy human context usable. In hiring, the hard part is not only ranking. It is showing why a person may belong in a role, what is still uncertain, and how to move both sides into a real conversation.",
    video: "Video notes: Communicates quickly, emphasizes product ownership, accepts ambiguity, explains tradeoffs around model confidence, human review, and feedback loops. Strong energy for early-stage engineering and technical leadership growth.",
    tags: ["React/Electron", "Node/Express", "LLM eval", "CI/CD", "Startup ownership"]
  },
  {
    id: "maya",
    name: "Maya Chen",
    headline: "Backend-heavy ML platform engineer",
    availability: "Bay Area, hybrid preferred",
    location: "bay-area",
    text: "Built Python services for ML feature pipelines, model monitoring, and search ranking. Strong distributed systems background with Kubernetes, Postgres, Redis, and observability. Less direct ownership of consumer-facing frontend, but strong backend reliability and model-serving experience, including embedding-based ranking.",
    audio: "Audio transcript: I prefer infrastructure roles where I can improve latency, reliability, and model evaluation. I have worked closely with ML scientists but not directly with recruiters or hiring workflows.",
    video: "Video notes: Very clear on backend architecture. Product interest is present but less specific to candidate and recruiter workflows.",
    tags: ["Python", "Ranking infra", "Kubernetes", "Observability"]
  },
  {
    id: "aaron",
    name: "Aaron Patel",
    headline: "Recruiting SaaS product engineer",
    availability: "Remote only",
    location: "remote-only",
    text: "Built ATS integrations, recruiter dashboards, sequencing workflows, and candidate pipeline analytics in a B2B SaaS company. Strong React and product sense. Limited LLM or agent experience beyond prompt-based summarization features.",
    audio: "Audio transcript: Recruiters need fewer tabs and better candidate context. I have strong opinions about workflow design, handoff states, and why ATS data is often too shallow.",
    video: "Video notes: Excellent recruiter empathy and SaaS workflow intuition. Weaker on AI system design and not available for in-person Sunnyvale work.",
    tags: ["Recruiting SaaS", "React", "ATS", "Workflow design"]
  }
];

const STOPWORDS = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is", "it", "i", "not", "but", "as", "at", "by", "be", "are", "that", "this", "they", "you", "your", "my", "me", "we", "into", "about", "where", "what", "why", "how", "more", "only", "across", "both", "still", "may", "have", "has", "had", "can", "will", "would", "than", "from"]);

/* ---------- Mutable state (persisted) ---------- */

const STORAGE_KEY = "figwork-demo-state-v1";

// Deep-clone the seed so edits never mutate the constant template.
function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

let candidates = clone(SEED_CANDIDATES);
let selectedId = candidates[0].id;
let activeTab = "signals";
let editingId = null; // id being edited in the modal, or null when adding

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (Array.isArray(saved.candidates) && saved.candidates.length) {
      candidates = saved.candidates;
      if (typeof saved.roleBrief === "string") roleInput.value = saved.roleBrief;
      selectedId = candidates.some((c) => c.id === saved.selectedId) ? saved.selectedId : candidates[0].id;
      return true;
    }
  } catch (e) {
    /* ignore corrupt storage and fall back to seed */
  }
  return false;
}

function saveState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ candidates, roleBrief: roleInput.value, selectedId })
    );
  } catch (e) {
    /* storage full or blocked: the demo still works in-memory */
  }
}

const el = (id) => document.querySelector(id);
const roleInput = el("#roleInput");
const roleTitle = el("#role-title");
const roleSub = el("#role-sub");
const roleSignals = el("#roleSignals");
const candidateList = el("#candidateList");
const selectedName = el("#selectedName");
const selectedHeadline = el("#selectedHeadline");
const scoreValue = el("#scoreValue");
const scoreRing = el("#scoreRing");
const tabContent = el("#tabContent");
const sortMode = el("#sortMode");
const candidateCount = el("#candidateCount");
const topScore = el("#topScore");
const reviewCount = el("#reviewCount");
const resetButton = el("#resetButton");
const addCandidateButton = el("#addCandidateButton");
const editorBackdrop = el("#editorBackdrop");
const editorForm = el("#editorForm");
const editorTitle = el("#editorTitle");

const DEFAULT_ROLE_TITLE = roleTitle.textContent;
const DEFAULT_ROLE_SUB = roleSub.textContent;

// Escape user-provided text before it goes into innerHTML.
function esc(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ---------- Text processing ---------- */

function tokenize(text) {
  // Keep hyphen and slash so terms like "ci/cd", "co-founder", "llm-as-judge" survive.
  return text
    .toLowerCase()
    .replace(/[^a-z0-9/\-]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function logistic(x) {
  return 1 / (1 + Math.exp(-x));
}

// Weighted term-frequency map for one candidate: each field contributes its
// tokens scaled by FIELD_WEIGHTS, plus the candidate tags (treated as strong
// self-declared signal).
function candidateTermFreq(candidate) {
  const tf = new Map();
  const add = (text, weight) => {
    for (const token of tokenize(text)) {
      tf.set(token, (tf.get(token) || 0) + weight);
    }
  };
  add(candidate.text, FIELD_WEIGHTS.text);
  add(candidate.audio, FIELD_WEIGHTS.audio);
  add(candidate.video, FIELD_WEIGHTS.video);
  // Tags are self-declared and usually repeat resume claims, so they get a low
  // weight rather than the full resume weight (verifiable context over labels).
  add(candidate.tags.join(" "), FIELD_WEIGHTS.tags);
  return tf;
}

/* ---------- Corpus statistics (IDF) ---------- */

// Precompute per-candidate term frequencies and document length once. IDF is
// computed across the candidate corpus so a term that everybody mentions
// (common) counts less than a rare, differentiating one.
function buildCorpus() {
  const docs = candidates.map((candidate) => {
    const tf = candidateTermFreq(candidate);
    let length = 0;
    for (const v of tf.values()) length += v;
    return { id: candidate.id, tf, length };
  });

  const avgLength = docs.reduce((sum, d) => sum + d.length, 0) / docs.length;

  const docFreq = new Map();
  for (const doc of docs) {
    for (const term of doc.tf.keys()) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
    }
  }

  const N = docs.length;
  const idf = (term) => {
    const df = docFreq.get(term) || 0;
    // BM25 idf with +0.5 smoothing, floored at a small positive value so a
    // term present in every doc still carries a little weight.
    return Math.max(0.05, Math.log((N - df + 0.5) / (df + 0.5) + 1));
  };

  const docById = Object.fromEntries(docs.map((d) => [d.id, d]));
  return { docById, avgLength, idf };
}

// Rebuilt on every render so adding/editing/removing candidates recomputes IDF
// across the new corpus (a rarer term in a bigger pool carries more weight).
let CORPUS = buildCorpus();

// BM25 contribution of a single term for a candidate document.
function bm25Term(term, doc, corpus) {
  const f = doc.tf.get(term) || 0;
  if (f === 0) return 0;
  const idf = corpus.idf(term);
  const denom = f + BM25_K1 * (1 - BM25_B + BM25_B * (doc.length / corpus.avgLength));
  return idf * ((f * (BM25_K1 + 1)) / denom);
}

/* ---------- Role vector ---------- */

// Turn the role brief into a weighted query vector. Terms that also appear in a
// signal's vocabulary get a small boost so the role's stated priorities steer
// ranking. Returns a Map term -> query weight.
function buildRoleVector(roleBrief) {
  const tokens = tokenize(roleBrief || defaultRoleBrief);
  const signalVocab = new Set(signalDefinitions.flatMap((s) => s.terms));
  const vec = new Map();
  for (const token of tokens) {
    const boost = signalVocab.has(token) ? 1.6 : 1.0;
    vec.set(token, (vec.get(token) || 0) + boost);
  }
  return vec;
}

// Cosine similarity between the IDF-weighted role vector and candidate vector.
// This is the "global relevance" term: does the candidate broadly match what
// the role is actually asking for, beyond the five named signals.
function roleCosine(roleVec, doc, corpus) {
  let dot = 0;
  let roleNorm = 0;
  let docNorm = 0;
  for (const [term, qw] of roleVec.entries()) {
    const w = qw * corpus.idf(term);
    roleNorm += w * w;
    const f = doc.tf.get(term) || 0;
    if (f > 0) dot += w * (f * corpus.idf(term));
  }
  for (const [term, f] of doc.tf.entries()) {
    const w = f * corpus.idf(term);
    docNorm += w * w;
  }
  if (roleNorm === 0 || docNorm === 0) return 0;
  return dot / (Math.sqrt(roleNorm) * Math.sqrt(docNorm));
}

/* ---------- Scoring ---------- */

function scoreCandidate(candidate, roleBrief) {
  const doc = CORPUS.docById[candidate.id];
  const roleVec = buildRoleVector(roleBrief);

  // Per-signal: sum BM25 contributions of the signal's matched terms. Squash
  // through a logistic so scores are calibrated 0-100 instead of an arbitrary
  // divisor, and track which terms drove the score for explainability.
  const signals = signalDefinitions.map((signal) => {
    let raw = 0;
    const contributors = [];
    for (const term of signal.terms) {
      const c = bm25Term(term, doc, CORPUS);
      if (c > 0) {
        raw += c;
        contributors.push({ term, weight: c });
      }
    }
    contributors.sort((a, b) => b.weight - a.weight);
    // No matched terms => no evidence => score 0 (do not invent a floor). For
    // raw > 0, a logistic squash maps BM25 energy to a 0-100 band:
    // raw≈1 -> ~30, raw≈6 -> ~80. These constants are hand-tuned, not learned.
    const score = raw === 0 ? 0 : clamp(Math.round(logistic(raw / 2 - 1.4) * 100), 5, 100);
    return {
      ...signal,
      raw,
      score,
      contributors: contributors.slice(0, 3),
      evidence: extractEvidence(candidate, signal.terms)
    };
  });

  const cosine = roleCosine(roleVec, doc, CORPUS); // raw 0..~1, normalized pool-wide later
  const signalAvg = signals.reduce((s, x) => s + x.score, 0) / signals.length;

  // Confidence is driven by how much real evidence mass we have: total BM25
  // signal energy plus number of well-filled fields. More unique, rare matched
  // terms -> higher confidence we can stand behind the rank.
  const signalEnergy = signals.reduce((s, x) => s + x.raw, 0);
  const filledFields = [candidate.text, candidate.audio, candidate.video].filter((f) => f.length > 120).length;
  const confidence = clamp(Math.round(logistic(signalEnergy / 6 + filledFields * 0.4 - 1.2) * 100), 40, 97);

  const requiresInPerson = roleRequiresInPerson(roleBrief);
  const gaps = deriveGaps(signals, candidate, requiresInPerson);

  // fit / relevance / conversation are finalized in getRankedCandidates once the
  // whole pool is known (relevance is normalized relative to the best match).
  return { fit: 0, relevance: 0, conversation: 0, cosine, signalAvg, confidence, signals, gaps, requiresInPerson, signalEnergy };
}

function extractEvidence(candidate, terms) {
  const chunks = [candidate.text, candidate.audio, candidate.video]
    .flatMap((text) => text.split(". "))
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  // Prefer the chunk that matches the most distinct signal terms, not just the first.
  let best = null;
  let bestHits = 0;
  for (const chunk of chunks) {
    const lower = chunk.toLowerCase();
    const hits = terms.reduce((n, t) => n + (lower.includes(t) ? 1 : 0), 0);
    if (hits > bestHits) {
      bestHits = hits;
      best = chunk;
    }
  }
  return best || "No strong evidence found in the provided context.";
}

// Parse a hard in-person/onsite constraint out of the role brief. The location
// penalty and the Sunnyvale gap only apply when the role actually asks for it,
// so editing the brief to a remote role removes both.
function roleRequiresInPerson(roleBrief) {
  const t = (roleBrief || defaultRoleBrief).toLowerCase();
  if (/\bremote\b/.test(t) && !/in[ -]?person|on[ -]?site|onsite/.test(t)) return false;
  return /in[ -]?person|on[ -]?site|onsite|sunnyvale|relocat/.test(t);
}

function deriveGaps(signals, candidate, requiresInPerson) {
  const gaps = [];
  signals
    .filter((s) => s.score < 42)
    .sort((a, b) => a.score - b.score)
    .forEach((s) => gaps.push(`Ask for more evidence on ${s.label.toLowerCase()}.`));
  if (requiresInPerson && candidate.location === "remote-only") {
    gaps.push("Confirm whether in-person Sunnyvale work is a hard requirement.");
  }
  if (!gaps.length) {
    gaps.push("Use the first conversation to validate scope, timeline, and ownership expectations.");
  }
  return gaps;
}

function getRankedCandidates() {
  const roleBrief = roleInput.value;
  const scored = candidates.map((candidate) => ({
    ...candidate,
    score: scoreCandidate(candidate, roleBrief)
  }));

  // Raw cosine for a short query against long docs is always small in absolute
  // terms, so displayed relevance is scaled relative to the best match in the
  // pool (max-relative, not min-max): the strongest candidate anchors 100.
  const cosines = scored.map((c) => c.score.cosine);
  const maxCos = Math.max(...cosines, 1e-6);
  scored.forEach((c) => {
    const relevance = clamp(Math.round((c.score.cosine / maxCos) * 100), 0, 100);
    const locationPenalty = c.score.requiresInPerson && c.location === "remote-only" ? 14 : 0;
    const fitBase = 0.62 * c.score.signalAvg + 0.38 * relevance;
    c.score.relevance = relevance;
    c.score.fit = clamp(Math.round(fitBase - locationPenalty), 0, 100);
    c.score.conversation = clamp(Math.round(c.score.fit * 0.62 + c.score.confidence * 0.38), 0, 100);
  });

  const mode = sortMode.value;
  return scored.sort((a, b) => b.score[mode] - a.score[mode]);
}

/* ---------- Rendering ---------- */

function renderRoleSignals() {
  const roleVec = buildRoleVector(roleInput.value);
  roleSignals.innerHTML = signalDefinitions
    .map((signal) => {
      const weight = signal.terms.reduce((s, t) => s + (roleVec.get(t) || 0), 0);
      const importance = weight > 3 ? "High" : weight > 0 ? "Medium" : "Implicit";
      return `
        <div class="role-signal">
          <strong>${signal.label}</strong>
          <span>${importance}</span>
        </div>
      `;
    })
    .join("");
}

function renderCandidateList(scoredCandidates) {
  if (!scoredCandidates.length) {
    candidateList.innerHTML = `
      <div class="empty-note">
        No candidates yet. <strong>+ Add candidate</strong> to paste a resume and see the ranking,
        or use <strong>Reset</strong> to restore the sample set.
      </div>`;
    return;
  }

  candidateList.innerHTML = scoredCandidates
    .map((candidate, index) => `
      <div class="candidate-card ${candidate.id === selectedId ? "active" : ""}" data-id="${esc(candidate.id)}">
        <button class="card-main" type="button" data-select="${esc(candidate.id)}">
          <div class="candidate-topline">
            <span class="candidate-name"><span class="rank-badge">#${index + 1}</span>${esc(candidate.name)}</span>
            <span class="candidate-score">${candidate.score.fit}</span>
          </div>
          <p>${esc(candidate.headline)}${candidate.stage === "conversation" ? ` <span class="stage-badge">In conversation</span>` : ""}</p>
          <div class="mini-metrics">
            <span title="Role relevance (cosine)">rel ${candidate.score.relevance}</span>
            <span title="Calibrated confidence">conf ${candidate.score.confidence}</span>
            <span title="Conversation readiness">conv ${candidate.score.conversation}</span>
          </div>
          <div class="tag-row">
            ${candidate.tags.slice(0, 4).map((tag) => `<span class="tag">${esc(tag)}</span>`).join("")}
          </div>
        </button>
        <div class="card-tools">
          <button class="card-tool" type="button" data-edit="${esc(candidate.id)}" aria-label="Edit ${esc(candidate.name)}">Edit</button>
          <button class="card-tool danger" type="button" data-remove="${esc(candidate.id)}" aria-label="Remove ${esc(candidate.name)}">Remove</button>
        </div>
      </div>
    `)
    .join("");

  candidateList.querySelectorAll("[data-select]").forEach((b) =>
    b.addEventListener("click", () => {
      selectedId = b.dataset.select;
      render();
    })
  );
  candidateList.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => openEditor(b.dataset.edit))
  );
  candidateList.querySelectorAll("[data-remove]").forEach((b) =>
    b.addEventListener("click", () => removeCandidate(b.dataset.remove))
  );
}

function renderDetail(candidate) {
  selectedName.textContent = candidate.name + (candidate.stage === "conversation" ? "  (in conversation)" : "");
  selectedHeadline.textContent = `${candidate.headline} · ${candidate.availability}`;
  scoreValue.textContent = candidate.score.fit;
  scoreRing.style.setProperty("--score-deg", `${candidate.score.fit * 3.6}deg`);
  renderTab(candidate);
}

function renderTab(candidate) {
  if (activeTab === "signals") {
    tabContent.innerHTML = `
      <div class="score-breakdown">
        <div class="why-rank">
          <span class="why-label">Why this fit</span>
          <span>signals ${Math.round(candidate.score.signals.reduce((s, x) => s + x.score, 0) / candidate.score.signals.length)} × 0.62 + role relevance ${candidate.score.relevance} × 0.38${candidate.score.requiresInPerson && candidate.location === "remote-only" ? " − 14 location" : ""} = <strong>${candidate.score.fit}</strong></span>
        </div>
      </div>
      <div class="signal-stack">
        ${candidate.score.signals
          .map((signal) => `
            <article class="signal-card">
              <div class="signal-row">
                <span class="signal-name">${signal.label}</span>
                <strong>${signal.score}</strong>
              </div>
              <div class="bar-track">
                <div class="bar-fill ${signal.color}" style="--fill: ${signal.score}%"></div>
              </div>
              ${signal.contributors.length
                ? `<div class="term-row">${signal.contributors
                    .map((c) => `<span class="term-chip">${esc(c.term)} <em>${c.weight.toFixed(2)}</em></span>`)
                    .join("")}</div>`
                : ""}
              <p class="evidence">${esc(signal.evidence)}</p>
            </article>
          `)
          .join("")}
      </div>
    `;
    return;
  }

  if (activeTab === "context") {
    tabContent.innerHTML = `
      <div class="context-stack">
        <article class="context-block">
          <h4>Resume / profile text <span class="field-weight">weight ${FIELD_WEIGHTS.text.toFixed(2)}</span></h4>
          <p>${esc(candidate.text) || "<em>empty</em>"}</p>
        </article>
        <article class="context-block">
          <h4>Audio transcript <span class="field-weight">weight ${FIELD_WEIGHTS.audio.toFixed(2)}</span></h4>
          <p>${esc(candidate.audio) || "<em>empty</em>"}</p>
        </article>
        <article class="context-block">
          <h4>Video notes <span class="field-weight">weight ${FIELD_WEIGHTS.video.toFixed(2)}</span></h4>
          <p>${esc(candidate.video) || "<em>empty</em>"}</p>
        </article>
      </div>
    `;
    return;
  }

  const inConvo = candidate.stage === "conversation";
  tabContent.innerHTML = `
    <div class="action-stack">
      <article class="action-block">
        <h4>Candidate-facing explanation</h4>
        <p>This role was suggested because the profile shows the strongest evidence for ${esc(topSignals(candidate).join(" and "))}, and broadly matches the role brief (relevance ${candidate.score.relevance}/100). Before intro, Figwork should clarify ${esc(candidate.score.gaps[0].toLowerCase())}</p>
      </article>
      <article class="action-block">
        <h4>Recruiter follow-up</h4>
        <ol>
          ${candidate.score.gaps.map((gap) => `<li>${esc(gap)}</li>`).join("")}
          <li>Send a short intro that references concrete evidence, not just title keywords.</li>
        </ol>
      </article>
      <div class="action-row">
        <button class="primary" type="button" id="moveToConvo">${inConvo ? "Move back to shortlist" : "Move to conversation"}</button>
        <button class="secondary" type="button" id="requestContext">Request more context</button>
      </div>
    </div>
  `;

  el("#moveToConvo").addEventListener("click", () => {
    candidate.stage = inConvo ? "shortlist" : "conversation";
    saveState();
    render();
  });
  el("#requestContext").addEventListener("click", () => {
    // Open the editor focused on the weakest-evidence field for this candidate.
    const weakest = [...candidate.score.signals].sort((a, b) => a.score - b.score)[0];
    const fieldMap = { aiworkflow: "f_audio", hiring: "f_video" };
    openEditor(candidate.id, fieldMap[weakest.key] || "f_text");
  });
}

function topSignals(candidate) {
  return [...candidate.score.signals]
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((signal) => signal.label.toLowerCase());
}

function renderSummary(scoredCandidates) {
  candidateCount.textContent = scoredCandidates.length;
  topScore.textContent = scoredCandidates[0]?.score.fit || 0;
  reviewCount.textContent = scoredCandidates.filter(
    (candidate) => candidate.score.confidence < 75 || candidate.score.gaps.length > 1
  ).length;
}

function render() {
  CORPUS = buildCorpus(); // recompute IDF across the current candidate set
  renderRoleSignals();
  const scoredCandidates = getRankedCandidates();
  if (!scoredCandidates.find((candidate) => candidate.id === selectedId)) {
    selectedId = scoredCandidates[0]?.id;
  }
  renderSummary(scoredCandidates);
  renderCandidateList(scoredCandidates);
  const selected = scoredCandidates.find((candidate) => candidate.id === selectedId);
  if (selected) {
    el("#selectedName").closest(".detail-column").classList.remove("is-empty");
    renderDetail(selected);
  } else {
    selectedName.textContent = "No candidate";
    selectedHeadline.textContent = "";
    scoreValue.textContent = "0";
    scoreRing.style.setProperty("--score-deg", "0deg");
    tabContent.innerHTML = `<p class="empty-note">No candidate selected. Add one or reset the samples.</p>`;
  }
}

/* ---------- Candidate CRUD + editor modal ---------- */

function slugId(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "candidate";
  let id = base;
  let n = 2;
  while (candidates.some((c) => c.id === id)) id = `${base}-${n++}`;
  return id;
}

function openEditor(id, focusFieldId) {
  editingId = id || null;
  const c = id ? candidates.find((x) => x.id === id) : null;
  editorTitle.textContent = c ? `Edit ${c.name}` : "Add candidate";
  el("#f_name").value = c ? c.name : "";
  el("#f_headline").value = c ? c.headline : "";
  el("#f_location").value = c ? c.location : "relocating";
  el("#f_text").value = c ? c.text : "";
  el("#f_audio").value = c ? c.audio : "";
  el("#f_video").value = c ? c.video : "";
  el("#f_tags").value = c ? c.tags.join(", ") : "";
  editorBackdrop.hidden = false;
  const focusEl = (focusFieldId && el("#" + focusFieldId)) || el("#f_name");
  focusEl.focus();
}

function closeEditor() {
  editorBackdrop.hidden = true;
  editingId = null;
}

function availabilityLabel(location) {
  if (location === "remote-only") return "Remote only";
  if (location === "bay-area") return "Bay Area, hybrid preferred";
  return "Open to relocation / onsite";
}

function submitEditor(event) {
  event.preventDefault();
  const name = el("#f_name").value.trim();
  if (!name) {
    el("#f_name").focus();
    return;
  }
  const data = {
    name,
    headline: el("#f_headline").value.trim() || "Candidate",
    location: el("#f_location").value,
    availability: availabilityLabel(el("#f_location").value),
    text: el("#f_text").value.trim(),
    audio: el("#f_audio").value.trim(),
    video: el("#f_video").value.trim(),
    tags: el("#f_tags").value.split(",").map((t) => t.trim()).filter(Boolean)
  };

  if (editingId) {
    const c = candidates.find((x) => x.id === editingId);
    Object.assign(c, data);
    selectedId = editingId;
  } else {
    const id = slugId(name);
    candidates.push({ id, stage: "shortlist", ...data });
    selectedId = id;
  }
  closeEditor();
  saveState();
  render();
}

function removeCandidate(id) {
  const c = candidates.find((x) => x.id === id);
  if (!c) return;
  if (!confirm(`Remove ${c.name} from the shortlist?`)) return;
  candidates = candidates.filter((x) => x.id !== id);
  if (selectedId === id) selectedId = candidates[0]?.id;
  saveState();
  render();
}

function resetToSamples() {
  candidates = clone(SEED_CANDIDATES);
  selectedId = candidates[0].id;
  activeTab = "signals";
  roleInput.value = defaultRoleBrief;
  roleTitle.textContent = DEFAULT_ROLE_TITLE;
  roleSub.textContent = DEFAULT_ROLE_SUB;
  syncTabButtons();
  closeEditor();
  saveState();
  render();
}

function syncTabButtons() {
  document.querySelectorAll(".tab").forEach((button) => {
    const isActive = button.dataset.tab === activeTab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
}

/* ---------- Wiring ---------- */

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    activeTab = tab.dataset.tab;
    syncTabButtons();
    render();
  });
});

roleInput.addEventListener("input", () => {
  saveState();
  render();
});
sortMode.addEventListener("change", render);
resetButton.addEventListener("click", resetToSamples);
addCandidateButton.addEventListener("click", () => openEditor(null));

editorForm.addEventListener("submit", submitEditor);
el("#editorClose").addEventListener("click", closeEditor);
el("#editorCancel").addEventListener("click", closeEditor);
editorBackdrop.addEventListener("click", (e) => {
  if (e.target === editorBackdrop) closeEditor();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !editorBackdrop.hidden) closeEditor();
});

/* ---------- Init ---------- */

if (!loadState()) {
  roleInput.value = defaultRoleBrief;
}
render();
