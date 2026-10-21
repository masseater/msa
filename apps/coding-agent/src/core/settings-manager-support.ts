import toolNames from "./orchestrator/tool-names.ts";
import type settingsSchemaTypes from "./settings-schema.types.ts";
const { ORCHESTRATOR_TOOL_NAMES } = toolNames;
const CACHE_WARMING_MODES = [
  "off",
  "streaming",
  "idle",
] as const satisfies readonly settingsSchemaTypes.CacheWarmingMode[];
const DEFAULT_TOOL_NAMES: readonly string[] = [
  "read",
  "bash",
  "edit",
  "write",
  "memory",
  "pr_watch",
  "model_policy",
  "model_upgrade",
  ...ORCHESTRATOR_TOOL_NAMES,
  "web_search",
  "web_fetch",
];
function isToolModifier(entry: unknown): boolean {
  return typeof entry === "string" && (entry.startsWith("+") || entry.startsWith("-"));
}
function getToolListError(entries: readonly string[]): string | undefined {
  const modifiers = entries.filter(isToolModifier);
  if (modifiers.length === 0) return undefined;
  if (modifiers.length < entries.length)
    return "tool names cannot be mixed with +name or -name entries";
  const pattern = modifiers.find((entry) => entry.includes("*"));
  if (pattern !== undefined && pattern !== "")
    return `+name and -name entries take exact tool names, not patterns: ${pattern}`;
  return undefined;
}
function applyToolModifiers(base: readonly string[], entries: readonly string[]): string[] {
  const tools = [...base];
  for (const entry of entries) {
    if (!isToolModifier(entry)) continue;
    const name = entry.slice(1);
    const index = tools.indexOf(name);
    if (entry.startsWith("+") && index === -1 && name !== "") tools.push(name);
    else if (entry.startsWith("-") && index !== -1) tools.splice(index, 1);
  }
  return tools;
}

const settingsManagerSupport = {
  CACHE_WARMING_MODES,
  DEFAULT_TOOL_NAMES,
  applyToolModifiers,
  getToolListError,
  isToolModifier,
};

export default settingsManagerSupport;
