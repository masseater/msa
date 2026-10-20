import type tuiTypes from "@msa/tui/index.types";

import type keybindingsTypes from "../../../core/keybindings.types.ts";
import type sessionManagerTypes from "../../../core/session-manager.types.ts";
import type sessionListInternalTypes from "./session-list-internal.types.ts";
import type sessionSelectorSearchTypes from "./session-selector-search.types.ts";

export default abstract class SessionListLayer0 {
  protected allSessions: sessionManagerTypes.SessionInfo[] = [];
  filteredSessions: sessionListInternalTypes.FlatSessionNode[] = [];
  selectedIndex: number = 0;
  protected selectionTouched = false;
  protected searchInput!: tuiTypes.Input;
  showCwd = false;
  protected sortMode: sessionSelectorSearchTypes.SortMode = "threaded";
  protected nameFilter: sessionSelectorSearchTypes.NameFilter = "all";
  protected keybindings!: keybindingsTypes.KeybindingsManager;
  showPath = false;
  confirmingDeletePath: string | null = null;
  protected currentSessionCanonicalPath?: string | undefined;
  public onSelect?: (sessionPath: string) => void;
  public onCancel?: () => void;
  public onToggleScope?: () => void;
  public onToggleSort?: () => void;
  public onToggleNameFilter?: () => void;
  public onTogglePath?: (showPath: boolean) => void;
  public onDeleteConfirmationChange?: (path: string | null) => void;
  public onDeleteSession?: (sessionPath: string) => Promise<void>;
  public onRenameSession?: (sessionPath: string) => void;
  public onError?: (message: string) => void;
  maxVisible: number = 10;
  protected focusedState = false;
}
