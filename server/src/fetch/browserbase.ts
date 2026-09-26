import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Block, Source, Unit } from "../types.js";
import { pageCacheDir, shotCacheDir } from "../paths.js";
import { extractArticle } from "./extract.js";

type Fetched = { html: string; screenshot?: Buffer; live: boolean };

const keyFor = (url: string) =>
  createHash("sha1").update(url).digest("hex").slice(0, 16);

/**
 * Loads a page through Browserbase, takes a screenshot and returns the HTML.
 *
 * Every successful fetch is cached. When the demo button runs, a live call is
 * attempted first and the cache only steps in if it fails — so a replay is
 * always a fallback, never a pretence.
 */
export async function fetchPage(
  url: string,
  demo: boolean,
): Promise<{ source: Source; blocks: Block[]; units: Unit[] }> {
  const normalized = url.startsWith("http") ? url : `https://${url}`;
  let fetched: Fetched | undefined;
  let liveError: unknown;

  try {
    fetched = await loadLive(normalized);
  } catch (err) {
    liveError = err;
    if (!demo) throw err;
  }

  if (!fetched) {
    const cached = await loadCached(normalized);
    if (!cached) throw liveError ?? new Error(`Could not load ${normalized}`);
    fetched = cached;
  } else {
    await save(normalized, fetched).catch(() => {});
  }

  const { title, blocks, units } = extractArticle(fetched.html, normalized);
  const source: Source = { title, url: normalized };
  const shot = await shotUrl(normalized);
  if (shot) source.screenshotUrl = shot;
  return { source, blocks, units };
}

async function loadLive(url: string): Promise<Fetched> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;

  if (!apiKey || !projectId) {
    // No Browserbase credentials: plain fetch, no screenshot. Web mode still
    // works, it just has nothing to show in the left column.
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Unslop/0.1",
      },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    return { html: await res.text(), live: true };
  }

  const [{ default: Browserbase }, { chromium }] = await Promise.all([
    import("@browserbasehq/sdk"),
    import("playwright-core"),
  ]);
  const bb = new Browserbase({ apiKey });
  const session = await bb.sessions.create({ projectId });
  const browser = await chromium.connectOverCDP(session.connectUrl);
  try {
    const context = browser.contexts()[0]!;
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const html = await page.content();
    const screenshot = await page.screenshot({ fullPage: false });
    return { html, screenshot, live: true };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function save(url: string, fetched: Fetched): Promise<void> {
  const key = keyFor(url);
  await mkdir(pageCacheDir, { recursive: true });
  await writeFile(
    join(pageCacheDir, `${key}.json`),
    JSON.stringify({ url, html: fetched.html }),
  );
  if (fetched.screenshot) {
    await mkdir(shotCacheDir, { recursive: true });
    await writeFile(join(shotCacheDir, `${key}.png`), fetched.screenshot);
  }
}

async function loadCached(url: string): Promise<Fetched | undefined> {
  try {
    const raw = await readFile(
      join(pageCacheDir, `${keyFor(url)}.json`),
      "utf8",
    );
    return { html: JSON.parse(raw).html as string, live: false };
  } catch {
    return undefined;
  }
}

async function shotUrl(url: string): Promise<string | undefined> {
  const key = keyFor(url);
  try {
    await readFile(join(shotCacheDir, `${key}.png`));
    return `/shots/${key}.png`;
  } catch {
    return undefined;
  }
}
