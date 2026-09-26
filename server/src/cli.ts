/**
 * Run the pipeline from the terminal, for tuning thresholds against the demo
 * inputs without the UI in the way.
 *
 *   npx tsx server/src/cli.ts path/to/draft.txt [--mode writing] [--verbose]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { fetchPage } from "./fetch/browserbase.js";
import { runUnslop } from "./pipeline.js";
import { THRESHOLDS } from "./config.js";
import type { Judgment, Mode, UnslopEvent } from "./types.js";

config({ path: path.resolve(process.cwd(), ".env") });

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const modeIndex = args.indexOf("--mode");
const mode = (modeIndex >= 0 ? args[modeIndex + 1] : "auto") as "auto" | Mode;
const target = args.find((a) => !a.startsWith("--") && a !== mode);

if (!target) {
  console.error(
    "usage: tsx server/src/cli.ts <file-or-url> [--mode auto|web|writing|list] [--verbose]",
  );
  process.exit(1);
}

const input = /^https?:\/\//i.test(target)
  ? target
  : await readFile(target, "utf8");
const judgments: Judgment[] = [];
const texts = new Map<string, string>();

await runUnslop(
  { input, mode, demo: true },
  {
    fetchPage,
    emit: (e: UnslopEvent) => {
      if (e.event === "units")
        for (const u of e.data.units) texts.set(u.id, u.text);
      if (e.event === "judgment") judgments.push(e.data);
      if (e.event === "error") console.error("error:", e.data.message);
      if (e.event === "mode")
        console.log(`mode: ${e.data.mode} (${pct(e.data.confidence)})`);
      if (e.event === "edit") {
        const label = e.data.unitIds
          .map((id) => short(texts.get(id) ?? id))
          .join(" | ");
        console.log(
          `  ${e.data.kind.padEnd(9)} ${e.data.reason}\n             ${label}`,
        );
      }
      if (e.event === "done") {
        const s = e.data.stats;
        console.log("\n--- output ---\n");
        console.log(e.data.output);
        console.log("\n--- report ---");
        console.log(
          `genre ${e.data.report.genre}, padding ${e.data.report.paddingLabel}`,
        );
        console.log(`filler: ${JSON.stringify(e.data.report.fillerCounts)}`);
        if (e.data.report.swaps.length)
          console.log(`swaps: ${JSON.stringify(e.data.report.swaps)}`);
        if (e.data.report.revertedParagraphs.length)
          console.log(
            `reverted: ${e.data.report.revertedParagraphs.join(", ")}`,
          );
        console.log(
          `\n${s.wordsIn} -> ${s.wordsOut} words (${Math.round((1 - s.wordsOut / s.wordsIn) * 100)}% cut) · ` +
            `${s.judgments} judgments · ${s.requests} requests · ${s.totalMs}ms · ` +
            `${s.inputTokens} tokens · $${s.costUsd.toFixed(5)}`,
        );
      }
    },
  },
);

if (verbose) {
  console.log("\n--- judgments ---");
  for (const j of judgments) {
    const conf = j.confidence === undefined ? "" : ` (${pct(j.confidence)})`;
    const low =
      (j.confidence ?? 1) < THRESHOLDS.lowConfidence ? " <- unsure" : "";
    const answer =
      typeof j.answer === "number" ? j.answer.toFixed(2) : j.answer;
    console.log(
      `${String(j.stage).padEnd(4)} ${(j.unitId ?? "-").padEnd(5)} ${j.question.padEnd(16)} ${answer}${conf}${low}`,
    );
  }
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}
function short(t: string) {
  return t.length > 70 ? `${t.slice(0, 67)}...` : t;
}
