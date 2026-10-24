import { Type } from "typebox";

import settingsDefaults from "../settings-defaults.ts";
import sectionSchemas from "./section-schemas.ts";

const { SETTINGS_DEFAULTS } = settingsDefaults;
const { ImageSettingsSchema, MarkdownSettingsSchema, TerminalSettingsSchema } = sectionSchemas;

const displayProperties = {
  autocompleteMaxVisible: Type.Optional(
    Type.Number({
      default: SETTINGS_DEFAULTS.autocompleteMaxVisible,
      description: "Maximum visible items in the autocomplete dropdown.",
    }),
  ),
  clipboardImageCommand: Type.Optional(
    Type.String({
      description:
        "Shell command whose stdout is the clipboard image, read by the paste key in place of the local clipboard. Global setting only.",
    }),
  ),
  collapseChangelog: Type.Optional(
    Type.Boolean({
      default: SETTINGS_DEFAULTS.collapseChangelog,
      description:
        "Show the condensed changelog after update; use /release-notes for the full changelog.",
    }),
  ),
  doubleEscapeAction: Type.Optional(
    Type.Union([Type.Literal("fork"), Type.Literal("tree"), Type.Literal("none")], {
      default: SETTINGS_DEFAULTS.doubleEscapeAction,
      description: "Action for double-escape with an empty editor.",
    }),
  ),
  editorPaddingX: Type.Optional(
    Type.Number({
      default: SETTINGS_DEFAULTS.editorPaddingX,
      description: "Horizontal padding for the input editor.",
    }),
  ),
  externalEditor: Type.Optional(
    Type.String({
      description: "Command for Ctrl+G external editor; takes precedence over VISUAL and EDITOR.",
    }),
  ),
  fullscreenCopyOnSelect: Type.Optional(
    Type.Boolean({
      default: SETTINGS_DEFAULTS.fullscreenCopyOnSelect,
      description: "No effect in regular TUI mode.",
    }),
  ),
  fullscreenExitOutput: Type.Optional(
    Type.Union([Type.Literal("transcript"), Type.Literal("resume-hint")], {
      default: SETTINGS_DEFAULTS.fullscreenExitOutput,
      description: "No effect in regular TUI mode.",
    }),
  ),
  fullscreenScrollbar: Type.Optional(
    Type.Union([Type.Literal("auto"), Type.Literal("always"), Type.Literal("hidden")], {
      default: SETTINGS_DEFAULTS.fullscreenScrollbar,
      description: "No effect in regular TUI mode.",
    }),
  ),
  fullscreenWheelScrollLines: Type.Optional(
    Type.Union([Type.Number(), Type.Literal("auto")], {
      default: SETTINGS_DEFAULTS.fullscreenWheelScrollLines,
      description:
        "Lines scrolled per wheel event in fullscreen mode; numeric values are clamped from 1 to 100.",
    }),
  ),
  hideThinkingBlock: Type.Optional(Type.Boolean({ default: SETTINGS_DEFAULTS.hideThinkingBlock })),
  images: Type.Optional(ImageSettingsSchema),
  lastChangelogVersion: Type.Optional(Type.String()),
  markdown: Type.Optional(MarkdownSettingsSchema),
  notifyCommand: Type.Optional(
    Type.String({
      description:
        "Shell command run when msa stops and needs you, with the message in MSA_NOTIFY_MESSAGE. Global setting only.",
    }),
  ),
  outputPad: Type.Optional(
    Type.Union([Type.Literal(0), Type.Literal(1)], {
      default: SETTINGS_DEFAULTS.outputPad,
      description: "Horizontal padding for transcript content.",
    }),
  ),
  quietStartup: Type.Optional(
    Type.Union([Type.Boolean(), Type.Literal("header")], {
      default: SETTINGS_DEFAULTS.quietStartup,
      description:
        'When true, hide all startup output. When "header", keep only the startup header.',
    }),
  ),
  showCacheMissNotices: Type.Optional(
    Type.Boolean({
      default: SETTINGS_DEFAULTS.showCacheMissNotices,
      description: "Show cache cost and provider recovery notices.",
    }),
  ),
  showHardwareCursor: Type.Optional(
    Type.Boolean({ description: "Show the terminal cursor while still positioning it for IME." }),
  ),
  terminal: Type.Optional(TerminalSettingsSchema),
  theme: Type.Optional(Type.String()),
  treeFilterMode: Type.Optional(
    Type.Union(
      [
        Type.Literal("default"),
        Type.Literal("no-tools"),
        Type.Literal("user-only"),
        Type.Literal("labeled-only"),
        Type.Literal("all"),
      ],
      {
        default: SETTINGS_DEFAULTS.treeFilterMode,
        description: "Default filter when opening /tree.",
      },
    ),
  ),
  tuiMode: Type.Optional(
    Type.Union([Type.Literal("regular"), Type.Literal("fullscreen")], {
      default: SETTINGS_DEFAULTS.tuiMode,
    }),
  ),
};

export default displayProperties;
