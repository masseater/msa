import { existsSync, readFileSync } from "fs";

import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Compile } from "typebox/compile";

import { getAgentDir } from "../config.ts";
import { stripBom } from "../utils/text.ts";
import { KeybindingValueSchema } from "./key-id-schema.ts";
import { join } from "./platform-node.ts";
import { envSnapshot } from "./process-env.ts";

const { KeybindingsManager: TuiKeybindingsManager, TUI_KEYBINDINGS } = tui;

export function useWindowsKeybindings(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = envSnapshot(),
): boolean {
  return (
    platform === "win32" ||
    (platform === "linux" && Boolean(env["WSL_DISTRO_NAME"] || env["WSL_INTEROP"]))
  );
}

const windowsKeybindings = useWindowsKeybindings();

const APP_KEYBINDINGS = {
  "app.clear": { defaultKeys: "ctrl+c", description: "Clear editor" },
  "app.clipboard.pasteImage": {
    defaultKeys: windowsKeybindings ? "alt+v" : ["ctrl+v", "alt+v"],
    description: "Paste files on macOS, images, or text from clipboard",
  },
  "app.editor.external": {
    defaultKeys: "ctrl+g",
    description: "Open external editor",
  },
  "app.exit": { defaultKeys: "ctrl+d", description: "Exit when editor is empty" },
  "app.interrupt": { defaultKeys: "escape", description: "Cancel or abort" },
  "app.message.copy": {
    defaultKeys: "ctrl+x",
    description: "Copy selection or last assistant message",
  },
  "app.message.dequeue": {
    defaultKeys: windowsKeybindings ? "alt+q" : "alt+up",
    description: "Restore queued messages",
  },
  "app.message.followUp": {
    defaultKeys: windowsKeybindings ? "ctrl+q" : "alt+enter",
    description: "Queue follow-up message",
  },
  "app.model.cycleBackward": {
    defaultKeys: windowsKeybindings ? "alt+p" : "shift+ctrl+p",
    description: "Cycle to previous model",
  },
  "app.model.cycleForward": {
    defaultKeys: "ctrl+p",
    description: "Cycle to next model",
  },
  "app.model.select": { defaultKeys: "ctrl+l", description: "Open model selector" },
  "app.models.clearAll": {
    defaultKeys: "ctrl+x",
    description: "Clear all models",
  },
  "app.models.enableAll": {
    defaultKeys: "ctrl+a",
    description: "Enable all models",
  },
  "app.models.policy": {
    defaultKeys: "ctrl+e",
    description: "Deny or allow the selected model",
  },
  "app.models.reorderDown": {
    defaultKeys: "alt+down",
    description: "Move model down in order",
  },
  "app.models.reorderUp": {
    defaultKeys: "alt+up",
    description: "Move model up in order",
  },
  "app.models.save": {
    defaultKeys: "ctrl+s",
    description: "Save model selection",
  },
  "app.models.toggleProvider": {
    defaultKeys: "ctrl+p",
    description: "Toggle all models for provider",
  },
  "app.orchestrator.back": {
    defaultKeys: "shift+left",
    description: "Leave the threads view",
  },
  "app.orchestrator.currentState": {
    defaultKeys: "w",
    description: "Rewrite the current state of the selected task",
  },
  "app.orchestrator.depends": {
    defaultKeys: "d",
    description: "Change the dependencies of the selected task",
  },
  "app.orchestrator.goalState": {
    defaultKeys: "g",
    description: "Rewrite the goal state of the selected task",
  },
  "app.orchestrator.message": {
    defaultKeys: "n",
    description: "Send a message to the selected task",
  },
  "app.orchestrator.model": {
    defaultKeys: "m",
    description: "Switch the selected task's model",
  },
  "app.orchestrator.note": {
    defaultKeys: "b",
    description: "Send a shared note to the selected task's round",
  },
  "app.orchestrator.paneNarrow": {
    defaultKeys: "ctrl+shift+right",
    description: "Narrow the threads pane",
  },
  "app.orchestrator.paneWiden": {
    defaultKeys: "ctrl+shift+left",
    description: "Widen the threads pane",
  },
  "app.orchestrator.rerun": {
    defaultKeys: "r",
    description: "Rerun the selected task in a new thread",
  },
  "app.orchestrator.stop": {
    defaultKeys: "s",
    description: "Stop the selected task",
  },
  "app.orchestrator.threads": {
    defaultKeys: "shift+right",
    description: "Open the threads view",
  },
  "app.orchestrator.toggleFinished": {
    defaultKeys: "c",
    description: "Show or hide finished tasks",
  },
  "app.session.delete": {
    defaultKeys: "ctrl+d",
    description: "Delete session",
  },
  "app.session.deleteNoninvasive": {
    defaultKeys: "ctrl+backspace",
    description: "Delete session when query is empty",
  },
  "app.session.fork": { defaultKeys: [], description: "Fork current session" },
  "app.session.new": { defaultKeys: [], description: "Start a new session" },
  "app.session.rename": {
    defaultKeys: "ctrl+r",
    description: "Rename session",
  },
  "app.session.resume": { defaultKeys: [], description: "Resume a session" },
  "app.session.toggleNamedFilter": {
    defaultKeys: "ctrl+n",
    description: "Toggle named session filter",
  },
  "app.session.togglePath": {
    defaultKeys: "ctrl+p",
    description: "Toggle session path display",
  },
  "app.session.toggleSort": {
    defaultKeys: "ctrl+s",
    description: "Toggle session sort mode",
  },
  "app.session.tree": { defaultKeys: [], description: "Open session tree" },
  "app.suspend": {
    defaultKeys: process.platform === "win32" ? [] : "ctrl+z",
    description: "Suspend to background",
  },
  "app.thinking.cycle": {
    defaultKeys: "shift+tab",
    description: "Cycle thinking level",
  },
  "app.thinking.save": {
    defaultKeys: "ctrl+s",
    description: "Save thinking level",
  },
  "app.thinking.toggle": {
    defaultKeys: "ctrl+t",
    description: "Toggle thinking blocks",
  },
  "app.tools.expand": { defaultKeys: "ctrl+o", description: "Toggle tool output" },
  "app.tree.editLabel": {
    defaultKeys: "shift+l",
    description: "Edit tree label",
  },
  "app.tree.filter.all": {
    defaultKeys: "ctrl+a",
    description: "Tree filter: show all entries",
  },
  "app.tree.filter.cycleBackward": {
    defaultKeys: "shift+ctrl+o",
    description: "Tree filter: cycle backward",
  },
  "app.tree.filter.cycleForward": {
    defaultKeys: "ctrl+o",
    description: "Tree filter: cycle forward",
  },
  "app.tree.filter.default": {
    defaultKeys: "ctrl+d",
    description: "Tree filter: default view",
  },
  "app.tree.filter.labeledOnly": {
    defaultKeys: "ctrl+l",
    description: "Tree filter: labeled entries only",
  },
  "app.tree.filter.noTools": {
    defaultKeys: "ctrl+t",
    description: "Tree filter: hide tool results",
  },
  "app.tree.filter.userOnly": {
    defaultKeys: "ctrl+u",
    description: "Tree filter: user messages only",
  },
  "app.tree.foldOrUp": {
    defaultKeys:
      process.platform === "darwin" ? ["alt+left", "ctrl+left"] : ["ctrl+left", "alt+left"],
    description: "Fold tree branch or move up",
  },
  "app.tree.toggleLabelTimestamp": {
    defaultKeys: "shift+t",
    description: "Toggle tree label timestamps",
  },
  "app.tree.unfoldOrDown": {
    defaultKeys:
      process.platform === "darwin" ? ["alt+right", "ctrl+right"] : ["ctrl+right", "alt+right"],
    description: "Unfold tree branch or move down",
  },
} as const satisfies tuiTypes.KeybindingDefinitions;

