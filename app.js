const defaultRoleBrief = `Figwork is building an AI hiring platform that helps the right people find the right opportunities and helps recruiters understand candidates beyond titles, keywords, and resumes.

Role: Software Engineer, Full Stack.
Signals: early-stage ownership, full-stack product execution, AI workflow experience, recruiter/candidate empathy, ability to convert messy text/audio/video context into useful hiring signals, reliability, and willingness to work in person in Sunnyvale.`;

const signalDefinitions = [
  {
    key: "ownership",
    label: "Startup ownership",
    color: "teal",
    terms: ["co-founder", "founder", "owned", "ownership", "built", "shipped", "lead", "maintainer", "from scratch", "repo", "ci/cd", "release"]
  },
  {
    key: "fullstack",
    label: "Full-stack execution",
    color: "green",
    terms: ["react", "electron", "node", "express", "supabase", "github oauth", "fastapi", "backend", "frontend", "typescript", "javascript", "sqlite"]
  },
  {
    key: "aiworkflow",
    label: "AI workflow depth",
    color: "plum",
    terms: ["llm", "agent", "agents", "rag", "evaluation", "llm-as-judge", "prompt", "multimodal", "audio", "video", "model", "matching"]
  },
  {
    key: "hiring",
    label: "Hiring-market empathy",
    color: "amber",
    terms: ["recruiter", "candidate", "hiring", "job", "resume", "interview", "talent", "portfolio", "outreach", "conversation"]
  },
  {
    key: "reliability",
    label: "Reliability habits",
    color: "teal",
    terms: ["test", "tests", "tdd", "ci/cd", "quality", "metrics", "audit", "privacy", "pii", "sanitization", "production"]
  }
];

const candidates = [
  {
    id: "koutian",
    name: "Koutian Wu",
    headline: "Full-stack AI builder, Ph.D. student at UT Austin",
    availability: "Open to Sunnyvale relocation; visa logistics discussable",
    text: "Technical Co-Founder at Tacite.AI. Designed and built Atomize, a local-first React/Electron AI assistant, owned most implementation, repo management, CI/CD, tests, and release workflow across 600+ commits. Co-Lead and maintainer of ResearchSkills.ai, a Node.js/Express, React/Vite, Supabase, GitHub OAuth platform for research-skill submissions and review. Built LLM-as-judge evaluation system for production RAG agent at 19Pine.AI with PII sanitization, Q&A extraction, concurrent evaluation, and quality metrics.",
    audio: "Audio transcript: I care about building tools where AI makes messy human context usable. In hiring, the hard part is not only ranking. It is showing why a person may belong in a role, what is still uncertain, and how to move both sides into a real conversation.",
    video: "Video notes: Communicates quickly, emphasizes product ownership, accepts ambiguity, explains tradeoffs around model confidence, human review, and feedback loops. Strong energy for early-stage engineering and technical leadership growth.",
    tags: ["React/Electron", "Node/Express", "LLM eval", "CI/CD", "Startup ownership"]
  },
  {
    id: "maya",
    name: "Maya Chen",
    headline: "Backend-heavy ML platform engineer",
    availability: "Bay Area, hybrid preferred",
    text: "Built Python services for ML feature pipelines, model monitoring, and search ranking. Strong distributed systems background with Kubernetes, Postgres, Redis, and observability. Less direct ownership of consumer-facing frontend, but strong backend reliability and model-serving experience.",
    audio: "Audio transcript: I prefer infrastructure roles where I can improve latency, reliability, and model evaluation. I have worked closely with ML scientists but not directly with recruiters or hiring workflows.",
    video: "Video notes: Very clear on backend architecture. Product interest is present but less specific to candidate/recruiter workflows.",
    tags: ["Python", "Ranking infra", "Kubernetes", "Observability"]
  },
  {
    id: "aaron",
    name: "Aaron Patel",
    headline: "Recruiting SaaS product engineer",
    availability: "Remote only",
    text: "Built ATS integrations, recruiter dashboards, sequencing workflows, and candidate pipeline analytics in a B2B SaaS company. Strong React and product sense. Limited LLM or agent experience beyond prompt-based summarization features.",
    audio: "Audio transcript: Recruiters need fewer tabs and better candidate context. I have strong opinions about workflow design, handoff states, and why ATS data is often too shallow.",
    video: "Video notes: Excellent recruiter empathy and SaaS workflow intuition. Weaker on AI system design and not available for in-person Sunnyvale work.",
    tags: ["Recruiting SaaS", "React", "ATS", "Workflow design"]
  }
];

