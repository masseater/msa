import tuiModule from "@msa/tui";

import config from "../../../config.ts";
import type keybindingsTypes from "../../../core/keybindings.types.ts";
import ExpandableText from "../components/expandable-text.ts";
import keybindingHints from "../components/keybinding-hints.ts";
import logo from "../components/logo.ts";
import type InteractiveMode from "../interactive-mode.ts";
import themeModule from "../theme/theme.ts";

const { theme } = themeModule;
const { Spacer } = tuiModule;
const { keyText, keyHint, rawKeyHint } = keybindingHints;
const { wordmark } = logo;

const { VERSION } = config;

export default class StartupHeader {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  startupHeaderText(startupVisibility: { header: boolean; details: boolean }): {
    showDetails: boolean;
    withWordmark: (hints: string) => string;
    compactInstructions: () => string;
    expandedInstructions: () => string;
  } {
    const showDetails = startupVisibility.details;
    const withWordmark = (hints: string) =>
      `${wordmark()} ${theme.fg("dim", `v${VERSION}`)}\n${hints}`;

    const hint = (keybinding: keybindingsTypes.AppKeybinding, description: string) =>
      keyHint(keybinding, description);

    const expandedInstructions = () =>
      [
        hint("app.interrupt", "to interrupt"),
        hint("app.clear", "to clear"),
        rawKeyHint(`${keyText("app.clear")} twice`, "to exit"),
        hint("app.exit", "to exit (empty)"),
        hint("app.suspend", "to suspend"),
        keyHint("tui.editor.deleteToLineEnd", "to delete to end"),
        hint("app.thinking.cycle", "to cycle thinking level"),
        rawKeyHint(
          `${keyText("app.model.cycleForward")}/${keyText("app.model.cycleBackward")}`,
          "to cycle models",
        ),
        hint("app.model.select", "to select model"),
        hint("app.tools.expand", "to expand tools"),
        hint("app.thinking.toggle", "to expand thinking"),
        hint("app.editor.external", "for external editor"),
        rawKeyHint("/", "for commands"),
        rawKeyHint("!", "to run bash"),
        rawKeyHint("!!", "to run bash (no context)"),
        hint("app.message.followUp", "to queue follow-up"),
        hint("app.message.dequeue", "to edit all queued messages"),
        hint("app.clipboard.pasteImage", "to paste files on macOS, images, or text"),
        rawKeyHint("drop files", "to attach"),
      ].join("\n");
    const compactInstructions = () =>
      [
        hint("app.interrupt", "interrupt"),
        rawKeyHint(`${keyText("app.clear")}/${keyText("app.exit")}`, "clear/exit"),
        rawKeyHint("/", "commands"),
        rawKeyHint("!", "bash"),
        hint("app.tools.expand", "more"),
      ].join(theme.fg("muted", " · "));
    return { compactInstructions, expandedInstructions, showDetails, withWordmark };
  }

  mountStartupHeader(
    showDetails: boolean,
    withWordmark: (hints: string) => string,
    compactInstructions: () => string,
    expandedInstructions: () => string,
  ): void {
    const compactOnboarding = () =>
      theme.fg(
        "dim",
        `Press ${keyText("app.tools.expand")} to show full startup help${showDetails ? " and loaded resources" : ""}.`,
      );
    const onboarding = () =>
      theme.fg(
        "dim",
        `msa can explain its own features and look up its docs. Ask it how to use or extend msa.`,
      );
    const header = new ExpandableText(
      () => `${withWordmark(compactInstructions())}\n${compactOnboarding()}\n\n${onboarding()}`,
      () => `${withWordmark(expandedInstructions())}\n\n${onboarding()}`,
      this.mode.display.resources.isStartupExpanded(),
      1,
      0,
    );
    this.mode.layout.builtInHeader = header;

    this.mode.layout.headerContainer.addChild(new Spacer(1));
    this.mode.layout.headerContainer.addChild(this.mode.layout.builtInHeader);
    this.mode.layout.headerContainer.addChild(new Spacer(1));
  }
}
