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

// Each signal carries not just match terms but the recruiter-facing meaning:
// `whyItMatters` (why the role needs it) and `concern` (the standing caveat a
// recruiter should verify). These turn analytics into a decision aid.
const signalDefinitions = [
  {
    key: "ownership",
    label: "Startup ownership",
    // All terms are single tokens so they match the tokenizer output. "scratch"
    // stands in for "from scratch"; phrase matching is out of scope for the demo.
    terms: ["co-founder", "founder", "owned", "ownership", "built", "shipped", "lead", "maintainer", "scratch", "repo", "ci/cd", "release"],
    whyItMatters: "This role needs someone who can own ambiguous product work end to end without heavy process.",
    concern: "Evidence is self-described project context. Verify production usage, user traction, and team size."
  },
  {
    key: "fullstack",
    label: "Full-stack execution",
    terms: ["react", "electron", "node", "express", "supabase", "oauth", "fastapi", "backend", "frontend", "typescript", "javascript", "sqlite", "vite", "postgres"],
    whyItMatters: "The team ships across the stack, so one engineer needs to move from data layer to UI.",
    concern: "Confirm depth on each layer rather than breadth of named technologies."
  },
  {
    key: "aiworkflow",
    label: "AI workflow depth",
    terms: ["llm", "agent", "agents", "rag", "evaluation", "eval", "llm-as-judge", "prompt", "multimodal", "audio", "video", "model", "matching", "ranking", "embedding"],
    whyItMatters: "The product is an AI hiring platform; real LLM evaluation and retrieval experience reduces ramp time.",
    concern: "Check whether AI work reached production or stayed at prototype scale."
  },
  {
    key: "hiring",
    label: "Hiring-market empathy",
    terms: ["recruiter", "recruiters", "candidate", "candidates", "hiring", "job", "resume", "interview", "talent", "portfolio", "outreach", "conversation", "ats"],
    whyItMatters: "Building for recruiters and candidates is easier with someone who understands the hiring workflow.",
    concern: "Direct experience with recruiter or candidate workflows is often thin; probe in interview."
  },
  {
    key: "reliability",
    label: "Reliability habits",
    terms: ["test", "tests", "tdd", "ci/cd", "quality", "metrics", "audit", "privacy", "pii", "sanitization", "production", "monitoring", "observability"],
    whyItMatters: "Early-stage code still has to be safe to ship; testing and review habits keep velocity sustainable.",
    concern: "Confirm these habits held under real deadlines, not only in side projects."
  }
];

// Map a 0-100 signal score to a plain-English strength band and a one-line
// recruiter meaning. Used everywhere a score is shown so language stays
// consistent instead of leaning on raw numbers.
function strengthBand(score) {
  if (score >= 75) return { label: "Strong evidence", tone: "strong" };
  if (score >= 55) return { label: "Some evidence", tone: "ok" };
  if (score >= 35) return { label: "Limited evidence", tone: "weak" };
  return { label: "Weak evidence", tone: "weak" };
}

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
const detailContent = el("#detailContent");
const sortMode = el("#sortMode");
const candidateCount = el("#candidateCount");
const resetButton = el("#resetButton");
const addCandidateButton = el("#addCandidateButton");
const editorBackdrop = el("#editorBackdrop");
const editorForm = el("#editorForm");
const editorTitle = el("#editorTitle");
const editRoleButton = el("#editRoleButton");
const roleBackdrop = el("#roleBackdrop");

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
      band: strengthBand(score),
      contributors: contributors.slice(0, 3),
      evidence: extractEvidence(candidate, signal.terms),
      sources: evidenceSources(candidate, signal.terms)
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

// Which provided fields actually contain matched terms for this signal. Surfaces
// provenance ("Resume + Screening call") so a recruiter can see where a score
// came from instead of trusting an opaque number.
const FIELD_SOURCES = [
  { key: "text", label: "Resume" },
  { key: "audio", label: "Screening call" },
  { key: "video", label: "Interview notes" }
];

