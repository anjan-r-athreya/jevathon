import type {
  Block,
  DonePayload,
  Edit,
  Judgment,
  Mode,
  Source,
  Unit,
} from "../../server/src/types.js";

export type { Block, DonePayload, Edit, Judgment, Mode, Source, Unit };

export type Demo = { id: string; label: string; mode: Mode; input: string };

export type Handlers = {
  onMode: (mode: Mode, confidence: number) => void;
  onSource: (source: Source) => void;
  onUnits: (units: Unit[], blocks: Block[]) => void;
  onJudgment: (judgment: Judgment) => void;
  onEdit: (edit: Edit) => void;
  onDone: (done: DonePayload) => void;
  onError: (message: string) => void;
};

/**
 * Streams one run from the server. Server-sent events arrive over a POST, so
 * this reads the body itself rather than using `EventSource`.
 */
export async function unslop(
  body: { input: string; mode: Mode | "auto"; demo: boolean },
  handlers: Handlers,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/unslop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    handlers.onError(`The server returned ${res.status}.`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Events are separated by a blank line; a partial one stays in the buffer.
    let split: number;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      dispatch(buffer.slice(0, split), handlers);
      buffer = buffer.slice(split + 2);
    }
  }
}

function dispatch(chunk: string, h: Handlers): void {
  let event = "";
  const dataLines: string[] = [];
  for (const line of chunk.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (!event || dataLines.length === 0) return;

  let data: unknown;
  try {
    data = JSON.parse(dataLines.join("\n"));
  } catch {
    return;
  }

  switch (event) {
    case "mode": {
      const d = data as { mode: Mode; confidence: number };
      h.onMode(d.mode, d.confidence);
      break;
    }
    case "source":
      h.onSource(data as Source);
      break;
    case "units": {
      const d = data as { units: Unit[]; blocks: Block[] };
      h.onUnits(d.units, d.blocks);
      break;
    }
    case "judgment":
      h.onJudgment(data as Judgment);
      break;
    case "edit":
      h.onEdit(data as Edit);
      break;
    case "done":
      h.onDone(data as DonePayload);
      break;
    case "error":
      h.onError((data as { message: string }).message);
      break;
  }
}

export async function loadDemos(): Promise<Demo[]> {
  try {
    const res = await fetch("/api/demos");
    return res.ok ? ((await res.json()) as Demo[]) : [];
  } catch {
    return [];
  }
}
