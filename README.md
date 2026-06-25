# Figwork Hiring Signal Demo

A small static prototype for a Figwork-style hiring signal workflow.

The demo is intentionally narrow: it shows how text, audio transcript, and video interview notes can become structured hiring signals, ranked candidate-role fit, evidence gaps, and recruiter next actions. It is not a production matching model and does not call an LLM. The scoring is transparent rule-based JavaScript so the product loop is easy to inspect.

## Why this exists

Figwork's stated product direction is to help the right people find the right opportunities and help recruiters understand candidates beyond titles, keywords, and resumes. This prototype turns that idea into a concrete interface:

- Candidate context from resume text, audio transcript, and video notes
- Role signal extraction for a full-stack AI startup engineer
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
- `app.js` - sample data, signal extraction, ranking, and rendering

## Product notes

If this became a real system, the rule engine here would be replaced or augmented by multimodal LLM extraction, calibrated ranking, recruiter feedback loops, audit logs, and candidate consent controls. The demo keeps those pieces visible without pretending to solve them fully.
