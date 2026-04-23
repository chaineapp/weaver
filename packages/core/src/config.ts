import { weavePaths } from "./paths.ts";

// Global user settings. Mostly defaults today; more will show up as Weaver
// grows (default model, polling interval, memory promotion cadence, ...).

export type WeaveConfig = {
  version: 1;
  defaultModel?: string;
  defaultWaitTimeoutSeconds: number;
  createdAt: string;
};

const DEFAULT_CONFIG: WeaveConfig = {
  version: 1,
  defaultWaitTimeoutSeconds: 30,
  createdAt: new Date(0).toISOString(), // overwritten on first init
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
