import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Mode } from "./types.js";

const DEMO_DIR = path.resolve(process.cwd(), "data/demo");

export type Demo = { id: string; label: string; mode: Mode; input: string };

/**
 * The three prepared demo inputs, one per mode. The UI's demo buttons load
 * these so a slow network never sets the pace on stage.
 */
export async function loadDemos(): Promise<Demo[]> {
  try {
    const files = (await readdir(DEMO_DIR))
      .filter((f) => f.endsWith(".json"))
      .sort();
    const demos = await Promise.all(
      files.map(
        async (f) =>
          JSON.parse(await readFile(path.join(DEMO_DIR, f), "utf8")) as Demo,
      ),
    );
    return demos;
  } catch {
    return [];
  }
}
