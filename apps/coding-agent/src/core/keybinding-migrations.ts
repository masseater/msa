import type tuiTypes from "@msa/tui/index.types";

import keybindingDefinitions from "./keybinding-definitions.ts";

const { KEYBINDINGS } = keybindingDefinitions;

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

function migrateKeybindingsConfig(rawConfig: Record<string, unknown>): {
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

const keybindingMigrations = {
  migrateKeybindingsConfig,
};

export default keybindingMigrations;
