import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Paths resolved from this file rather than `process.cwd()`, so the server
 * finds `.env`, the demo inputs and the cache whether it is started from the
 * repo root, from `server/`, or through `npm -w server`.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

/** `server/src` in dev and `server/dist` once built — both two levels down. */
export const repoRoot = path.resolve(here, "../..");
export const envFile = path.join(repoRoot, ".env");
export const dataDir = path.join(repoRoot, "data");
export const demoDir = path.join(dataDir, "demo");
export const pageCacheDir = path.join(dataDir, "cache/pages");
export const shotCacheDir = path.join(dataDir, "cache/shots");
