import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Demo, Mode } from "./api.js";
import { loadDemos, unslop } from "./api.js";
import { Counters } from "./components/Counters.js";
import { OriginalColumn, ResultColumn } from "./components/Columns.js";
import { DecisionPanel } from "./components/DecisionPanel.js";
import { ReportTab } from "./components/ReportTab.js";
import {
  buildViews,
  currentOutput,
  emptyRun,
  proseWordsIn,
  wordCount,
  type RunState,
} from "./model.js";

const MODES: Array<Mode | "auto"> = ["auto", "web", "writing", "list"];
const MODE_LABEL: Record<string, string> = {
  auto: "auto",
  web: "web",
  writing: "writing",
  list: "list",
};

export function App() {
  const [input, setInput] = useState("");
  const [override, setOverride] = useState<Mode | "auto">("auto");
  const [run, setRun] = useState<RunState>(emptyRun);
  const [tab, setTab] = useState<"result" | "report">("result");
  // Struck-through cuts are the default view: they are what makes a cut
  // restorable, and what the audience watches fade. The toggle hides them.
  const [showCuts, setShowCuts] = useState(true);
  const [hovered, setHovered] = useState<string | null>(null);
  const [demos, setDemos] = useState<Demo[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    void loadDemos().then(setDemos);
  }, []);

  const start = useCallback(async (text: string, mode: Mode | "auto", demo: boolean) => {
    if (!text.trim()) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setTab("result");
    setStartedAt(Date.now());
    setRun({ ...emptyRun, status: "running", restored: new Set() });

    await unslop(
      { input: text, mode, demo },
      {
        onMode: (m, confidence) => setRun((r) => ({ ...r, mode: m, modeConfidence: confidence })),
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
  }, []);

  const views = useMemo(() => buildViews(run), [run]);
  const output = useMemo(() => currentOutput(run, views), [run, views]);
  const live = useMemo(
    () => ({
      proseWordsIn: proseWordsIn(run),
      proseWordsOut: run.status === "idle" ? 0 : wordCount(output) - protectedWordsOf(run),
      judgments: run.judgments.length,
    }),
    [run, output],
  );
  const hover = { hovered, onHover: setHovered };
  const running = run.status === "running";

  const restore = (unitId: string) =>
    setRun((r) => ({ ...r, restored: new Set(r.restored).add(unitId) }));

  // Overriding the mode re-runs straight away when there is something to run
  // on; a chip that only changed a setting would look broken on stage.
  const chooseMode = (m: Mode | "auto") => {
    setOverride(m);
    if (input.trim() && !running) void start(input, m, false);
  };

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
            void start(input, override, false);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste a URL, a draft, or a list  (⌘↩ to run)"
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void start(input, override, false);
              }
            }}
          />
          <button type="submit" disabled={running || !input.trim()}>
            {running ? "Unslopping…" : "Unslop"}
          </button>
        </form>
        <div className="controls">
          <div className="modes" role="group" aria-label="Mode">
            {MODES.map((m) => {
              const active = override === "auto" ? m === "auto" : m === override;
              const detected = override === "auto" && m !== "auto" && run.mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  className={`chip ${active ? "chip-on" : ""} ${detected ? "chip-detected" : ""}`}
                  onClick={() => chooseMode(m)}
                  title={m === "auto" ? "Let Jev decide" : `Force ${MODE_LABEL[m]} mode`}
                >
                  {MODE_LABEL[m]}
                  {detected ? ` ${Math.round(run.modeConfidence * 100)}%` : ""}
                </button>
              );
            })}
          </div>
          <div className="demos" role="group" aria-label="Demo inputs">
            {demos.map((demo) => (
              <button
                key={demo.id}
                type="button"
                className="chip chip-demo"
                disabled={running}
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
            <span className="col-title">
              Original
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
              <button className={tab === "result" ? "tab tab-on" : "tab"} onClick={() => setTab("result")}>
                Result
              </button>
              <button className={tab === "report" ? "tab tab-on" : "tab"} onClick={() => setTab("report")}>
                Report
              </button>
            </div>
            {tab === "result" && run.mode !== "list" && run.status !== "idle" ? (
              <label className="diff-toggle">
                <input type="checkbox" checked={!showCuts} onChange={(e) => setShowCuts(!e.target.checked)} />
                clean view
              </label>
            ) : null}
          </div>
          {tab === "result" ? (
            <ResultColumn run={run} views={views} hover={hover} showCuts={showCuts} onRestore={restore} />
          ) : (
            <ReportTab run={run} />
          )}
        </section>

        <section className="col col-panel">
          <DecisionPanel judgments={run.judgments} onHover={setHovered} hovered={hovered} />
        </section>
      </main>

      <footer>
        <Counters stats={run.done?.stats ?? null} live={live} running={running} startedAt={startedAt} />
      </footer>
    </div>
  );
}

function protectedWordsOf(run: RunState): number {
  if (run.done) return run.done.stats.protectedWords;
  return run.units.filter((u) => u.kind === "protected").reduce((n, u) => n + wordCount(u.text), 0);
}