function evidenceSources(candidate, terms) {
  const hits = FIELD_SOURCES.filter((field) => {
    const lower = (candidate[field.key] || "").toLowerCase();
    return terms.some((term) => lower.includes(term));
  }).map((field) => field.label);
  if (candidate.tags.some((tag) => terms.some((t) => tag.toLowerCase().includes(t)))) {
    hits.push("Self-declared tags");
  }
  return hits;
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
      const tone = weight > 3 ? "high" : weight > 0 ? "med" : "low";
      return `
        <div class="role-signal">
          <strong>${signal.label}</strong>
          <span class="req-tag ${tone}">${importance}</span>
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
        or use <strong>Reset demo</strong> to restore the sample set.
      </div>`;
    return;
  }

  // Compact decision card: rank, name, headline, one fit number, top signals,
  // one risk line, a single Review button, and admin actions tucked in a menu.
  candidateList.innerHTML = scoredCandidates
    .map((candidate, index) => {
      const strengths = candidateStrengths(candidate);
      const topTwo = strengths.length ? strengths.slice(0, 2).join(", ") : "Evidence still thin";
      return `
      <div class="candidate-card ${candidate.id === selectedId ? "active" : ""}" data-id="${esc(candidate.id)}">
        <button class="card-main" type="button" data-select="${esc(candidate.id)}">
          <div class="candidate-topline">
            <span class="candidate-name"><span class="rank-badge">#${index + 1}</span>${esc(candidate.name)}</span>
            <span class="fit-chip"><strong>${candidate.score.fit}</strong><small>fit</small></span>
          </div>
          <p class="card-headline">${esc(candidate.headline)}${candidate.stage === "conversation" ? ` <span class="stage-badge">In conversation</span>` : ""}${candidate.concern ? ` <span class="concern-badge">Concern</span>` : ""}</p>
          <p class="card-signal"><span class="dot up"></span>Top signals: ${esc(topTwo)}</p>
          <p class="card-risk"><span class="dot down"></span>Risk: ${esc(topRisk(candidate))}</p>
          ${candidate.note ? `<p class="card-note"><span class="dot note"></span>Note: ${esc(candidate.note)}</p>` : ""}
        </button>
        <div class="card-foot">
          <span class="review-cue">${candidate.id === selectedId ? "Reviewing" : "Review"}</span>
          <div class="menu-wrap">
            <button class="menu-btn" type="button" data-menu="${esc(candidate.id)}" aria-label="More actions for ${esc(candidate.name)}">⋯</button>
            <div class="menu-pop" data-menu-pop="${esc(candidate.id)}" hidden>
              <button type="button" data-edit="${esc(candidate.id)}">Edit candidate</button>
              <button type="button" class="danger" data-remove="${esc(candidate.id)}">Remove</button>
            </div>
          </div>
        </div>
      </div>
    `;
    })
    .join("");

  candidateList.querySelectorAll("[data-select]").forEach((b) =>
    b.addEventListener("click", () => {
      selectedId = b.dataset.select;
      saveState();
      render();
    })
  );
  candidateList.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => openEditor(b.dataset.edit))
  );
  candidateList.querySelectorAll("[data-remove]").forEach((b) =>
    b.addEventListener("click", () => removeCandidate(b.dataset.remove))
  );
  candidateList.querySelectorAll("[data-menu]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const pop = candidateList.querySelector(`[data-menu-pop="${CSS.escape(b.dataset.menu)}"]`);
      const wasHidden = pop.hidden;
      candidateList.querySelectorAll(".menu-pop").forEach((p) => (p.hidden = true));
      pop.hidden = !wasHidden;
    })
  );
}

