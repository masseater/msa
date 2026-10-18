import type { ApiKeyAuth, AuthCheck, OAuthAuth } from "@msa/ai";
import {
  Container,
  type Focusable,
  fuzzyFilter,
  getKeybindings,
  Input,
  Spacer,
  TruncatedText,
} from "@msa/tui";
import { dual } from "effect/Function";

import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";

export type AuthSelectorProvider = {
  id: string;
  name: string;
  authType: "oauth" | "api_key";
  method?: ApiKeyAuth | OAuthAuth | undefined;
  status?: AuthCheck | undefined;
  subscription?: boolean | undefined;
};

export const formatAuthSelectorProviderType: {
  (subscription?: boolean): (authType: AuthSelectorProvider["authType"]) => string;
  (authType: AuthSelectorProvider["authType"], subscription?: boolean): string;
} = dual(
  (args) => typeof args[0] === "string",
  (authType: AuthSelectorProvider["authType"], subscription?: boolean): string => {
    if (authType === "api_key") return "API key";
    return subscription === false ? "account" : "subscription";
  },
);

export function formatAuthSelectorProviderStatus(provider: AuthSelectorProvider): string {
  if (provider.status === undefined) return theme.fg("muted", " • not configured");
  if (provider.status.type !== provider.authType) {
    const label = `${formatAuthSelectorProviderType(provider.status.type, provider.subscription)} configured`;
    return theme.fg("muted", " • ") + theme.fg("warning", label);
  }
  if (
    provider.status.source === undefined ||
    provider.status.source === "" ||
    provider.status.source === "OAuth" ||
    provider.status.source === "stored credential"
  ) {
    return theme.fg("success", " ✓ configured");
  }
  const source = /^[A-Z][A-Z0-9_]*(?:, [A-Z][A-Z0-9_]*)*$/u.test(provider.status.source)
    ? `env: ${provider.status.source}`
    : provider.status.source;
  return theme.fg("success", ` ✓ ${source}`);
}

export class OAuthSelectorComponent extends Container implements Focusable {
  private searchInput: Input;

  private focusedState = false;
  get focused(): boolean {
    return this.focusedState;
  }
  set focused(value: boolean) {
    this.focusedState = value;
    this.searchInput.focused = value;
  }

  private listContainer: Container;
  private allProviders: AuthSelectorProvider[];
  private filteredProviders: AuthSelectorProvider[];
  private selectedIndex: number = 0;
  private mode: "login" | "logout";
  private onSelectCallback: (
    providerId: string,
    authType: AuthSelectorProvider["authType"],
  ) => void;
  private onCancelCallback: () => void;
  private showAuthTypeLabels: boolean;

  constructor(
    mode: "login" | "logout",
    providers: AuthSelectorProvider[],
    onSelect: (providerId: string, authType: AuthSelectorProvider["authType"]) => void,
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
    return { startIndex, endIndex };
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
