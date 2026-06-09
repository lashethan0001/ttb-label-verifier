# TTB Label Verification Assistant

An AI-powered prototype that helps TTB compliance agents verify alcohol beverage label artwork against application data. Upload one label image — or a whole batch — and get a field-by-field comparison in a few seconds, including a strict check of the mandatory government health warning statement.

**This tool assists with routine matching. It never approves or rejects an application — the agent always makes the final call.**

## What it checks

| Field | How it's checked |
|---|---|
| Brand name | Exact match; case-only differences (e.g. `STONE'S THROW` vs `Stone's Throw`) count as a match with a note |
| Class / type | Same matching rules as brand name |
| Alcohol content | Numeric comparison, so `45% Alc./Vol. (90 Proof)` matches an application value of `45` |
| Net contents | Unit-normalized comparison (`750 mL` = `750ml` = `750 milliliters`) |
| Government warning | Character-level comparison against the statutory text (27 CFR Part 16), plus checks that `GOVERNMENT WARNING:` is all-caps and appears bold |

Every result is one of three verdicts: **Match**, **Needs review**, or **Mismatch** — ambiguity is surfaced to the agent, never silently resolved.

## Architecture

```
Browser (React + Tailwind)          Serverless function          Anthropic API
┌─────────────────────────┐        ┌──────────────────┐        ┌─────────────┐
│ Application data form    │        │ /api/analyze      │        │ Claude       │
│ Image upload (batch OK)  │──────▶│ holds the API key │──────▶│ vision model │
│ Comparison rules engine  │◀──────│ returns extracted │◀──────│ reads label  │
│ Results UI               │  JSON  │ label fields      │  JSON  │ text         │
└─────────────────────────┘        └──────────────────┘        └─────────────┘
```

Key decision: **the AI only extracts text from the image; all pass/fail decisions are made by deterministic code** (`src/compliance.js`). See `docs/APPROACH.md` for the full rationale.

## Local setup

Prerequisites: Node.js 18+, an [Anthropic API key](https://console.anthropic.com/).

```bash
git clone <this-repo>
cd ttb-label-verifier
npm install

# Provide the API key (never committed — see .gitignore)
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY=sk-ant-...

# Run frontend + serverless API together
npx vercel dev
```

Open the printed localhost URL. The form is pre-filled with the sample "Old Tom Distillery" application from the project brief, so you can drop in a test label and click **Check this label** immediately.

> `npx vercel dev` runs both the Vite frontend and the `/api` function locally.
> If you prefer plain `npm run dev`, set `VITE_API_BASE` in `.env` to a deployed
> instance of the API (the frontend alone has no access to the API key).

## Deploying (Vercel)

```bash
npm i -g vercel
vercel                       # link/create the project
vercel env add ANTHROPIC_API_KEY   # paste your key (Production)
vercel --prod
```

The printed `https://<project>.vercel.app` URL is the deployed application. Netlify or any platform with Node serverless functions works the same way — only `api/analyze.js` is platform-shaped, and it's ~80 lines.

## Testing it

1. **Clean pass** — a label whose fields match the pre-filled form.
2. **Title-case warning** — a label where the warning reads `Government Warning:` instead of `GOVERNMENT WARNING:`. Should be flagged as a mismatch with a specific explanation (a real-world rejection case from the stakeholder interviews).
3. **Wrong ABV** — label says 40%, application says 45%. Should show exactly which numbers disagree.
4. **Case-only brand difference** — `STONE'S THROW` vs `Stone's Throw`. Should pass with a note, not fail.
5. **Batch** — select 10+ images at once; they process three at a time with live status.
6. **Bad photo** — an angled/glary shot. The model attempts the read anyway and notes quality issues; if truly unreadable, the result says so instead of guessing.

AI image generators work well for creating test labels (as the brief suggests). Include the full statutory warning text when generating a "clean" label.

## Project structure

```
api/analyze.js        Serverless proxy to the Anthropic API (key stays server-side)
src/App.jsx           UI: form, upload, batch queue, results
src/compliance.js     Deterministic comparison rules — the actual "verifier"
docs/APPROACH.md      Design rationale, tools, assumptions, trade-offs
```

## Known limitations

- Single-image-per-application model; real COLA applications can have front/back/neck labels. Multi-image-per-application is a straightforward extension of the same pipeline.
- Bottler name/address and country of origin are not yet checked (the brief's core sample fields are). Adding a field is one entry in the form, one line in the extraction prompt, one comparison function.
- Type-size and contrast requirements for the warning are approximated by the model's "appears bold / hard to read" judgment, surfaced as **Needs review** rather than decided automatically.
- No persistence by design — nothing is stored server-side (per IT guidance: "we're not storing anything sensitive for this exercise").