// The decision view: answers "who, why, what next" in one column. Built fully in
// JS so the header, decision summary, tabs, and tab body re-render together.
function renderDetail(candidate, rank) {
  const inConvo = candidate.stage === "conversation";
  detailContent.innerHTML = `
    <header class="decision-head">
      <div class="decision-id">
        <h3 class="decision-name">${esc(candidate.name)}${inConvo ? ` <span class="stage-badge">In conversation</span>` : ""}${candidate.concern ? ` <span class="concern-badge">Concern flagged</span>` : ""}</h3>
        <p class="decision-sub">${esc(candidate.headline)}</p>
        <p class="decision-meta">${esc(availabilityPlain(candidate))}</p>
      </div>
      <div class="decision-score">
        <span class="big-fit">${candidate.score.fit}</span>
        <span class="fit-caption">fit · rank #${rank} of ${candidates.length}</span>
      </div>
    </header>

    <div class="next-step">
      <span class="next-label">Recommended next step</span>
      <p>${esc(recommendedStep(candidate, rank))}</p>
    </div>

    <div class="decision-action-row">
      <button class="primary" type="button" id="actShortlist">${inConvo ? "In shortlist ✓" : "Shortlist candidate"}</button>
      <button class="secondary" type="button" id="actInterview">${inConvo ? "Back to shortlist" : "Request interview"}</button>
      <button class="ghost-btn" type="button" id="actNote">${candidate.note ? "Edit note" : "Add note"}</button>
      <button class="ghost-btn ${candidate.concern ? "active-concern" : ""}" type="button" id="actConcern">${candidate.concern ? "Clear concern" : "Mark concern"}</button>
    </div>

    ${candidate.note ? `<div class="note-block"><span class="note-label">Recruiter note</span><p>${esc(candidate.note)}</p></div>` : ""}

    <div class="strength-risk">
      <div class="sr-col">
        <p class="sr-head up">Strengths</p>
        <ul>${(candidateStrengths(candidate).length
            ? candidateStrengths(candidate)
            : ["Not enough evidence yet to confirm strengths"]
          ).map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
      </div>
      <div class="sr-col">
        <p class="sr-head down">Risks to verify</p>
        <ul>${candidateRisks(candidate).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
      </div>
    </div>

    <div class="tabs" role="tablist" aria-label="Candidate evidence">
      <button class="tab ${activeTab === "signals" ? "active" : ""}" type="button" data-tab="signals" role="tab">Evidence signals</button>
      <button class="tab ${activeTab === "context" ? "active" : ""}" type="button" data-tab="context" role="tab">Source context</button>
      <button class="tab ${activeTab === "actions" ? "active" : ""}" type="button" data-tab="actions" role="tab">Actions</button>
    </div>

    <div id="tabContent"></div>
  `;

  // Wire the recruiter decision buttons. Shortlist/interview reuse the existing
  // stage toggle; note/concern attach a lightweight flag the card can show.
  el("#actShortlist").addEventListener("click", () => toggleStage(candidate, true));
  el("#actInterview").addEventListener("click", () => toggleStage(candidate, false));
  el("#actNote").addEventListener("click", () => addNote(candidate));
  el("#actConcern").addEventListener("click", () => markConcern(candidate));

  document.querySelectorAll("#detailContent .tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      activeTab = tab.dataset.tab;
      renderTab(candidate, rank);
      syncTabButtons();
    });
  });

  renderTab(candidate, rank);
}

function renderTab(candidate, rank) {
  const tabContent = el("#tabContent");
  if (activeTab === "signals") {
    tabContent.innerHTML = `
      <p class="why-rank">
        <span class="why-label">Why this candidate ranks #${rank}</span>
        ${esc(whyParagraph(candidate))}
        <span class="evidence-confidence">Overall evidence confidence: <strong>${confidenceLabel(candidate.score.confidence)}</strong> (how much real context backs this ranking).</span>
      </p>
      <div class="signal-stack">
        ${candidate.score.signals
          .map((signal) => `
            <article class="signal-card ${signal.band.tone}">
              <div class="signal-row">
                <span class="signal-name">${signal.label} — ${signal.band.label}</span>
                <span class="signal-score">${signal.score}</span>
              </div>
              <div class="bar-track"><div class="bar-fill" style="--fill: ${signal.score}%"></div></div>
              <p class="ev-line"><strong>Evidence.</strong> ${esc(signal.evidence)}</p>
              <p class="ev-line muted-line"><strong>Why it matters.</strong> ${esc(signal.whyItMatters)}</p>
              <p class="ev-line concern-line"><strong>Concern.</strong> ${esc(signal.concern)}</p>
              <p class="ev-source">
                <span>Source: ${signal.sources.length ? esc(signal.sources.join(" + ")) : "no matched evidence"}</span>
              </p>
            </article>
          `)
          .join("")}
      </div>
    `;
    return;
  }

  if (activeTab === "context") {
    tabContent.innerHTML = `
      <p class="context-note">Raw inputs behind every score. Written context is trusted more than soft signals (weights shown).</p>
      <div class="context-stack">
        <article class="context-block">
          <h4>Resume / profile text <span class="field-weight">weight ${FIELD_WEIGHTS.text.toFixed(2)}</span></h4>
          <p>${esc(candidate.text) || "<em>empty</em>"}</p>
        </article>
        <article class="context-block">
          <h4>Screening call notes <span class="field-weight">weight ${FIELD_WEIGHTS.audio.toFixed(2)}</span></h4>
          <p>${esc(candidate.audio) || "<em>empty</em>"}</p>
        </article>
        <article class="context-block">
          <h4>Interview notes <span class="field-weight">weight ${FIELD_WEIGHTS.video.toFixed(2)}</span></h4>
          <p>${esc(candidate.video) || "<em>empty</em>"}</p>
        </article>
      </div>
    `;
    return;
  }

  // Actions tab: the operational outputs a recruiter acts on.
  const weakest = [...candidate.score.signals].sort((a, b) => a.score - b.score)[0];
  const strongest = [...candidate.score.signals].sort((a, b) => b.score - a.score)[0];
  tabContent.innerHTML = `
    <div class="action-stack">
      <article class="action-block">
        <h4>Suggested interview questions</h4>
        <ol>
          <li>Walk me through what you personally owned in your strongest project (${esc(strongest.label.toLowerCase())}).</li>
          <li>${esc(interviewProbe(weakest))}</li>
          <li>How do you decide when an AI feature is reliable enough to ship to real users?</li>
        </ol>
      </article>
      <article class="action-block">
        <h4>Evidence gaps to verify</h4>
        <ol>${candidate.score.gaps.map((gap) => `<li>${esc(gap)}</li>`).join("")}</ol>
      </article>
      <article class="action-block">
        <h4>Intro email draft</h4>
        <p class="draft">Hi ${esc(candidate.name.split(" ")[0])}, your work on ${esc(strongest.label.toLowerCase())} stood out for our Full-Stack Engineer role. I'd like to set up a short call to learn more about ${esc(weakest.label.toLowerCase())}. Are you open to a 30-minute conversation this week?</p>
      </article>
      <div class="action-row">
        <button class="secondary" type="button" id="requestContext">Request more context</button>
        <button class="ghost-btn" type="button" id="compareBtn">Compare with ${esc(compareTargetName(candidate))}</button>
      </div>
    </div>
  `;

  el("#requestContext").addEventListener("click", () => {
    const fieldMap = { aiworkflow: "f_audio", hiring: "f_video" };
    openEditor(candidate.id, fieldMap[weakest.key] || "f_text");
  });
  const compareBtn = el("#compareBtn");
  if (compareBtn) {
    compareBtn.addEventListener("click", () => {
      const other = compareTargetId(candidate);
      if (other) {
        selectedId = other;
        activeTab = "signals";
        saveState();
        render();
      }
    });
  }
}

