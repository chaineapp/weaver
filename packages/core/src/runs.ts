import { weavePaths } from "./paths.ts";
import { parseAll, summarize, type CodexEvent, type PaneSummary } from "@weaver/codex-adapter";

export type ReadEventsOptions = {
  sinceByte?: number;
  maxEvents?: number;
};

export type ReadEventsResult = {
  events: CodexEvent[];
  endByte: number;
  fileMissing: boolean;
};

export async function readEvents(paneId: string, opts: ReadEventsOptions = {}): Promise<ReadEventsResult> {
  const runFile = weavePaths().runFile(paneId);
  const file = Bun.file(runFile);
  if (!(await file.exists())) {
    return { events: [], endByte: 0, fileMissing: true };
  }
  const size = file.size;
  const start = opts.sinceByte ?? 0;
  if (start >= size) return { events: [], endByte: size, fileMissing: false };

  const slice = file.slice(start, size);
  const text = await slice.text();
  const events = parseAll(text);
  const capped = typeof opts.maxEvents === "number" ? events.slice(-opts.maxEvents) : events;
  return { events: capped, endByte: size, fileMissing: false };
}

export async function paneSummary(paneId: string): Promise<PaneSummary> {
  const { events } = await readEvents(paneId);
  return summarize(events);
}

export async function runFileSize(paneId: string): Promise<number> {
  const file = Bun.file(weavePaths().runFile(paneId));
  if (!(await file.exists())) return 0;
  return file.size;
}
