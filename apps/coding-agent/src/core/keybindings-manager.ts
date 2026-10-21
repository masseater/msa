import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Compile } from "typebox/compile";

import configModule from "../config.ts";
import text from "../utils/text.ts";
import keyIdSchema from "./key-id-schema.ts";
import keybindings from "./keybindings.ts";
import platformModule from "./platform/index.ts";

const { readText } = platformModule.files;
const { KeybindingValueSchema } = keyIdSchema;
const { stripBom } = text;
const { getAgentDir } = configModule;
const { join } = platformModule;
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
function parseRawConfig(content: string): Record<string, unknown> | undefined {
  const parsed = JSON.parse(stripBom(content)) as unknown;
  return typeof parsed === "object" && parsed !== null
    ? (parsed as Record<string, unknown>)
    : undefined;
}

const loadedConfigs = new Map<string, tuiTypes.KeybindingsConfig>();

function readKeybindingsFile(path: string): Promise<tuiTypes.KeybindingsConfig> {
  return readText(path)
    .then(parseRawConfig)
    .then(
      (rawConfig) =>
        rawConfig === undefined
          ? {}
          : toKeybindingsConfig(migrateKeybindingsConfig(rawConfig).config),
      () => ({}),
    )
    .then((config) => {
      loadedConfigs.set(path, config);
      return config;
    });
}
export default class KeybindingsManager extends tui.KeybindingsManager {
  private configPath: string | undefined;

  constructor(userBindings: tuiTypes.KeybindingsConfig = {}, configPath?: string) {
    super(KEYBINDINGS, userBindings);
    this.configPath = configPath;
  }

  static refresh(agentDir: string = getAgentDir()): Promise<void> {
    return readKeybindingsFile(join(agentDir, "keybindings.json")).then(() => undefined);
  }

  static create(agentDir: string = getAgentDir()): KeybindingsManager {
    const configPath = join(agentDir, "keybindings.json");
    return new KeybindingsManager(loadedConfigs.get(configPath) ?? {}, configPath);
  }

  reload(): Promise<void> {
    const { configPath } = this;
    if (configPath === undefined || configPath === "") return Promise.resolve();
    return readKeybindingsFile(configPath).then((config) => this.setUserBindings(config));
  }

  getEffectiveConfig(): tuiTypes.KeybindingsConfig {
    return this.getResolvedBindings();
  }
}
