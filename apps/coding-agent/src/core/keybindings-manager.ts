import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Compile } from "typebox/compile";

import configModule from "../config.ts";
import text from "../utils/text.ts";
import keyIdSchema from "./key-id-schema.ts";
import keybindings from "./keybindings.ts";
import platformNode from "./platform-node.ts";
import nodeFs from "./platform/node/fs.ts";

const { existsSync, readFileSync } = nodeFs;
const { KeybindingValueSchema } = keyIdSchema;
const { stripBom } = text;
const { getAgentDir } = configModule;
const { join } = platformNode;
const { KEYBINDINGS, migrateKeybindingsConfig } = keybindings;

const validateKeybindingValue = Compile(KeybindingValueSchema);
function toKeybindingsConfig(value: Record<string, unknown>): tuiTypes.KeybindingsConfig {
  const config: tuiTypes.KeybindingsConfig = {};
  for (const [key, binding] of Object.entries(value)) {
    if (key === "$schema") continue;
    if (validateKeybindingValue.Check(binding)) config[key] = binding;
  }
  return config;
}
function loadRawConfig(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(stripBom(readFileSync(path, "utf-8"))) as unknown;
    if (typeof parsed !== "object" || parsed === null) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
export default class KeybindingsManager extends tui.KeybindingsManager {
  private configPath: string | undefined;

  constructor(userBindings: tuiTypes.KeybindingsConfig = {}, configPath?: string) {
    super(KEYBINDINGS, userBindings);
    this.configPath = configPath;
  }

  static create(agentDir: string = getAgentDir()): KeybindingsManager {
    const configPath = join(agentDir, "keybindings.json");
    const userBindings = KeybindingsManager.loadFromFile(configPath);
    return new KeybindingsManager(userBindings, configPath);
  }

  reload(): void {
    if (this.configPath === undefined || this.configPath === "") return;
    this.setUserBindings(KeybindingsManager.loadFromFile(this.configPath));
  }

  getEffectiveConfig(): tuiTypes.KeybindingsConfig {
    return this.getResolvedBindings();
  }

  private static loadFromFile(path: string): tuiTypes.KeybindingsConfig {
    const rawConfig = loadRawConfig(path);
    if (rawConfig === undefined) return {};
    return toKeybindingsConfig(migrateKeybindingsConfig(rawConfig).config);
  }
}
