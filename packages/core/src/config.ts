import { weavePaths } from "./paths.ts";

// Global user settings. All optional — every consumer applies a fallback when
// a key is unset, so an empty `{}` config is valid. `weave config set` and
// `weave init`'s first-run wizard populate these.

export type AgentDefaults = {
  model?: string;         // e.g. "gpt-5-codex-high" for worker, "claude-opus-4-7" for planner
  bypass?: boolean;       // planner → --dangerously-skip-permissions; worker → --dangerously-bypass-approvals-and-sandbox
  extraArgs?: string;     // appended to the agent command verbatim
};

export type WeaveConfig = {
  version: 1;
  createdAt: string;
  defaultWaitTimeoutSeconds?: number;
  planner?: AgentDefaults;
  worker?: AgentDefaults;
  defaultPanes?: number;
};

const DEFAULT_CONFIG: WeaveConfig = {
  version: 1,
  defaultWaitTimeoutSeconds: 30,
  createdAt: new Date(0).toISOString(),
};

export async function readConfig(): Promise<WeaveConfig | null> {
  const file = Bun.file(weavePaths().config);
  if (!(await file.exists())) return null;
  return (await file.json()) as WeaveConfig;
}

export async function writeConfig(config: WeaveConfig): Promise<void> {
  await Bun.write(weavePaths().config, JSON.stringify(config, null, 2) + "\n");
}

export function defaultConfig(): WeaveConfig {
  return { ...DEFAULT_CONFIG, createdAt: new Date().toISOString() };
}

// Small helpers for dotted-key access from the CLI. Limited to known keys so
// typos surface immediately instead of silently creating garbage properties.
const KNOWN_KEYS = [
  "planner.model",
  "planner.bypass",
  "planner.extraArgs",
  "worker.model",
  "worker.bypass",
  "worker.extraArgs",
  "defaultPanes",
  "defaultWaitTimeoutSeconds",
] as const;

export type ConfigKey = (typeof KNOWN_KEYS)[number];

export function isConfigKey(key: string): key is ConfigKey {
  return (KNOWN_KEYS as readonly string[]).includes(key);
}

export function listConfigKeys(): readonly ConfigKey[] {
  return KNOWN_KEYS;
}

export function getConfigValue(config: WeaveConfig, key: ConfigKey): unknown {
  switch (key) {
    case "planner.model": return config.planner?.model;
    case "planner.bypass": return config.planner?.bypass;
    case "planner.extraArgs": return config.planner?.extraArgs;
    case "worker.model": return config.worker?.model;
    case "worker.bypass": return config.worker?.bypass;
    case "worker.extraArgs": return config.worker?.extraArgs;
    case "defaultPanes": return config.defaultPanes;
    case "defaultWaitTimeoutSeconds": return config.defaultWaitTimeoutSeconds;
  }
}

// Parse a user-provided string value to the right shape for the given key.
export function parseConfigValue(key: ConfigKey, raw: string): unknown {
  const trimmed = raw.trim();
  switch (key) {
    case "planner.bypass":
    case "worker.bypass":
      if (trimmed === "true" || trimmed === "on" || trimmed === "yes") return true;
      if (trimmed === "false" || trimmed === "off" || trimmed === "no") return false;
      throw new Error(`expected boolean (true/false) for ${key}, got: ${raw}`);
    case "defaultPanes":
    case "defaultWaitTimeoutSeconds": {
      const n = Number.parseInt(trimmed, 10);
      if (!Number.isFinite(n)) throw new Error(`expected integer for ${key}, got: ${raw}`);
      return n;
    }
    default:
      // model and extraArgs are free-form strings
      return trimmed;
  }
}

export function setConfigValue(config: WeaveConfig, key: ConfigKey, value: unknown): WeaveConfig {
  const next = structuredClone(config);
  switch (key) {
    case "planner.model":
      next.planner = { ...(next.planner ?? {}), model: value as string };
      break;
    case "planner.bypass":
      next.planner = { ...(next.planner ?? {}), bypass: value as boolean };
      break;
    case "planner.extraArgs":
      next.planner = { ...(next.planner ?? {}), extraArgs: value as string };
      break;
    case "worker.model":
      next.worker = { ...(next.worker ?? {}), model: value as string };
      break;
    case "worker.bypass":
      next.worker = { ...(next.worker ?? {}), bypass: value as boolean };
      break;
    case "worker.extraArgs":
      next.worker = { ...(next.worker ?? {}), extraArgs: value as string };
      break;
    case "defaultPanes":
      next.defaultPanes = value as number;
      break;
    case "defaultWaitTimeoutSeconds":
      next.defaultWaitTimeoutSeconds = value as number;
      break;
  }
  return next;
}