let selectedId = candidates[0].id;
let activeTab = "signals";

const roleInput = document.querySelector("#roleInput");
const roleSignals = document.querySelector("#roleSignals");
const candidateList = document.querySelector("#candidateList");
const selectedName = document.querySelector("#selectedName");
const selectedHeadline = document.querySelector("#selectedHeadline");
const scoreValue = document.querySelector("#scoreValue");
const scoreRing = document.querySelector("#scoreRing");
const tabContent = document.querySelector("#tabContent");
const sortMode = document.querySelector("#sortMode");
const candidateCount = document.querySelector("#candidateCount");
const topScore = document.querySelector("#topScore");
const reviewCount = document.querySelector("#reviewCount");
const resetButton = document.querySelector("#resetButton");

function normalize(text) {
  return text.toLowerCase();
}

function countMatches(text, terms) {
  const haystack = normalize(text);
  return terms.reduce((count, term) => count + (haystack.includes(term) ? 1 : 0), 0);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function scoreCandidate(candidate, roleBrief) {
  const fullContext = `${candidate.text} ${candidate.audio} ${candidate.video}`;
  const roleContext = roleBrief || defaultRoleBrief;
  const roleWeights = Object.fromEntries(signalDefinitions.map((signal) => {
    const roleHits = countMatches(roleContext, signal.terms);
    return [signal.key, 1 + Math.min(roleHits, 3) * 0.18];
  }));

  const signals = signalDefinitions.map((signal) => {
    const hits = countMatches(fullContext, signal.terms);
    const weighted = hits * roleWeights[signal.key];
    const score = clamp(Math.round((weighted / 7) * 100), 12, 100);
    const evidence = extractEvidence(candidate, signal.terms);
    return { ...signal, hits, score, evidence };
  });

  const base = signals.reduce((sum, signal) => sum + signal.score, 0) / signals.length;
  const sunnyvalePenalty = normalize(candidate.availability).includes("remote only") ? 12 : 0;
  const confidence = clamp(Math.round(52 + evidenceDensity(candidate) * 9), 50, 96);
  const fit = clamp(Math.round(base - sunnyvalePenalty), 0, 100);
  const conversation = clamp(Math.round((fit * 0.65) + (confidence * 0.35)), 0, 100);
  const gaps = deriveGaps(signals, candidate);

  return { fit, confidence, conversation, signals, gaps };
}

function evidenceDensity(candidate) {
  const fields = [candidate.text, candidate.audio, candidate.video];
  return fields.filter((field) => field.length > 120).length + Math.min(candidate.tags.length, 4) / 2;
}

function extractEvidence(candidate, terms) {
  const chunks = [candidate.text, candidate.audio, candidate.video]
    .flatMap((text) => text.split(". "))
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const match = chunks.find((chunk) => terms.some((term) => normalize(chunk).includes(term)));
  return match || "No strong evidence found in the provided context.";
}

function deriveGaps(signals, candidate) {
  const gaps = [];
  signals.forEach((signal) => {
    if (signal.score < 45) {
      gaps.push(`Ask for more evidence on ${signal.label.toLowerCase()}.`);
    }
  });
  if (normalize(candidate.availability).includes("remote only")) {
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

  const mode = sortMode.value;
  return scored.sort((a, b) => b.score[mode] - a.score[mode]);
}

function renderRoleSignals() {
  const roleBrief = roleInput.value;
  roleSignals.innerHTML = signalDefinitions.map((signal) => {
    const hits = countMatches(roleBrief, signal.terms);
    const importance = hits > 2 ? "High" : hits > 0 ? "Medium" : "Implicit";
    return `
      <div class="role-signal">
        <strong>${signal.label}</strong>
        <span>${importance}</span>
      </div>
    `;
  }).join("");
}

function renderCandidateList(scoredCandidates) {
  candidateList.innerHTML = scoredCandidates.map((candidate) => `
    <button class="candidate-card ${candidate.id === selectedId ? "active" : ""}" type="button" data-id="${candidate.id}">
      <div class="candidate-topline">
        <span class="candidate-name">${candidate.name}</span>
        <span class="candidate-score">${candidate.score.fit}</span>
      </div>
      <p>${candidate.headline}</p>
      <div class="tag-row">
        ${candidate.tags.slice(0, 4).map((tag) => `<span class="tag">${tag}</span>`).join("")}
      </div>
    </button>
  `).join("");

  candidateList.querySelectorAll(".candidate-card").forEach((button) => {
    button.addEventListener("click", () => {
      selectedId = button.dataset.id;
      render();
    });
  });
}

function renderDetail(candidate) {
  selectedName.textContent = candidate.name;
  selectedHeadline.textContent = `${candidate.headline} · ${candidate.availability}`;
  scoreValue.textContent = candidate.score.fit;
  scoreRing.style.setProperty("--score-deg", `${candidate.score.fit * 3.6}deg`);
  renderTab(candidate);
}

function renderTab(candidate) {
  if (activeTab === "signals") {
    tabContent.innerHTML = `
      <div class="signal-stack">
        ${candidate.score.signals.map((signal) => `
          <article class="signal-card">
            <div class="signal-row">
              <span class="signal-name">${signal.label}</span>
              <strong>${signal.score}</strong>
            </div>
            <div class="bar-track">
              <div class="bar-fill ${signal.color}" style="--fill: ${signal.score}%"></div>
            </div>
            <p class="evidence">${signal.evidence}</p>
          </article>
        `).join("")}
      </div>
    `;
    return;
  }

  if (activeTab === "context") {
    tabContent.innerHTML = `
      <div class="context-stack">
        <article class="context-block">
          <h4>Resume / profile text</h4>
          <p>${candidate.text}</p>
        </article>
        <article class="context-block">
          <h4>Audio transcript</h4>
          <p>${candidate.audio}</p>
        </article>
        <article class="context-block">
          <h4>Video notes</h4>
          <p>${candidate.video}</p>
        </article>
      </div>
    `;
    return;
  }

  tabContent.innerHTML = `
    <div class="action-stack">
      <article class="action-block">
        <h4>Candidate-facing explanation</h4>
        <p>This role was suggested because your profile shows evidence for ${topSignals(candidate).join(", ")}. Before intro, Figwork should clarify ${candidate.score.gaps[0].toLowerCase()}</p>
      </article>
      <article class="action-block">
        <h4>Recruiter follow-up</h4>
        <ol>
          ${candidate.score.gaps.map((gap) => `<li>${gap}</li>`).join("")}
          <li>Send a short intro that references concrete evidence, not just title keywords.</li>
        </ol>
      </article>
      <div class="action-row">
        <button class="primary" type="button">Move to conversation</button>
        <button class="secondary" type="button">Request more context</button>
      </div>
    </div>
  `;
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
  reviewCount.textContent = scoredCandidates.filter((candidate) => candidate.score.confidence < 75 || candidate.score.gaps.length > 1).length;
}

function render() {
  renderRoleSignals();
  const scoredCandidates = getRankedCandidates();
  if (!scoredCandidates.find((candidate) => candidate.id === selectedId)) {
    selectedId = scoredCandidates[0]?.id;
  }
  renderSummary(scoredCandidates);
  renderCandidateList(scoredCandidates);
  const selected = scoredCandidates.find((candidate) => candidate.id === selectedId);
  if (selected) {
    renderDetail(selected);
  } else {
    tabContent.innerHTML = `<p class="empty-note">No candidate selected.</p>`;
  }
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    activeTab = tab.dataset.tab;
    document.querySelectorAll(".tab").forEach((button) => {
      const isActive = button === tab;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    });
    render();
  });
});

roleInput.addEventListener("input", render);
sortMode.addEventListener("change", render);
resetButton.addEventListener("click", () => {
  roleInput.value = defaultRoleBrief;
  selectedId = candidates[0].id;
  activeTab = "signals";
  document.querySelectorAll(".tab").forEach((button) => {
    const isActive = button.dataset.tab === activeTab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  render();
});

roleInput.value = defaultRoleBrief;
render();
