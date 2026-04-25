// Library surface — importable by @weaver/cli and any future packaging.
export { startMcpServer } from "./server.ts";
// `buildCodexCommand` is reused by `weave dispatch` (CLI) to build the same
// shell command an MCP-spawned worker would run, but driven from Bash.
export { buildCodexCommand } from "./spawn.ts";
