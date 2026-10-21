import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import themeModule from "../theme/theme.ts";
import DynamicBorder from "./dynamic-border.ts";
import oauthSelectorSupport from "./oauth-selector-support.ts";
import type oauthSelectorTypes from "./oauth-selector.types.ts";

const { theme } = themeModule;
const { Container, Input, Spacer, TruncatedText, fuzzyFilter, getKeybindings } = tui;
const { formatAuthSelectorProviderStatus, formatAuthSelectorProviderType } = oauthSelectorSupport;

export default class OAuthSelectorComponent extends tui.Container implements tuiTypes.Focusable {
  private searchInput: tuiTypes.Input;

  private focusedState = false;
  get focused(): boolean {
    return this.focusedState;
  }
  set focused(value: boolean) {
    this.focusedState = value;
    this.searchInput.focused = value;
  }

  private listContainer: tuiTypes.Container;
  private allProviders: oauthSelectorTypes.AuthSelectorProvider[];
  private filteredProviders: oauthSelectorTypes.AuthSelectorProvider[];
  private selectedIndex: number = 0;
  private mode: "login" | "logout";
  private onSelectCallback: (
    providerId: string,
    authType: oauthSelectorTypes.AuthSelectorProvider["authType"],
  ) => void;
  private onCancelCallback: () => void;
  private showAuthTypeLabels: boolean;

  constructor(
    mode: "login" | "logout",
    providers: oauthSelectorTypes.AuthSelectorProvider[],
    onSelect: (
      providerId: string,
      authType: oauthSelectorTypes.AuthSelectorProvider["authType"],
    ) => void,
    onCancel: () => void,
    initialSearchInput?: string,
  ) {
    super();

    this.mode = mode;
    this.allProviders = providers;
    this.filteredProviders = providers;
    this.showAuthTypeLabels = new Set(providers.map((provider) => provider.authType)).size > 1;
    this.onSelectCallback = onSelect;
    this.onCancelCallback = onCancel;

    this.addChild(new DynamicBorder());
    this.addChild(new Spacer(1));

    const title = mode === "login" ? "Select provider to configure:" : "Select provider to logout:";
    this.addChild(new TruncatedText(theme.fg("accent", theme.bold(title)), 1, 0));
    this.addChild(new Spacer(1));

    this.searchInput = new Input();
    if (initialSearchInput !== undefined && initialSearchInput !== "") {
      this.searchInput.setValue(initialSearchInput);
    }
    this.searchInput.onSubmit = () => {
      const selectedProvider = this.filteredProviders[this.selectedIndex];
      if (selectedProvider !== undefined) {
        this.onSelectCallback(selectedProvider.id, selectedProvider.authType);
      }
    };
    this.addChild(this.searchInput);
    this.addChild(new Spacer(1));

    this.listContainer = new Container();
    this.addChild(this.listContainer);

    this.addChild(new Spacer(1));

    this.addChild(new DynamicBorder());

    this.filterProviders(initialSearchInput ?? "");
  }

  private filterProviders(query: string): void {
    this.filteredProviders =
      query === ""
        ? this.allProviders
        : fuzzyFilter(
            this.allProviders,
            query,
            (provider) =>
              `${provider.name} ${provider.id} ${provider.authType} ${provider.method?.name ?? ""}`,
          );
    this.selectedIndex = Math.max(
      0,
      Math.min(this.selectedIndex, Math.max(0, this.filteredProviders.length - 1)),
    );
    this.updateList();
  }

  private updateList(): void {
    const { startIndex, endIndex } = OAuthSelectorComponent.updateListStartIndex(this);

    if (startIndex > 0 || endIndex < this.filteredProviders.length) {
      const scrollInfo = theme.fg(
        "muted",
        `  (${this.selectedIndex + 1}/${this.filteredProviders.length})`,
      );
      this.listContainer.addChild(new TruncatedText(scrollInfo, 1, 0));
    }

    if (this.filteredProviders.length === 0) {
      const message =
        this.allProviders.length === 0
          ? this.mode === "login"
            ? "No providers available"
            : "No providers logged in. Use /login first."
          : "No matching providers";
      this.listContainer.addChild(new TruncatedText(theme.fg("muted", `  ${message}`), 1, 0));
    }
  }

  private static updateListStartIndex(self: OAuthSelectorComponent): {
    startIndex: number;
    endIndex: number;
  } {
    self.listContainer.clear();

    const maxVisible = 8;
    const startIndex = Math.max(
      0,
      Math.min(
        self.selectedIndex - Math.floor(maxVisible / 2),
        self.filteredProviders.length - maxVisible,
      ),
    );
    const endIndex = Math.min(startIndex + maxVisible, self.filteredProviders.length);

    for (let i = startIndex; i < endIndex; i++) {
      const provider = self.filteredProviders[i];
      if (provider === undefined) continue;

      const isSelected = i === self.selectedIndex;

      const statusIndicator = formatAuthSelectorProviderStatus(provider);
      const authTypeLabel = self.showAuthTypeLabels
        ? theme.fg(
            "muted",
            ` [${formatAuthSelectorProviderType(provider.authType, provider.subscription)}]`,
          )
        : "";
      let line: string;
      if (isSelected) {
        const prefix = theme.fg("accent", "→ ");
        const text = theme.fg("accent", provider.name);
        line = prefix + text + authTypeLabel + statusIndicator;
      } else {
        const text = `  ${theme.fg("text", provider.name)}`;
        line = text + authTypeLabel + statusIndicator;
      }

      self.listContainer.addChild(new TruncatedText(line, 1, 0));
    }
    return { endIndex, startIndex };
  }

  handleInput(keyData: string): void {
    const kb = getKeybindings();
    if (kb.matches(keyData, "tui.select.up")) {
      if (this.filteredProviders.length === 0) return;
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.updateList();
    } else if (kb.matches(keyData, "tui.select.down")) {
      if (this.filteredProviders.length === 0) return;
      this.selectedIndex = Math.min(this.filteredProviders.length - 1, this.selectedIndex + 1);
      this.updateList();
    } else if (kb.matches(keyData, "tui.select.confirm")) {
      const selectedProvider = this.filteredProviders[this.selectedIndex];
      if (selectedProvider !== undefined) {
        this.onSelectCallback(selectedProvider.id, selectedProvider.authType);
      }
    } else if (kb.matches(keyData, "tui.select.cancel")) {
      this.onCancelCallback();
    } else {
      this.searchInput.handleInput(keyData);
      this.filterProviders(this.searchInput.getValue());
    }
  }
}
