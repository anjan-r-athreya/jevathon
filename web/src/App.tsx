import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Demo, Mode } from "./api.js";
import { loadDemos, unslop } from "./api.js";
import { Counters } from "./components/Counters.js";
import { OriginalColumn, ResultColumn } from "./components/Columns.js";
import { DecisionPanel } from "./components/DecisionPanel.js";
import { ReportTab } from "./components/ReportTab.js";
import { buildViews, currentOutput, emptyRun, wordCount, type RunState } from "./model.js";

const MODES: Array<Mode | "auto"> = ["auto", "web", "writing", "list"];
const MODE_LABEL: Record<string, string> = {
  auto: "auto",
  web: "web mode",
  writing: "writing mode",
  list: "list mode",
};

export function App() {
  const [input, setInput] = useState("");
  const [override, setOverride] = useState<Mode | "auto">("auto");
  const [run, setRun] = useState<RunState>(emptyRun);
  const [tab, setTab] = useState<"result" | "report">("result");
  const [showDiff, setShowDiff] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [demos, setDemos] = useState<Demo[]>([]);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    void loadDemos().then(setDemos);
  }, []);

  const start = useCallback(
    async (text: string, mode: Mode | "auto", demo: boolean) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setTab("result");
      setRun({ ...emptyRun, status: "running", restored: new Set() });

      await unslop(
        { input: text, mode, demo },
        {
          onMode: (m, confidence) =>
            setRun((r) => ({ ...r, mode: m, modeConfidence: confidence })),
          onSource: (source) => setRun((r) => ({ ...r, source })),
          onUnits: (units, blocks) => setRun((r) => ({ ...r, units, blocks })),
          onJudgment: (j) => setRun((r) => ({ ...r, judgments: [...r.judgments, j] })),
          onEdit: (e) => setRun((r) => ({ ...r, edits: [...r.edits, e] })),
          onDone: (done) => setRun((r) => ({ ...r, done, status: "done" })),
          onError: (message) => setRun((r) => ({ ...r, error: message, status: "error" })),
        },
        controller.signal,
      ).catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setRun((r) => ({ ...r, status: "error", error: String(err) }));
      });
    },
    [],
  );

  const views = useMemo(() => buildViews(run), [run]);
  const output = useMemo(() => currentOutput(run, views), [run, views]);
  const wordsOut = run.status === "idle" ? 0 : wordCount(output);
  const hover = { hovered, onHover: setHovered };

  const restore = (unitId: string) =>
    setRun((r) => ({ ...r, restored: new Set(r.restored).add(unitId) }));

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          Unslop
          <span className="tagline">the only de-slopper that can't add slop</span>
        </div>
        <form
          className="input-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) void start(input, override, false);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste a URL, a draft, or a list"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (input.trim()) void start(input, override, false);
              }
            }}
          />
          <button type="submit" disabled={run.status === "running" || !input.trim()}>
            {run.status === "running" ? "Unslopping…" : "Unslop"}
          </button>
        </form>
        <div className="controls">
          <div className="modes">
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                className={`chip ${modeIsActive(m, override, run.mode) ? "chip-on" : ""}`}
                onClick={() => setOverride(m)}
                title={m === "auto" ? "Let Jev decide" : `Force ${MODE_LABEL[m]}`}
              >
                {MODE_LABEL[m]}
                {m === "auto" && run.mode && override === "auto"
                  ? ` · ${run.mode} ${Math.round(run.modeConfidence * 100)}%`
                  : ""}
              </button>
            ))}
          </div>
          <div className="demos">
            {demos.map((demo) => (
              <button
                key={demo.id}
                type="button"
                className="chip chip-demo"
                onClick={() => {
                  setInput(demo.input);
                  setOverride("auto");
                  void start(demo.input, "auto", true);
                }}
              >
                {demo.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {run.error ? <div className="error">{run.error}</div> : null}

      <main className="columns">
        <section className="col">
          <div className="col-head">
            <span>
              Original
              {/* Never let a replay pass for a live fetch. */}
              {run.source && run.source.live !== undefined ? (
                <span className={`chip small ${run.source.live ? "" : "chip-replay"}`}>
                  {run.source.live ? "live" : "replay"}
                </span>
              ) : null}
            </span>
            {run.source?.url ? (
              <a className="muted" href={run.source.url} target="_blank" rel="noreferrer">
                {run.source.title || run.source.url}
              </a>
            ) : null}
          </div>
          <OriginalColumn run={run} views={views} hover={hover} />
        </section>

        <section className="col">
          <div className="col-head">
            <div className="tabs">
              <button
                className={tab === "result" ? "tab tab-on" : "tab"}
                onClick={() => setTab("result")}
              >
                Result
              </button>
              <button
                className={tab === "report" ? "tab tab-on" : "tab"}
                onClick={() => setTab("report")}
              >
                Report
              </button>
            </div>
            {tab === "result" && run.mode !== "list" ? (
              <label className="diff-toggle">
                <input
                  type="checkbox"
                  checked={showDiff}
                  onChange={(e) => setShowDiff(e.target.checked)}
                />
                show cuts
              </label>
            ) : null}
          </div>
          {tab === "result" ? (
            <ResultColumn
              run={run}
              views={views}
              hover={hover}
              showDiff={showDiff}
              onRestore={restore}
            />
          ) : (
            <ReportTab run={run} />
          )}
        </section>

        <section className="col col-panel">
          <DecisionPanel judgments={run.judgments} onHover={setHovered} hovered={hovered} />
        </section>
      </main>

      <footer>
        <Counters
          stats={run.done?.stats ?? null}
          wordsOut={wordsOut}
          running={run.status === "running"}
        />
      </footer>
    </div>
  );
}

function modeIsActive(m: Mode | "auto", override: Mode | "auto", detected: Mode | null): boolean {
  if (override !== "auto") return m === override;
  return m === "auto" || m === detected;
}
