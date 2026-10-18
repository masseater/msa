import { Container, getKeybindings, Spacer, Text } from "@msa/tui";

import { APP_NAME } from "../../../config.ts";
import { SYSTEM_THEME_NAME } from "../theme/system-theme.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint, rawKeyHint } from "./keybinding-hints.ts";

export interface FirstTimeSetupResult {
  theme: string;
  shareAnalytics: boolean;
}

export interface FirstTimeSetupOptions {
  onThemePreview: (themeName: string) => void;
  onSubmit: (result: FirstTimeSetupResult) => void;
  onCancel: () => void;
}

const THEME_OPTIONS: Array<{ value: string; label: string }> = [
  { value: SYSTEM_THEME_NAME, label: "System (matches your terminal colors)" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

const ANALYTICS_OPTIONS: Array<{ value: boolean; label: string }> = [
  { value: true, label: "Share anonymous usage data" },
  { value: false, label: "Don't share" },
];

const SETUP_LOGO_LINES = ["██████", "██  ██", "████  ██", "██    ██"];

export class FirstTimeSetupComponent extends Container {
  private step: "theme" | "analytics" = "theme";
  private themeIndex: number;
  private analyticsIndex = 0;
  private readonly options: FirstTimeSetupOptions;

  constructor(options: FirstTimeSetupOptions) {
    super();
    this.options = options;
    this.themeIndex = 0;
    this.update();
  }

  override invalidate(): void {
    this.update();
    super.invalidate();
  }

  private update(): void {
    FirstTimeSetupComponent.updatePart1(this);

    this.addChild(new Spacer(1));
    this.addChild(
      new Text(
        rawKeyHint("↑↓", "navigate") +
          "  " +
          keyHint("tui.select.confirm", this.step === "theme" ? "continue" : "finish") +
          "  " +
          keyHint("tui.select.cancel", "skip setup"),
        1,
        0,
      ),
    );
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder());
  }

  private static updatePart1(self: FirstTimeSetupComponent): void {
    self.clear();
    self.addChild(new DynamicBorder());
    self.addChild(new Spacer(1));
    self.addChild(new Text(theme.fg("accent", SETUP_LOGO_LINES.join("\n")), 1, 0));
    self.addChild(new Spacer(1));
    self.addChild(
      new Text(
        theme.fg("accent", theme.bold(`Welcome to ${APP_NAME}, the minimal coding agent.`)),
        1,
        0,
      ),
    );
    self.addChild(new Spacer(1));

    if (self.step === "theme") {
      self.addChild(new Text(theme.fg("text", "Pick a theme."), 1, 0));
      self.addChild(new Spacer(1));
      self.addOptionList(
        THEME_OPTIONS.map((option) => option.label),
        self.themeIndex,
      );
    } else {
      self.addChild(new Text(theme.fg("text", "Opt-in to anonymous usage data sharing?"), 1, 0));
      self.addChild(
        new Text(
          theme.fg(
            "muted",
            "Opting in stores a tracking identifier in settings.json and enables anonymous\nusage analytics. This helps us to better debug, reproduce, and resolve issues\nand bugs within msa. You can observe what is shared using /privacy and make\nchanges anytime in settings.json.",
          ),
          1,
          0,
        ),
      );
      self.addChild(new Spacer(1));
      self.addOptionList(
        ANALYTICS_OPTIONS.map((option) => option.label),
        self.analyticsIndex,
      );
    }
  }

  private addOptionList(labels: string[], selectedIndex: number): void {
    for (const [i, text] of labels.entries()) {
      const isSelected = i === selectedIndex;
      const prefix = isSelected ? theme.fg("accent", "→ ") : "  ";
      const label = isSelected ? theme.fg("accent", text) : theme.fg("text", text);
      this.addChild(new Text(`${prefix}${label}`, 1, 0));
    }
  }

  private moveSelection(delta: number): void {
    if (this.step === "theme") {
      const next = Math.max(0, Math.min(THEME_OPTIONS.length - 1, this.themeIndex + delta));
      const themeOption = THEME_OPTIONS[next];
      if (next !== this.themeIndex && themeOption !== undefined) {
        this.themeIndex = next;
        this.options.onThemePreview(themeOption.value);
      }
    } else {
      this.analyticsIndex = Math.max(
        0,
        Math.min(ANALYTICS_OPTIONS.length - 1, this.analyticsIndex + delta),
      );
    }
    this.update();
  }

  handleInput(keyData: string): void {
    const kb = getKeybindings();
    if (kb.matches(keyData, "tui.select.up") || keyData === "k") {
      this.moveSelection(-1);
    } else if (kb.matches(keyData, "tui.select.down") || keyData === "j") {
      this.moveSelection(1);
    } else if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n") {
      if (this.step === "theme") {
        this.step = "analytics";
        this.update();
      } else {
        const themeOption = THEME_OPTIONS[this.themeIndex];
        const analyticsOption = ANALYTICS_OPTIONS[this.analyticsIndex];
        if (themeOption === undefined || analyticsOption === undefined) return;
        this.options.onSubmit({
          theme: themeOption.value,
          shareAnalytics: analyticsOption.value,
        });
      }
    } else if (kb.matches(keyData, "tui.select.cancel")) {
      this.options.onCancel();
    }
  }
}
