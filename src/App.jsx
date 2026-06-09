import { useState, useRef, useCallback } from "react";
import { buildReport } from "./compliance.js";

// UI design notes (traceable to stakeholder interviews):
//  - Speed: one vision call per label; elapsed time shown on every result
//    (Sarah: "if we can't get results in ~5s nobody uses it")
//  - Simplicity: 3 numbered steps, large type, one primary action
//    (Sarah: "something my mother could figure out")
//  - Batch: multi-file upload, parallel processing with a concurrency cap
//    (Janet/Seattle: 200-300 applications dumped at once)
//  - The agent always makes the final call (Dave: "you need judgment")

const API_BASE = import.meta.env.VITE_API_BASE || "";

async function analyzeLabel(file, app) {
  const t0 = performance.now();
  const base64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("Could not read the image file."));
    r.readAsDataURL(file);
  });

  const response = await fetch(`${API_BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: base64, media_type: file.type || "image/png" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Server error (HTTP ${response.status}).`);

  const elapsed = (performance.now() - t0) / 1000;
  return buildReport(payload.extracted, app, elapsed);
}

const VERDICT_STYLE = {
  match: { bg: "bg-green-100", text: "text-green-800", icon: "✓", label: "Match" },
  review: { bg: "bg-amber-100", text: "text-amber-800", icon: "?", label: "Needs review" },
  mismatch: { bg: "bg-red-100", text: "text-red-800", icon: "✕", label: "Mismatch" },
};
const OVERALL_STYLE = {
  pass: { bg: "bg-green-600", label: "All checks passed" },
  review: { bg: "bg-amber-500", label: "Needs agent review" },
  fail: { bg: "bg-red-600", label: "Issues found" },
};

function Field({ label, value, onChange, placeholder, hint }) {
  return (
    <label className="block">
      <span className="block text-lg font-semibold text-gray-800 mb-1">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full text-lg border-2 border-gray-300 rounded-lg px-4 py-3 focus:border-blue-600 focus:outline-none"
      />
      {hint && <span className="block text-sm text-gray-500 mt-1">{hint}</span>}
    </label>
  );
}

function VerdictPill({ verdict }) {
  const s = VERDICT_STYLE[verdict];
  return (
    <span className={`inline-flex items-center gap-1 ${s.bg} ${s.text} font-bold text-base px-3 py-1 rounded-full whitespace-nowrap`}>
      <span aria-hidden="true">{s.icon}</span> {s.label}
    </span>
  );
}