export type AppKeybinding = keyof typeof APP_KEYBINDINGS;
export type AppKeybindings = { [K in AppKeybinding]: true };

declare global {
  interface MsaTuiKeybindings extends AppKeybindings {}
}

export const KEYBINDINGS = {
  ...TUI_KEYBINDINGS,
  "tui.altScreen.nextPrompt": {
    ...TUI_KEYBINDINGS["tui.altScreen.nextPrompt"],
    defaultKeys: windowsKeybindings ? "ctrl+down" : ["ctrl+shift+down", "ctrl+down"],
  },
  "tui.altScreen.previousPrompt": {
    ...TUI_KEYBINDINGS["tui.altScreen.previousPrompt"],
    defaultKeys: windowsKeybindings ? "ctrl+up" : ["ctrl+shift+up", "ctrl+up"],
  },
  "tui.altScreen.search": {
    ...TUI_KEYBINDINGS["tui.altScreen.search"],
    defaultKeys: windowsKeybindings ? "ctrl+f" : "ctrl+shift+f",
  },
  "tui.editor.undo": {
    ...TUI_KEYBINDINGS["tui.editor.undo"],
    defaultKeys: process.platform === "win32" ? "ctrl+z" : windowsKeybindings ? "alt+z" : "ctrl+-",
  },
  ...APP_KEYBINDINGS,
} as const satisfies tuiTypes.KeybindingDefinitions;