// Plain-English "why this ranks here" paragraph, replacing the formula line.
function whyParagraph(candidate) {
  const strengths = candidateStrengths(candidate);
  const first = candidate.name.split(" ")[0];
  if (!strengths.length) {
    return `${first} does not yet show strong evidence on the role's named signals; the rank reflects broad relevance (${candidate.score.relevance}/100) more than demonstrated strengths.`;
  }
  return `${first} scores high on ${strengths.slice(0, 2).join(" and ").toLowerCase()}. The main gap to verify is ${topGapLabel(candidate)}.`;
}

function interviewProbe(signal) {
  return `Your evidence on ${signal.label.toLowerCase()} is ${signal.band.label.toLowerCase()} — can you give a concrete example with measurable impact?`;
}

function availabilityPlain(candidate) {
  if (candidate.location === "remote-only") return "Remote only · not available for in-person Sunnyvale";
  if (candidate.location === "bay-area") return "Bay Area · hybrid preferred";
  return "Open to Sunnyvale relocation · visa details need review";
}

function compareTargetId(candidate) {
  const ranked = getRankedCandidates();
  const other = ranked.find((c) => c.id !== candidate.id);
  return other ? other.id : null;
}

function compareTargetName(candidate) {
  const id = compareTargetId(candidate);
  const c = candidates.find((x) => x.id === id);
  return c ? c.name : "next candidate";
}

/* ---------- Recruiter decision actions ---------- */

function toggleStage(candidate, wantShortlist) {
  // "Shortlist" marks the candidate as in conversation; "Request interview"
  // toggles it back. One stage flag keeps the demo state simple but real.
  candidate.stage = wantShortlist ? "conversation" : "shortlist";
  saveState();
  render();
}

function addNote(candidate) {
  const note = prompt(`Add a note for ${candidate.name}:`, candidate.note || "");
  if (note === null) return;
  candidate.note = note.trim();
  saveState();
  render();
}

function markConcern(candidate) {
  candidate.concern = !candidate.concern;
  saveState();
  render();
}

function topSignals(candidate) {
  return [...candidate.score.signals]
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((signal) => signal.label.toLowerCase());
}

// The 1-2 strongest signals, as short strengths for the decision summary.
function candidateStrengths(candidate) {
  return [...candidate.score.signals]
    .filter((s) => s.score >= 55)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => s.label);
}

