import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { demoDir } from "./paths.js";
import type { Mode } from "./types.js";

export type Demo = { id: string; label: string; mode: Mode; input: string };

/**
 * The three prepared demo inputs, one per mode. The UI's demo buttons load
 * these so a slow network never sets the pace on stage.
 */
export async function loadDemos(): Promise<Demo[]> {
  try {
    const files = (await readdir(demoDir))
      .filter((f) => f.endsWith(".json"))
      .sort();
    const demos = await Promise.all(
      files.map(
        async (f) =>
          JSON.parse(await readFile(join(demoDir, f), "utf8")) as Demo,
      ),
    );
    return demos;
  } catch {
    return [];
  }
}
