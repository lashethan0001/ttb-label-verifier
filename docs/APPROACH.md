# Approach, Tools, and Assumptions

## The core design decision: AI extracts, code decides

The single most important choice in this prototype is the split of responsibilities:

- **The vision model (Claude) does one job:** read the text off the label image, exactly as printed, and report formatting observations (is the warning prefix all-caps? does it appear bold? was the image hard to read?). Its output is a structured JSON document.
- **Deterministic code (`src/compliance.js`) does all the deciding:** every match/review/mismatch verdict comes from plain, auditable comparison functions.

Why this split:

1. **The warning statement check demands exactness.** The interviews were emphatic that the government warning must match the statutory wording word-for-word, with an all-caps prefix — a title-case "Government Warning" is a real rejection. Exact string comparison is something code does perfectly and language models do unreliably. Asking an LLM "does this match exactly?" invites the model to be helpful and gloss over a missing comma. So the statutory text from 27 CFR Part 16 lives as a constant in the code, and comparison is character-by-character (normalizing only whitespace and typographic quotes/dashes, which are rendering artifacts rather than wording differences).
2. **Auditability.** For a federal compliance context, "why was this flagged?" should have an answer a human can read in the source code, not "the model felt that way." Each verdict carries a plain-language note explaining itself, including pinpointing where the warning text first deviates.
3. **Consistency.** The same label and application data always produce the same verdict.

## Encoding the agents' judgment, not replacing it

The senior agent's example — `STONE'S THROW` on the label vs `Stone's Throw` in the application — shaped the verdict model:

- **Three states, not two.** Match / Needs review / Mismatch. Binary verdicts force the system to either nag agents with false mismatches (they'll stop trusting it, like the 2008 phone system) or silently auto-resolve ambiguity (dangerous in compliance).
- **Case-only differences are a match with a note.** The note preserves transparency without generating a false alarm.
- **Partial containment matches go to "Needs review."** The tool says "likely the same, please confirm" instead of guessing.
- **The tool never approves or rejects.** The header, footer, and verdict language all frame it as an assistant. This is both the right trust posture for adoption (the skeptical-veteran constituency) and the right accountability posture for a federal workflow.

## Speed (the 5-second requirement)

The previous vendor pilot failed because 30–40 second processing lost to a human eyeball. Choices made for latency:

- **One API call per label.** No multi-step agent loops, no separate OCR pass.
- **Small response budget** (1,000 max tokens of structured JSON), which keeps generation time low. Typical end-to-end time is a few seconds.
- **Elapsed time is printed on every result** ("Checked in 3.2 seconds"), so the speed requirement is continuously self-auditing rather than a claim in a slide deck.
- **Batch concurrency of 3** so a 200-label dump from a big importer doesn't run serially, while staying friendly to API rate limits. The cap is a one-line constant to tune.

## Usability (the "73-year-old benchmark")

- Three numbered steps in fixed order: enter details → add images → one big check button. No menus, no settings, no modes.
- Large type throughout (18px body, oversized buttons), high-contrast verdict colors paired with icons and words (✓ Match / ? Needs review / ✕ Mismatch) so meaning never relies on color alone.
- Drag-and-drop *and* a big "Choose images" button — whichever the agent reaches for first works.
- Pre-filled with the brief's sample application so the first run requires zero typing.
- Errors are specific and recoverable: a failed label gets a "Try again" button; an unreadable photo says so and suggests requesting a better image (the existing manual workflow), instead of fabricating a guess.

## Tools used

- **React 18 + Vite + Tailwind CSS 4** — fast to build, trivially deployable as static assets, no framework lock-in for a proof of concept.
- **Anthropic Claude (claude-sonnet-4) vision API** — handles real-world photos (angles, glare, curved bottles) far better than classical OCR, which directly addresses the junior agent's wish for tolerance of imperfect images. Sonnet over a larger model for latency.
- **Vercel serverless function** as a thin API proxy — the only server-side code, ~80 lines, existing solely to keep the API key out of the browser and to validate/limit inbound payloads.

## Assumptions

- **Standalone prototype, no COLA integration** — stated explicitly by IT. Application data is hand-entered. (A CSV upload mapping rows to images would be the natural next step for true batch workflows.)
- **No persistence** — IT: "we're not storing anything sensitive for this exercise." Images live in browser memory; the server processes and forgets. This sidesteps PII/retention questions appropriately for a prototype while flagging them for production.
- **Distilled-spirits field set** from the brief's sample (brand, class/type, alcohol content, net contents, warning). Beverage-type-specific rules (e.g., ABV optionality for some beer/wine) are out of scope but slot into `compliance.js` cleanly.
- **English-language labels**, single image per application.
- **The agents' fuzzy-match tolerance** (case-insensitive = same brand) is encoded as described; thresholds are easy to adjust once real agents react to real flags.

## Known trade-offs and what production would change

- **Outbound API dependency vs. the firewall reality.** IT noted the agency network blocks many outbound domains and that a previous vendor's cloud ML endpoints were blocked. For a prototype, a single allowlistable HTTPS endpoint (`api.anthropic.com`) through one proxy function is the pragmatic choice. For production on the agency's Azure tenancy, the same extraction call can be served through a FedRAMP-authorized managed model endpoint (Claude is available via AWS Bedrock / GCP Vertex government paths, and Azure-hosted alternatives exist) — the proxy function is the only file that would change.
- **Bold/type-size detection is advisory.** Visual formatting judgments (bold, minimum type size, contrast) are reported by the model and surfaced as "Needs review," never as automatic passes — a deliberate floor on what the AI is allowed to decide.
- **No authentication** on the prototype. A production deployment inside the agency would sit behind existing SSO; the prototype relies on an unguessable deployment URL, acceptable because it stores nothing.
- **Concurrency vs. rate limits.** Three parallel requests is conservative; a production batch path would use the Anthropic Batch API for big importer dumps, trading a few minutes of turnaround on 300 labels for much higher throughput — likely the right trade for that workflow, while keeping the interactive path for single labels.