// Risks = the weakest signals plus any logistics flag (location / confidence).
function candidateRisks(candidate) {
  const risks = [...candidate.score.signals]
    .filter((s) => s.score < 50)
    .sort((a, b) => a.score - b.score)
    .slice(0, 2)
    .map((s) => `${s.label} not yet demonstrated`);
  if (candidate.score.requiresInPerson && candidate.location === "remote-only") {
    risks.push("Not available for in-person Sunnyvale work");
  } else if (candidate.location === "relocating") {
    risks.push("Relocation and visa logistics need review");
  }
  if (candidate.score.confidence < 70) {
    risks.push("Limited evidence overall; confidence is moderate");
  }
  return risks.slice(0, 4);
}

// The single short risk line shown on the compact shortlist card.
function topRisk(candidate) {
  return candidateRisks(candidate)[0] || "No major risks flagged";
}

// Plain-English confidence label for the evidence-mass confidence number.
function confidenceLabel(confidence) {
  if (confidence >= 80) return "High";
  if (confidence >= 65) return "Medium";
  return "Low";
}

// The weakest signal's label as a plain noun phrase ("hiring-market empathy"),
// safe to drop into a sentence slot. Distinct from candidateRisks, which
// returns full risk clauses for the bullet list.
function topGapLabel(candidate) {
  const weakest = [...candidate.score.signals].sort((a, b) => a.score - b.score)[0];
  return weakest ? weakest.label.toLowerCase() : "the open gaps";
}

// One-line recommended next step for the decision header, conditioned on the
// dominant strength vs. the dominant gap.
function recommendedStep(candidate, rank) {
  const strengths = candidateStrengths(candidate);
  if (rank === 1 && strengths.length) {
    return `Interview if you weight ${strengths[0].toLowerCase()} above ${topGapLabel(candidate)}.`;
  }
  if (strengths.length) {
    return `Keep on the shortlist, then verify ${topGapLabel(candidate)} before deciding.`;
  }
  return "Request more context before investing recruiter time.";
}

function render() {
  CORPUS = buildCorpus(); // recompute IDF across the current candidate set
  renderRoleSignals();
  const scoredCandidates = getRankedCandidates();
  if (!scoredCandidates.find((candidate) => candidate.id === selectedId)) {
    selectedId = scoredCandidates[0]?.id;
  }
  candidateCount.textContent = scoredCandidates.length;
  renderCandidateList(scoredCandidates);
  const rank = scoredCandidates.findIndex((c) => c.id === selectedId) + 1;
  const selected = scoredCandidates.find((candidate) => candidate.id === selectedId);
  if (selected) {
    renderDetail(selected, rank);
  } else {
    detailContent.innerHTML = `<p class="empty-note">No candidate selected. Add one or reset the samples.</p>`;
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
  closeEditor();
  closeRoleEditor();
  saveState();
  render();
}

// Active-tab styling is applied by renderDetail when it rebuilds the tab bar;
// this keeps the buttons in sync after an out-of-band activeTab change.
function syncTabButtons() {
  document.querySelectorAll("#detailContent .tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === activeTab);
  });
}

function openRoleEditor() {
  roleBackdrop.hidden = false;
  roleInput.focus();
}

function closeRoleEditor() {
  roleBackdrop.hidden = true;
}

/* ---------- Wiring ---------- */

sortMode.addEventListener("change", render);
resetButton.addEventListener("click", resetToSamples);
addCandidateButton.addEventListener("click", () => openEditor(null));

editorForm.addEventListener("submit", submitEditor);
el("#editorClose").addEventListener("click", closeEditor);
el("#editorCancel").addEventListener("click", closeEditor);
editorBackdrop.addEventListener("click", (e) => {
  if (e.target === editorBackdrop) closeEditor();
});

// Role brief drawer: edits re-rank live, "Done" / backdrop / Escape close it.
editRoleButton.addEventListener("click", openRoleEditor);
el("#roleClose").addEventListener("click", closeRoleEditor);
el("#roleDone").addEventListener("click", closeRoleEditor);
roleInput.addEventListener("input", () => {
  saveState();
  render();
});
roleBackdrop.addEventListener("click", (e) => {
  if (e.target === roleBackdrop) closeRoleEditor();
});

// Close candidate-card action menus when clicking elsewhere.
document.addEventListener("click", (e) => {
  if (!e.target.closest(".menu-wrap")) {
    document.querySelectorAll(".menu-pop").forEach((p) => (p.hidden = true));
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!editorBackdrop.hidden) closeEditor();
  else if (!roleBackdrop.hidden) closeRoleEditor();
});

/* ---------- Init ---------- */

if (!loadState()) {
  roleInput.value = defaultRoleBrief;
}
render();