function ResultCard({ result, onRetry }) {
  const [open, setOpen] = useState(true);
  if (result.status === "queued" || result.status === "processing") {
    return (
      <div className="border-2 border-gray-200 rounded-xl p-5 flex items-center gap-4 bg-white">
        <img src={result.preview} alt="" className="w-16 h-16 object-cover rounded-lg border" />
        <div className="flex-1">
          <p className="text-lg font-semibold text-gray-800">{result.name}</p>
          <p className="text-base text-gray-500">
            {result.status === "processing" ? "Checking label…" : "Waiting in queue…"}
          </p>
        </div>
        {result.status === "processing" && (
          <div className="w-7 h-7 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" aria-label="Processing" />
        )}
      </div>
    );
  }
  if (result.status === "error") {
    return (
      <div className="border-2 border-red-200 bg-red-50 rounded-xl p-5">
        <div className="flex items-center gap-4">
          <img src={result.preview} alt="" className="w-16 h-16 object-cover rounded-lg border" />
          <div className="flex-1">
            <p className="text-lg font-semibold text-gray-800">{result.name}</p>
            <p className="text-base text-red-700">{result.error}</p>
          </div>
          <button onClick={onRetry} className="bg-white border-2 border-red-300 text-red-700 font-bold text-base px-4 py-2 rounded-lg hover:bg-red-100">
            Try again
          </button>
        </div>
      </div>
    );
  }

  const r = result.data;
  if (r.unreadable) {
    return (
      <div className="border-2 border-amber-300 bg-amber-50 rounded-xl p-5">
        <div className="flex items-center gap-4">
          <img src={result.preview} alt="" className="w-16 h-16 object-cover rounded-lg border" />
          <div className="flex-1">
            <p className="text-lg font-semibold text-gray-800">{result.name}</p>
            <p className="text-base text-amber-800 font-semibold">Could not read this label</p>
            <p className="text-base text-gray-700">{r.imageQualityNote}</p>
          </div>
        </div>
      </div>
    );
  }

  const o = OVERALL_STYLE[r.overall];
  return (
    <div className="border-2 border-gray-200 rounded-xl overflow-hidden bg-white">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-4 p-5 text-left hover:bg-gray-50"
        aria-expanded={open}
      >
        <img src={result.preview} alt="" className="w-16 h-16 object-cover rounded-lg border" />
        <div className="flex-1 min-w-0">
          <p className="text-lg font-semibold text-gray-900 truncate">{result.name}</p>
          <p className="text-base text-gray-500">Checked in {r.elapsed.toFixed(1)} seconds</p>
        </div>
        <span className={`${o.bg} text-white font-bold text-base px-4 py-2 rounded-lg whitespace-nowrap`}>{o.label}</span>
        <span className="text-2xl text-gray-400" aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="border-t-2 border-gray-100 p-5 space-y-3">
          {r.imageQualityNote && (
            <p className="text-base text-amber-800 bg-amber-50 rounded-lg px-4 py-2">
              Image note: {r.imageQualityNote}
            </p>
          )}
          {r.checks.map((c) => (
            <div key={c.field} className="flex flex-wrap items-start gap-3 py-2 border-b border-gray-100 last:border-0">
              <div className="w-44 shrink-0 text-lg font-semibold text-gray-800 pt-0.5">{c.field}</div>
              <div className="flex-1 min-w-[200px] text-base text-gray-700">
                <p><span className="text-gray-500">Application:</span> {c.app || "—"}</p>
                <p><span className="text-gray-500">On label:</span> {c.label || "Not found"}</p>
                {c.note && <p className="text-gray-600 italic mt-1">{c.note}</p>}
              </div>
              <VerdictPill verdict={c.verdict} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [app, setApp] = useState({
    brand: "OLD TOM DISTILLERY",
    classType: "Kentucky Straight Bourbon Whiskey",
    abv: "45% Alc./Vol. (90 Proof)",
    netContents: "750 mL",
  });
  const [files, setFiles] = useState([]);
  const [running, setRunning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);
  const idRef = useRef(0);

  const addFiles = useCallback((list) => {
    const accepted = [];
    for (const f of list) {
      if (!f.type.startsWith("image/")) continue;
      if (f.size > 20 * 1024 * 1024) continue;
      accepted.push({
        id: ++idRef.current,
        file: f,
        name: f.name,
        preview: URL.createObjectURL(f),
        status: "ready",
      });
    }
    setFiles((prev) => [...prev, ...accepted]);
  }, []);

  const removeFile = (id) => setFiles((prev) => prev.filter((f) => f.id !== id));

  const runOne = async (item, appSnapshot) => {
    setFiles((prev) => prev.map((f) => (f.id === item.id ? { ...f, status: "processing" } : f)));
    try {
      const data = await analyzeLabel(item.file, appSnapshot);
      setFiles((prev) => prev.map((f) => (f.id === item.id ? { ...f, status: "done", data } : f)));
    } catch (e) {
      setFiles((prev) =>
        prev.map((f) => (f.id === item.id ? { ...f, status: "error", error: e.message || "Something went wrong." } : f))
      );
    }
  };

  const runAll = async () => {
    const queue = files.filter((f) => f.status === "ready" || f.status === "error");
    if (!queue.length) return;
    setRunning(true);
    const appSnapshot = { ...app };
    setFiles((prev) => prev.map((f) => (queue.some((q) => q.id === f.id) ? { ...f, status: "queued" } : f)));
    const CONCURRENCY = 3;
    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        const item = queue[next++];
        await runOne(item, appSnapshot);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    setRunning(false);
  };

  const done = files.filter((f) => f.status === "done");
  const tally = {
    pass: done.filter((f) => f.data.overall === "pass").length,
    review: done.filter((f) => f.data.overall === "review" || f.data.unreadable).length,
    fail: done.filter((f) => f.data.overall === "fail").length,
  };
  const pending = files.filter((f) => f.status === "ready" || f.status === "error").length;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="bg-blue-900 text-white px-6 py-5">
        <h1 className="text-2xl font-bold">Label Verification Assistant</h1>
        <p className="text-blue-200 text-base mt-1">
          Compare label artwork against the application — results in seconds. The agent always makes the final call.
        </p>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-10">
        <section aria-labelledby="step1">
          <h2 id="step1" className="text-xl font-bold mb-4 flex items-center gap-3">
            <span className="bg-blue-900 text-white w-9 h-9 rounded-full flex items-center justify-center text-lg" aria-hidden="true">1</span>
            Enter the application details
          </h2>
          <div className="grid gap-5 sm:grid-cols-2 bg-white border-2 border-gray-200 rounded-xl p-6">
            <Field label="Brand name" value={app.brand} onChange={(v) => setApp({ ...app, brand: v })} placeholder="e.g. OLD TOM DISTILLERY" />
            <Field label="Class / type" value={app.classType} onChange={(v) => setApp({ ...app, classType: v })} placeholder="e.g. Kentucky Straight Bourbon Whiskey" />
            <Field label="Alcohol content" value={app.abv} onChange={(v) => setApp({ ...app, abv: v })} placeholder="e.g. 45% Alc./Vol." hint="A number like 45 or 45% works too." />
            <Field label="Net contents" value={app.netContents} onChange={(v) => setApp({ ...app, netContents: v })} placeholder="e.g. 750 mL" />
          </div>
          <p className="text-base text-gray-600 mt-2">
            The government warning statement is always checked automatically against the required wording — nothing to enter.
          </p>
        </section>

        <section aria-labelledby="step2">
          <h2 id="step2" className="text-xl font-bold mb-4 flex items-center gap-3">
            <span className="bg-blue-900 text-white w-9 h-9 rounded-full flex items-center justify-center text-lg" aria-hidden="true">2</span>
            Add the label image — or several at once
          </h2>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
            className={`border-4 border-dashed rounded-xl p-10 text-center transition-colors ${dragOver ? "border-blue-600 bg-blue-50" : "border-gray-300 bg-white"}`}
          >
            <p className="text-xl font-semibold text-gray-800 mb-2">Drag label images here</p>
            <p className="text-base text-gray-500 mb-4">or</p>
            <button
              onClick={() => inputRef.current?.click()}
              className="bg-blue-900 text-white text-lg font-bold px-8 py-4 rounded-xl hover:bg-blue-800"
            >
              Choose images from your computer
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
            />
            <p className="text-base text-gray-500 mt-4">JPG or PNG. Select as many as you need — batches are welcome.</p>
          </div>

          {files.some((f) => f.status === "ready") && (
            <div className="flex flex-wrap gap-3 mt-4">
              {files.filter((f) => f.status === "ready").map((f) => (
                <div key={f.id} className="relative">
                  <img src={f.preview} alt={f.name} className="w-24 h-24 object-cover rounded-lg border-2 border-gray-200" />
                  <button
                    onClick={() => removeFile(f.id)}
                    aria-label={`Remove ${f.name}`}
                    className="absolute -top-2 -right-2 bg-gray-700 text-white w-7 h-7 rounded-full text-base font-bold hover:bg-red-600"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="step3">
          <h2 id="step3" className="text-xl font-bold mb-4 flex items-center gap-3">
            <span className="bg-blue-900 text-white w-9 h-9 rounded-full flex items-center justify-center text-lg" aria-hidden="true">3</span>
            Check the labels
          </h2>
          <button
            onClick={runAll}
            disabled={running || pending === 0}
            className={`w-full text-xl font-bold py-5 rounded-xl ${running || pending === 0 ? "bg-gray-300 text-gray-500 cursor-not-allowed" : "bg-green-700 text-white hover:bg-green-600"}`}
          >
            {running
              ? "Checking labels…"
              : pending === 0
              ? "Add a label image above to begin"
              : pending === 1
              ? "Check this label"
              : `Check all ${pending} labels`}
          </button>
        </section>

        {(done.length > 0 || files.some((f) => f.status !== "ready")) && (
          <section aria-labelledby="results">
            <h2 id="results" className="text-xl font-bold mb-4">Results</h2>
            {done.length > 1 && (
              <div className="flex gap-4 mb-4 text-lg font-semibold">
                <span className="text-green-700">{tally.pass} passed</span>
                <span className="text-amber-700">{tally.review} need review</span>
                <span className="text-red-700">{tally.fail} with issues</span>
              </div>
            )}
            <div className="space-y-4">
              {files
                .filter((f) => f.status !== "ready")
                .map((f) => (
                  <ResultCard key={f.id} result={f} onRetry={() => runOne(f, { ...app })} />
                ))}
            </div>
          </section>
        )}

        <footer className="text-base text-gray-500 border-t-2 border-gray-200 pt-6 pb-10">
          <p className="font-semibold text-gray-600 mb-1">Prototype notes</p>
          <p>
            This tool assists with routine matching — it does not approve or reject applications. Anything flagged
            "Needs review" or "Mismatch" should be examined by an agent, and a clean pass is still subject to the
            agent's judgment. No images or application data are stored.
          </p>
        </footer>
      </main>
    </div>
  );
}
