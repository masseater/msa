import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type trustManagerTypes from "../../../core/trust-manager.types.ts";
import themeModule from "../theme/theme.ts";
import DynamicBorder from "./dynamic-border.ts";
import keybindingHints from "./keybinding-hints.ts";
import type trustSelectorTypes from "./trust-selector.types.ts";

const { theme } = themeModule;
const { keyHint, rawKeyHint } = keybindingHints;

const { Container, Spacer, Text, getKeybindings } = tui;

function formatDecision(
  trustPath: string | undefined,
  decision: trustManagerTypes.ProjectTrustStoreEntry | null,
): string {
  if (decision === null) {
    return "none";
  }
  const label = decision.decision ? "trusted" : "untrusted";
  if (trustPath !== undefined && decision.path !== trustPath) {
    return `${label} (inherited from ${decision.path})`;
  }
  return `${label} (${decision.path})`;
}

export default class TrustSelectorComponent extends tui.Container {
  private selectedIndex: number;
  private readonly listContainer: tuiTypes.Container;
  private readonly trustOptions: trustManagerTypes.ProjectTrustOption[];
  private readonly savedDecision: trustManagerTypes.ProjectTrustStoreEntry | null;
  private readonly onSelectCallback: (selection: trustSelectorTypes.TrustSelection) => void;
  private readonly onCancelCallback: () => void;

  constructor(options: trustSelectorTypes.TrustSelectorOptions) {
    super();

    this.savedDecision = options.savedDecision;
    this.trustOptions = options.trustOptions;
    this.selectedIndex = Math.max(
      0,
      this.trustOptions.findIndex((option) => this.isSavedOption(option)),
    );
    this.onSelectCallback = options.onSelect;
    this.onCancelCallback = options.onCancel;

    this.addChild(new DynamicBorder());
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.fg("accent", theme.bold("Project trust")), 1, 0));
    this.addChild(new Text(theme.fg("muted", options.cwd), 1, 0));
    this.addChild(new Spacer(1));
    this.addChild(
      new Text(
        theme.fg(
          "muted",
          `Saved decision: ${formatDecision(this.trustOptions[0]?.savedPath, options.savedDecision)}`,
        ),
        1,
        0,
      ),
    );
    this.addChild(
      new Text(
        theme.fg("muted", `Current session: ${options.projectTrusted ? "trusted" : "untrusted"}`),
        1,
        0,
      ),
    );
    this.addChild(new Spacer(1));

    this.listContainer = new Container();
    this.addChild(this.listContainer);
    this.addChild(new Spacer(1));
    TrustSelectorComponent.addHintsAndBorder(this);
  }

  private static addHintsAndBorder(self: TrustSelectorComponent): void {
    self.addChild(
      new Text(
        rawKeyHint("↑↓", "navigate") +
          "  " +
          keyHint("tui.select.confirm", "save") +
          "  " +
          keyHint("tui.select.cancel", "cancel"),
        1,
        0,
      ),
    );
    self.addChild(new Spacer(1));
    self.addChild(new DynamicBorder());

    self.updateList();
  }

  private isSavedOption(option: trustManagerTypes.ProjectTrustOption): boolean {
    return (
      option.savedPath !== undefined &&
      this.savedDecision?.decision === option.trusted &&
      this.savedDecision.path === option.savedPath
    );
  }

  private updateList(): void {
    this.listContainer.clear();
    for (let i = 0; i < this.trustOptions.length; i++) {
      const option = this.trustOptions[i];
      if (option === undefined) {
        continue;
      }

      const isSelected = i === this.selectedIndex;
      const isCurrent = this.isSavedOption(option);
      const currentMarker = isCurrent ? theme.fg("accent", "✓ ") : "  ";
      const prefix = isSelected ? theme.fg("accent", "→ ") : "  ";
      const label = isSelected ? theme.fg("accent", option.label) : theme.fg("text", option.label);
      this.listContainer.addChild(new Text(`${prefix}${currentMarker}${label}`, 1, 0));
    }
  }

  handleInput(keyData: string): void {
    const kb = getKeybindings();
    if (kb.matches(keyData, "tui.select.up") || keyData === "k") {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.updateList();
    } else if (kb.matches(keyData, "tui.select.down") || keyData === "j") {
      this.selectedIndex = Math.min(this.trustOptions.length - 1, this.selectedIndex + 1);
      this.updateList();
    } else if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n") {
      const selected = this.trustOptions[this.selectedIndex];
      if (selected !== undefined) {
        this.onSelectCallback({ trusted: selected.trusted, updates: selected.updates });
      }
    } else if (kb.matches(keyData, "tui.select.cancel")) {
      this.onCancelCallback();
    }
  }
}
