import { paths } from "./paths.ts";
import { parseAll, summarize, type CodexEvent, type PaneSummary } from "@weaver/codex-adapter";

export type ReadEventsOptions = {
  sinceByte?: number; // start reading at this byte offset
  maxEvents?: number; // cap on events returned
};

export type ReadEventsResult = {
  events: CodexEvent[];
  endByte: number; // next offset to read from
  fileMissing: boolean;
};

export async function readEvents(
  projectRoot: string,
  paneId: string,
  opts: ReadEventsOptions = {},
): Promise<ReadEventsResult> {
  const runFile = paths(projectRoot).runFile(paneId);
  const file = Bun.file(runFile);
  if (!(await file.exists())) {
    return { events: [], endByte: 0, fileMissing: true };
  }
  const size = file.size;
  const start = opts.sinceByte ?? 0;
  if (start >= size) return { events: [], endByte: size, fileMissing: false };

  // Bun.file supports slice for range reads without loading whole file.
  const slice = file.slice(start, size);
  const text = await slice.text();
  const events = parseAll(text);
  const capped = typeof opts.maxEvents === "number" ? events.slice(-opts.maxEvents) : events;
  return { events: capped, endByte: size, fileMissing: false };
}

export async function paneSummary(projectRoot: string, paneId: string): Promise<PaneSummary> {
  const { events } = await readEvents(projectRoot, paneId);
  return summarize(events);
}
