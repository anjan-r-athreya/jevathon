import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Block, Source, Unit } from "../types.js";
import { pageCacheDir, shotCacheDir } from "../paths.js";
import { extractArticle } from "./extract.js";

type Fetched = { html: string; screenshot?: Buffer; live: boolean };

/** How long to let a bot check clear itself before giving up on the live page. */
const CHALLENGE_WAIT_MS = 15_000;

/**
 * Bot checks and consent walls answer with HTTP 200, so the status code says
 * nothing. These are the pages that must never be mistaken for an article, and
 * must never be written over a good cache entry.
 */
const BLOCKED_MARKERS = [
  "just a moment",
  "performing security verification",
  "checking your browser",
  "cf-browser-verification",
  "enable javascript and cookies to continue",
  "attention required! | cloudflare",
  "verifying you are human",
  "captcha-delivery.com",
];

function looksBlocked(html: string): boolean {
  // The markers all sit in the first screenful of a challenge page, and this
  // runs on every poll, so only the head is worth scanning.
  const head = html.slice(0, 4_000).toLowerCase();
  return BLOCKED_MARKERS.some((marker) => head.includes(marker));
}

const keyFor = (url: string) =>
  createHash("sha1").update(url).digest("hex").slice(0, 16);

/**
 * How long the demo button waits for a live page before replaying the cache.
 * A healthy Browserbase fetch of a heavy page takes about twelve seconds, so
 * this leaves room for one slow load without letting a bad network set the
 * pace on stage.
 */
const DEMO_BUDGET_MS = 18_000;

/**
 * Loads a page through Browserbase, takes a screenshot and returns the HTML.
 *
 * Every good fetch is cached. The demo button always tries live first and only
 * replays when the live call fails or runs past the budget — a replay is a
 * fallback, never a pretence, and `source.live` says which one you got.
 */
export async function fetchPage(
  url: string,
  demo: boolean,
): Promise<{ source: Source; blocks: Block[]; units: Unit[] }> {
  const normalized = url.startsWith("http") ? url : `https://${url}`;
  let fetched: Fetched | undefined;
  let liveError: unknown;

  const live = loadLive(normalized).then(
    async (result) => {
      await save(normalized, result).catch(() => {});
      return result;
    },
    (err: unknown) => {
      liveError = err;
      return undefined;
    },
  );

  if (demo) {
    // Whichever arrives first wins, as long as there is a cache to fall back on.
    fetched = await Promise.race([live, afterBudget(normalized)]);
    if (!fetched) fetched = await live;
  } else {
    fetched = await live;
  }

  if (!fetched) {
    fetched = await loadCached(normalized);
    if (!fetched) throw liveError ?? new Error(`Could not load ${normalized}`);
  }

  const { title, blocks, units } = extractArticle(fetched.html, normalized);
  const source: Source = { title, url: normalized, live: fetched.live };
  const shot = await shotUrl(normalized);
  if (shot) source.screenshotUrl = shot;
  return { source, blocks, units };
}

/**
 * Resolves to the cached page once the budget expires. The timer is unref'd so
 * that winning the race and leaving this pending never holds the process open.
 */
async function afterBudget(url: string): Promise<Fetched | undefined> {
  await new Promise((resolve) => {
    setTimeout(resolve, DEMO_BUDGET_MS).unref();
  });
  return loadCached(url);
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
    const html = await res.text();
    if (looksBlocked(html)) {
      throw new Error(
        `${url} is behind a bot check. Set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID to load it.`,
      );
    }
    return { html, live: true };
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

    // Bot checks answer 200 with an interstitial and swap in the real page a
    // few seconds later. Waiting for that is the difference between reading
    // the article and reading "Performing security verification".
    let html = await page.content();
    for (
      let waited = 0;
      waited < CHALLENGE_WAIT_MS && looksBlocked(html);
      waited += 1_000
    ) {
      await page.waitForTimeout(1_000);
      html = await page.content();
    }
    if (looksBlocked(html)) {
      throw new Error(`${url} is behind a bot check that did not clear.`);
    }

    // The screenshot is the nice half of web mode, not the necessary half, so
    // a failure here never costs us the run.
    //
    // Note the absence of `animations: "disabled"`: that option makes
    // Playwright wait for every CSS animation to finish, and a recipe blog has
    // animations that never do. With it, this timed out every single time.
    const screenshot = await page
      .screenshot({ fullPage: false, timeout: 10_000 })
      .catch(() => undefined);
    return screenshot ? { html, screenshot, live: true } : { html, live: true };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function save(url: string, fetched: Fetched): Promise<void> {
  // The cache is the demo's safety net. A challenge page written over a good
  // entry would quietly destroy it, so nothing suspect is ever saved.
  if (looksBlocked(fetched.html)) return;
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
