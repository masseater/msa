import tui from "@msa/tui";

import type keybindingsTypes from "../../../core/keybindings.types.ts";
import type sessionManagerTypes from "../../../core/session-manager.types.ts";
import SessionList from "./session-list.ts";
import SessionSelectorHeader from "./session-selector-header.ts";
import type sessionSelectorInternalTypes from "./session-selector-internal.types.ts";
import type sessionSelectorSearchTypes from "./session-selector-search.types.ts";

const { Input } = tui;

export default abstract class SessionSelectorComponentLayer0 extends tui.Container {
  protected canRename = true;
  sessionList!: SessionList;
  header!: SessionSelectorHeader;
  keybindings!: keybindingsTypes.KeybindingsManager;
  scope: sessionSelectorInternalTypes.SessionScope = "current";
  protected sortMode: sessionSelectorSearchTypes.SortMode = "threaded";
  protected nameFilter: sessionSelectorSearchTypes.NameFilter = "all";
  currentSessions: sessionManagerTypes.SessionInfo[] | null = null;
  allSessions: sessionManagerTypes.SessionInfo[] | null = null;
  protected currentSessionsLoader!: sessionSelectorInternalTypes.SessionsLoader;
  protected allSessionsLoader!: sessionSelectorInternalTypes.SessionsLoader;
  requestRender!: () => void;
  renameSession?:
    | ((sessionPath: string, currentName: string | undefined) => Promise<void>)
    | undefined;
  currentLoad: AbortController | null = null;
  allLoad: AbortController | null = null;
  protected mode: "list" | "rename" = "list";
  renameInput = new Input();
  protected renameTargetPath: string | null = null;
  protected focusedState = false;
}
