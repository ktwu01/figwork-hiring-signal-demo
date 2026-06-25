# Figwork Hiring Signal Demo

A small static prototype for a Figwork-style hiring signal workflow.

Live demo: https://koutian.is-a.dev/figwork-hiring-signal-demo/

The demo is intentionally narrow: it shows how text, audio transcript, and video interview notes can become structured hiring signals, ranked candidate-role fit, evidence gaps, and recruiter next actions. It is not a production matching model and does not call an LLM. The scoring is transparent, dependency-free JavaScript so the product loop is easy to inspect, but it uses the same retrieval and ranking building blocks a real candidate-role matcher would.

## How the matching engine works

The ranking core is a small information-retrieval + recommender pipeline, all in `app.js`:

1. **Tokenization** with a stopword list, preserving single-token compound terms like `ci/cd`, `co-founder`, and `llm-as-judge`. Multi-word phrase matching is out of scope, so the signal vocabularies use single tokens only.
2. **Per-field weighting.** A written resume claim (weight 1.0) counts more than an audio transcript (0.7) or a soft video impression (0.55); self-declared tags get the lowest weight (0.4) because they repeat resume claims. The engine trusts verifiable, written context over labels.
3. **BM25 term weighting with IDF.** Inverse document frequency is computed across the candidate pool, so a rare, differentiating term (`rag`, `observability`, `ats`) counts more than one everybody mentions. Term-frequency saturation (`k1`) and length normalization (`b`) stop a long resume from winning on volume alone.
4. **Per-signal scores** sum the BM25 contributions of that signal's vocabulary and squash through a logistic into a 0–100 band (no matched terms means a true 0, not a floor). The constants are hand-tuned, not learned. The top contributing terms and their BM25 weights are exposed in the UI for traceability.
5. **Role-vector cosine similarity.** The role brief becomes an IDF-weighted query vector; cosine similarity against each candidate vector gives a global relevance term beyond the five named signals. Because raw cosine for a short query against long docs is always small, displayed relevance is scaled **relative to the best candidate in the pool** (max-relative), so the strongest match anchors 100. With only three candidates this is a display convenience, not a stable absolute score.
6. **Final fit** blends named-signal coverage (0.62) with role relevance (0.38), then applies a location penalty **only when the role brief actually asks for in-person/onsite work** (parsed from the brief). Editing the brief to a remote role removes the penalty and the Sunnyvale follow-up.
7. **Confidence** is a heuristic driven by evidence mass (total BM25 signal energy + number of well-filled fields). It is not calibrated against labeled hiring outcomes; it is a hand-tuned logistic that makes "needs review" track how much signal a profile actually carries.

The Signals tab shows the fit decomposition and the per-signal term contributions; the Context tab shows the field weights. Confidence, conversation readiness, and the raw role cosine are summarized but not decomposed term-by-term in the UI.

### What this is not

This is a transparent demo, not production IR. IDF is computed over a three-candidate toy pool, so "rare" is only rare relative to that pool. The candidate pool is handcrafted. There is no learned ranking model, no calibration against outcomes, and no add-candidate or test harness. The point is an explainable ranking a recruiter could defend, with every shortcut stated rather than hidden.

## Why this exists

Figwork's stated product direction is to help the right people find the right opportunities and help recruiters understand candidates beyond titles, keywords, and resumes. This prototype turns that idea into a concrete interface:

- Candidate context from resume text, audio transcript, and video notes
- Role priority weighting (fixed-vocabulary term overlap) for a full-stack AI startup engineer
- Candidate ranking with explainable evidence
- Candidate-facing visibility into why a match was suggested
- Recruiter follow-up actions that move a match toward a real conversation

## Run locally

Open `index.html` directly in a browser.

No dependencies are required.

## Deploy to GitHub Pages

1. Create a new GitHub repo.
2. Push this folder's contents.
3. In the repo settings, enable GitHub Pages from the `main` branch root.
4. Share the generated Pages URL.

With the GitHub CLI, from this folder:

```bash
gh repo create figwork-hiring-signal-demo --public --source=. --remote=origin --push
```

## Files

- `index.html` - app shell and content regions
- `styles.css` - responsive UI
- `app.js` - sample data, BM25 + cosine matching engine, ranking, and rendering

## Product notes

If this became a real system, the BM25 + cosine core here would be augmented by multimodal LLM extraction (so signals come from understanding, not term overlap), learned embeddings and a learning-to-rank model trained on recruiter feedback, calibrated probability outputs, audit logs, and candidate consent controls. The demo keeps those pieces visible and inspectable without pretending to solve them fully. The point is that the transparent version already produces an explainable ranking a recruiter can defend.
