// Deterministic comparison rules. The AI only extracts text from the image;
// every pass/fail decision is made here, in plain auditable code.

export const STATUTORY_WARNING =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.";

// Normalize whitespace only — case and punctuation must survive, because the
// regulation requires the exact wording and an all-caps "GOVERNMENT WARNING:".
export const squashSpaces = (s) => (s || "").replace(/\s+/g, " ").trim();

// Smart quotes/dashes are common OCR-level variations that are not substantive.
export const normalizePunct = (s) =>
  squashSpaces(s)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-");

// Government warning: strict character-level check (27 CFR Part 16).
export function checkWarningText(extractedWarning) {
  if (!extractedWarning || !squashSpaces(extractedWarning)) {
    return {
      verdict: "mismatch",
      note: "No government warning statement found on the label. The warning is mandatory on all alcohol beverages.",
    };
  }
  const got = normalizePunct(extractedWarning);
  const want = normalizePunct(STATUTORY_WARNING);
  if (got === want) {
    return {
      verdict: "match",
      note: "Exact match to the statutory warning text, including the all-caps GOVERNMENT WARNING: prefix.",
    };
  }
  if (got.toLowerCase() === want.toLowerCase()) {
    const prefixOk = got.startsWith("GOVERNMENT WARNING:");
    if (!prefixOk) {
      return {
        verdict: "mismatch",
        note: 'Wording matches but "GOVERNMENT WARNING:" must appear in all capital letters. (This exact issue is a common rejection.)',
      };
    }
    return {
      verdict: "review",
      note: "Wording and the all-caps GOVERNMENT WARNING: prefix are correct, but the body's capitalization differs from the statutory rendering (e.g., printed entirely in capitals). Agent should confirm acceptability.",
    };
  }
  // Find first difference to help the agent locate it quickly.
  let i = 0;
  while (i < Math.min(got.length, want.length) && got[i] === want[i]) i++;
  const context = want.slice(Math.max(0, i - 20), i + 25);
  return {
    verdict: "mismatch",
    note: `Warning text deviates from the required statutory wording. First difference near: “…${context}…”`,
  };
}

// Brand/type comparison. Case-only difference is a match with a note —
// STONE'S THROW vs Stone's Throw is the same brand and should not be a
// false rejection (per senior-agent feedback).
export function compareField(appValue, labelValue) {
  const a = normalizePunct(appValue || "");
  const b = normalizePunct(labelValue || "");
  if (!b) return { verdict: "mismatch", note: "Not found on the label." };
  if (!a) return { verdict: "review", note: "No application value entered to compare against." };
  if (a === b) return { verdict: "match", note: "" };
  if (a.toLowerCase() === b.toLowerCase())
    return { verdict: "match", note: "Case differs (treated as a match — same name)." };
  const al = a.toLowerCase(),
    bl = b.toLowerCase();
  if (al.includes(bl) || bl.includes(al))
    return { verdict: "review", note: "Partial match — likely the same, please confirm." };
  return { verdict: "mismatch", note: "Values do not match." };
}

// ABV: compare the number, so "45% Alc./Vol. (90 Proof)" matches "45".
export function compareAbv(appValue, labelValue) {
  const num = (s) => {
    const m = (s || "").match(/(\d+(?:\.\d+)?)\s*%/) || (s || "").match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  };
  const a = num(appValue),
    b = num(labelValue);
  if (b === null) return { verdict: "mismatch", note: "Alcohol content not found on the label." };
  if (a === null) return { verdict: "review", note: "Could not read a number from the application value." };
  if (a === b) return { verdict: "match", note: "" };
  return { verdict: "mismatch", note: `Application says ${a}% but the label shows ${b}%.` };
}

export function compareNetContents(appValue, labelValue) {
  const norm = (s) =>
    (s || "")
      .toLowerCase()
      .replace(/millilit(er|re)s?/g, "ml")
      .replace(/lit(er|re)s?/g, "l")
      .replace(/[\s.]/g, "");
  if (!labelValue) return { verdict: "mismatch", note: "Net contents not found on the label." };
  if (!appValue) return { verdict: "review", note: "No application value entered to compare against." };
  if (norm(appValue) === norm(labelValue)) return { verdict: "match", note: "" };
  return { verdict: "mismatch", note: "Net contents do not match." };
}

// Combine extraction output + application data into the full check report.
export function buildReport(extracted, app, elapsed) {
  if (extracted.readable === false) {
    return {
      elapsed,
      unreadable: true,
      imageQualityNote:
        extracted.image_quality_note ||
        "The label could not be read from this image. Request a clearer photo from the applicant.",
      checks: [],
      overall: "review",
    };
  }

  const checks = [
    { field: "Brand name", app: app.brand, label: extracted.brand_name, ...compareField(app.brand, extracted.brand_name) },
    { field: "Class / type", app: app.classType, label: extracted.class_type, ...compareField(app.classType, extracted.class_type) },
    { field: "Alcohol content", app: app.abv, label: extracted.alcohol_content, ...compareAbv(app.abv, extracted.alcohol_content) },
    { field: "Net contents", app: app.netContents, label: extracted.net_contents, ...compareNetContents(app.netContents, extracted.net_contents) },
  ];

  // Warning: deterministic text check + AI formatting observations.
  const warn = checkWarningText(extracted.government_warning);
  if (warn.verdict === "match") {
    if (extracted.warning_prefix_all_caps === false) {
      warn.verdict = "mismatch";
      warn.note = '"GOVERNMENT WARNING:" does not appear in all capital letters on the label.';
    } else if (extracted.warning_appears_bold === false) {
      warn.verdict = "review";
      warn.note = 'Text is exact, but the "GOVERNMENT WARNING:" prefix may not be bold. Please verify visually.';
    } else if (extracted.warning_legibility === "small_or_hard_to_read") {
      warn.verdict = "review";
      warn.note = "Text is exact, but it appears small or hard to read. Verify it meets minimum type-size requirements.";
    }
  }
  const warnText = squashSpaces(extracted.government_warning || "");
  checks.push({
    field: "Government warning",
    app: "Statutory text (27 CFR Part 16)",
    label: warnText ? warnText.slice(0, 120) + (warnText.length > 120 ? "…" : "") : null,
    verdict: warn.verdict,
    note: warn.note,
  });

  const overall = checks.some((c) => c.verdict === "mismatch")
    ? "fail"
    : checks.some((c) => c.verdict === "review")
    ? "review"
    : "pass";

  return { elapsed, checks, overall, imageQualityNote: extracted.image_quality_note };
}
