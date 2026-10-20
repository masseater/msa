import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import KeybindingsManager from "../../../core/keybindings-manager.ts";
import type keybindingsTypes from "../../../core/keybindings.types.ts";
import SessionList from "./session-list.ts";
import SessionSelectorHeader from "./session-selector-header.ts";
import type sessionSelectorInternalTypes from "./session-selector-internal.types.ts";
import SessionListWiring from "./session-selector/session-list-wiring.ts";
import SessionLoading from "./session-selector/session-loading.ts";
import SessionRename from "./session-selector/session-rename.ts";

const { Input, getKeybindings } = tui;

export default class SessionSelectorComponent extends tui.Container implements tuiTypes.Focusable {
  readonly loading: SessionLoading;
  readonly rename: SessionRename;
  readonly wiring: SessionListWiring;

  private canRename = true;

  sessionList!: SessionList;

  header!: SessionSelectorHeader;

  keybindings!: keybindingsTypes.KeybindingsManager;

  scope: sessionSelectorInternalTypes.SessionScope = "current";

  requestRender!: () => void;

  renameSession?:
    | ((sessionPath: string, currentName: string | undefined) => Promise<void>)
    | undefined;

  mode: "list" | "rename" = "list";

  renameInput = new Input();

  renameTargetPath: string | null = null;

  private focusedState = false;

  handleInput(data: string): void {
    if (this.mode === "rename") {
      const kb = getKeybindings();
      if (kb.matches(data, "tui.select.cancel")) {
        this.rename.exitRenameMode();
        return;
      }
      this.renameInput.handleInput(data);
      return;
    }

    this.sessionList.handleInput(data);
  }

  get focused(): boolean {
    return this.focusedState;
  }

  set focused(value: boolean) {
    this.focusedState = value;
    this.sessionList.focused = value;
    this.renameInput.focused = value;
    if (value && this.mode === "rename") {
      this.renameInput.focused = true;
    }
  }

  getSessionList(): SessionList {
    return this.sessionList;
  }

  constructor(
    currentSessionsLoader: sessionSelectorInternalTypes.SessionsLoader,
    allSessionsLoader: sessionSelectorInternalTypes.SessionsLoader,
    onSelect: (sessionPath: string) => void,
    onCancel: () => void,
    onExit: () => void,
    requestRender: () => void,
    options?: {
      renameSession?: (sessionPath: string, currentName: string | undefined) => Promise<void>;
      showRenameHint?: boolean;
      keybindings?: keybindingsTypes.KeybindingsManager;
    },
    currentSessionFilePath?: string,
  ) {
    super();
    this.loading = new SessionLoading(this);
    this.rename = new SessionRename(this);
    this.wiring = new SessionListWiring(this);
    this.keybindings = options?.keybindings ?? KeybindingsManager.create();
    this.loading.currentSessionsLoader = currentSessionsLoader;
    this.loading.allSessionsLoader = allSessionsLoader;
    this.requestRender = requestRender;
    this.header = new SessionSelectorHeader(
      this.scope,
      this.wiring.sortMode,
      this.wiring.nameFilter,
      this.requestRender,
    );
    const renameSession = options?.renameSession;
    this.renameSession = renameSession;
    this.canRename = renameSession !== undefined;
    this.header.setShowRenameHint(options?.showRenameHint ?? this.canRename);

    this.sessionList = new SessionList(
      [],
      false,
      this.wiring.sortMode,
      this.wiring.nameFilter,
      this.keybindings,
      currentSessionFilePath,
    );

    const clearStatusMessage = this.wiring.wireSelection(onSelect, onCancel);
    this.wiring.wireListActions(clearStatusMessage, onExit, renameSession);

    this.wiring.wireDeletion();
  }
}
