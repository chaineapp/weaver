import {
  readConfig,
  writeConfig,
  defaultConfig,
  listConfigKeys,
  isConfigKey,
  getConfigValue,
  setConfigValue,
  parseConfigValue,
} from "@weaver/core";

const USAGE = `usage:
  weave config list              # show all keys and current values
  weave config get <key>
  weave config set <key> <value>

keys:
${listConfigKeys()
  .map((k) => `  - ${k}`)
  .join("\n")}

examples:
  weave config set planner.bypass true
  weave config set worker.bypass true
  weave config set worker.model gpt-5-codex-high
  weave config set defaultPanes 4
`;

async function readOrEmpty() {
  return (await readConfig()) ?? defaultConfig();
}

export async function runConfigList(): Promise<void> {
  const cfg = await readOrEmpty();
  for (const key of listConfigKeys()) {
    const value = getConfigValue(cfg, key);
    const display = value === undefined ? "(unset)" : JSON.stringify(value);
    console.log(`  ${key.padEnd(30)} ${display}`);
  }
}

export async function runConfigGet(key: string): Promise<void> {
  if (!isConfigKey(key)) {
    console.error(`unknown key: ${key}\n\n${USAGE}`);
    process.exit(1);
  }
  const cfg = await readOrEmpty();
  const value = getConfigValue(cfg, key);
  console.log(value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value));
}

export async function runConfigSet(key: string, rawValue: string): Promise<void> {
  if (!isConfigKey(key)) {
    console.error(`unknown key: ${key}\n\n${USAGE}`);
    process.exit(1);
  }
  const cfg = await readOrEmpty();
  const parsed = parseConfigValue(key, rawValue);
  const next = setConfigValue(cfg, key, parsed);
  await writeConfig(next);
  console.log(`✓ ${key} = ${JSON.stringify(parsed)}`);
}

export function configUsage(): string {
  return USAGE;
}
