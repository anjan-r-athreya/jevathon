import { readFile } from "node:fs/promises";
import path from "node:path";
import { serve } from "@hono/node-server";
import { config } from "dotenv";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { fetchPage, screenshotDir } from "./fetch/browserbase.js";
import { runUnslop } from "./pipeline.js";
import type { UnslopRequest } from "./types.js";
import { loadDemos } from "./demos.js";

config({ path: path.resolve(process.cwd(), ".env") });

const app = new Hono();
app.use("*", cors());

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    jev: Boolean(process.env.TYPESAFE_API_KEY),
    browserbase: Boolean(
      process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID,
    ),
  }),
);

app.get("/api/demos", async (c) => c.json(await loadDemos()));

/** Cached Browserbase screenshots, referenced by the `source` event. */
app.get("/shots/:file", async (c) => {
  const file = c.req.param("file");
  if (!/^[a-f0-9]{16}\.png$/.test(file)) return c.notFound();
  try {
    const png = await readFile(path.join(screenshotDir, file));
    return c.body(png, 200, {
      "content-type": "image/png",
      "cache-control": "no-store",
    });
  } catch {
    return c.notFound();
  }
});

/**
 * One endpoint for all three modes. Results stream back as server-sent events
 * so the UI can animate each of Jev's decisions as it lands.
 */
app.post("/api/unslop", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Partial<UnslopRequest>;
  const input = typeof body.input === "string" ? body.input : "";
  if (input.trim().length === 0)
    return c.json({ error: "input is required" }, 400);

  return streamSSE(c, async (stream) => {
    const controller = new AbortController();
    stream.onAbort(() => controller.abort());
    await runUnslop(
      { input, mode: body.mode ?? "auto", demo: body.demo ?? false },
      {
        emit: (event) => {
          void stream.writeSSE({
            event: event.event,
            data: JSON.stringify(event.data),
          });
        },
        signal: controller.signal,
        fetchPage,
      },
    );
  });
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  const jev = process.env.TYPESAFE_API_KEY
    ? "Jev ready"
    : "no TYPESAFE_API_KEY";
  const bb =
    process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID
      ? "Browserbase ready"
      : "Browserbase unset, web mode falls back to plain fetch";
  console.log(`Unslop server on http://localhost:${info.port} — ${jev}, ${bb}`);
});