const KEYBINDING_NAME_MIGRATIONS = {
  clear: "app.clear",
  copy: "tui.input.copy",
  cursorDown: "tui.editor.cursorDown",
  cursorLeft: "tui.editor.cursorLeft",
  cursorLineEnd: "tui.editor.cursorLineEnd",
  cursorLineStart: "tui.editor.cursorLineStart",
  cursorRight: "tui.editor.cursorRight",
  cursorUp: "tui.editor.cursorUp",
  cursorWordLeft: "tui.editor.cursorWordLeft",
  cursorWordRight: "tui.editor.cursorWordRight",
  cycleModelBackward: "app.model.cycleBackward",
  cycleModelForward: "app.model.cycleForward",
  cycleThinkingLevel: "app.thinking.cycle",
  deleteCharBackward: "tui.editor.deleteCharBackward",
  deleteCharForward: "tui.editor.deleteCharForward",
  deleteSession: "app.session.delete",
  deleteSessionNoninvasive: "app.session.deleteNoninvasive",
  deleteToLineEnd: "tui.editor.deleteToLineEnd",
  deleteToLineStart: "tui.editor.deleteToLineStart",
  deleteWordBackward: "tui.editor.deleteWordBackward",
  deleteWordForward: "tui.editor.deleteWordForward",
  dequeue: "app.message.dequeue",
  exit: "app.exit",
  expandTools: "app.tools.expand",
  externalEditor: "app.editor.external",
  followUp: "app.message.followUp",
  fork: "app.session.fork",
  interrupt: "app.interrupt",
  jumpBackward: "tui.editor.jumpBackward",
  jumpForward: "tui.editor.jumpForward",
  newLine: "tui.input.newLine",
  newSession: "app.session.new",
  pageDown: "tui.editor.pageDown",
  pageUp: "tui.editor.pageUp",
  pasteImage: "app.clipboard.pasteImage",
  renameSession: "app.session.rename",
  resume: "app.session.resume",
  selectCancel: "tui.select.cancel",
  selectConfirm: "tui.select.confirm",
  selectDown: "tui.select.down",
  selectModel: "app.model.select",
  selectPageDown: "tui.select.pageDown",
  selectPageUp: "tui.select.pageUp",
  selectUp: "tui.select.up",
  submit: "tui.input.submit",
  suspend: "app.suspend",
  tab: "tui.input.tab",
  toggleSessionNamedFilter: "app.session.toggleNamedFilter",
  toggleSessionPath: "app.session.togglePath",
  toggleSessionSort: "app.session.toggleSort",
  toggleThinking: "app.thinking.toggle",
  tree: "app.session.tree",
  treeEditLabel: "app.tree.editLabel",
  treeFoldOrUp: "app.tree.foldOrUp",
  treeToggleLabelTimestamp: "app.tree.toggleLabelTimestamp",
  treeUnfoldOrDown: "app.tree.unfoldOrDown",
  undo: "tui.editor.undo",
  yank: "tui.editor.yank",
  yankPop: "tui.editor.yankPop",
} as const satisfies Record<string, tuiTypes.Keybinding>;

function isLegacyKeybindingName(key: string): key is keyof typeof KEYBINDING_NAME_MIGRATIONS {
  return key in KEYBINDING_NAME_MIGRATIONS;
}

const validateKeybindingValue = Compile(KeybindingValueSchema);

function toKeybindingsConfig(value: Record<string, unknown>): tuiTypes.KeybindingsConfig {
  const config: tuiTypes.KeybindingsConfig = {};
  for (const [key, binding] of Object.entries(value)) {
    if (key === "$schema") continue;
    if (validateKeybindingValue.Check(binding)) config[key] = binding;
  }
  return config;
}

export function migrateKeybindingsConfig(rawConfig: Record<string, unknown>): {
  config: Record<string, unknown>;
  migrated: boolean;
} {
  const config: Record<string, unknown> = {};
  let migrated = false;

  for (const [key, value] of Object.entries(rawConfig)) {
    const nextKey = isLegacyKeybindingName(key) ? KEYBINDING_NAME_MIGRATIONS[key] : key;
    if (nextKey !== key) {
      migrated = true;
    }
    if (key !== nextKey && Object.hasOwn(rawConfig, nextKey)) {
      migrated = true;
      continue;
    }
    config[nextKey] = value;
  }

  return { config: orderKeybindingsConfig(config), migrated };
}

function orderKeybindingsConfig(config: Record<string, unknown>): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  for (const keybinding of Object.keys(KEYBINDINGS)) {
    if (Object.hasOwn(config, keybinding)) {
      ordered[keybinding] = config[keybinding];
    }
  }

  const extras = Object.keys(config)
    .filter((key) => !Object.hasOwn(ordered, key))
    .sort();
  for (const key of extras) {
    ordered[key] = config[key];
  }

  return ordered;
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

export class KeybindingsManager extends TuiKeybindingsManager {
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

type Keybinding = tuiTypes.Keybinding;
type KeybindingsConfig = tuiTypes.KeybindingsConfig;
type KeyId = tuiTypes.KeyId;

export type { Keybinding, KeybindingsConfig, KeyId };
