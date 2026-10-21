import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type keybindingsTypes from "../../../core/keybindings.types.ts";
import type sessionManagerTypes from "../../../core/session-manager.types.ts";
import sessionListHelpers from "./session-list-helpers.ts";
import type sessionListInternalTypes from "./session-list-internal.types.ts";
import SessionListInput from "./session-list/session-list-input.ts";
import SessionListRendering from "./session-list/session-list-rendering.ts";
import sessionSelectorSearch from "./session-selector-search.ts";
import type sessionSelectorSearchTypes from "./session-selector-search.types.ts";

const { filterAndSortSessions, hasSessionName } = sessionSelectorSearch;
const { Input } = tui;
const { buildSessionTree, canonicalPathMap, flattenSessionTree } = sessionListHelpers;

export default class SessionList implements tuiTypes.Component, tuiTypes.Focusable {
  readonly rendering: SessionListRendering;
  readonly input: SessionListInput;

  private allSessions: sessionManagerTypes.SessionInfo[] = [];

  filteredSessions: sessionListInternalTypes.FlatSessionNode[] = [];

  selectedIndex: number = 0;

  selectionTouched = false;

  searchInput!: tuiTypes.Input;

  showCwd = false;

  private sortMode: sessionSelectorSearchTypes.SortMode = "threaded";

  nameFilter: sessionSelectorSearchTypes.NameFilter = "all";

  keybindings!: keybindingsTypes.KeybindingsManager;

  showPath = false;

  confirmingDeletePath: string | null = null;

  private currentSessionCanonicalPath?: string | undefined;

  private readonly currentSessionFilePath: string | undefined;

  private canonicalPaths: ReadonlyMap<string, string> = new Map();

  private canonicalGeneration = 0;

  onPathsResolved?: () => void;

  pathsResolved: Promise<void> = Promise.resolve();

  onSelect?: (sessionPath: string) => void;

  onCancel?: () => void;

  onToggleScope?: () => void;

  onToggleSort?: () => void;

  onToggleNameFilter?: () => void;

  onTogglePath?: (showPath: boolean) => void;

  onDeleteConfirmationChange?: (path: string | null) => void;

  onDeleteSession?: (sessionPath: string) => Promise<void>;

  onRenameSession?: (sessionPath: string) => void;

  onError?: (message: string) => void;

  maxVisible: number = 10;

  private focusedState = false;

  getSelectedSessionPath(): string | undefined {
    const selected = this.filteredSessions[this.selectedIndex];
    return selected?.session.path;
  }

  onExit: () => void = () => {};

  get focused(): boolean {
    return this.focusedState;
  }

  set focused(value: boolean) {
    this.focusedState = value;
    this.searchInput.focused = value;
  }

  setSortMode(sortMode: sessionSelectorSearchTypes.SortMode): void {
    this.sortMode = sortMode;
    this.filterSessions(this.searchInput.getValue());
  }

  setNameFilter(nameFilter: sessionSelectorSearchTypes.NameFilter): void {
    this.nameFilter = nameFilter;
    this.filterSessions(this.searchInput.getValue());
  }

  private canonical(path: string): string {
    return this.canonicalPaths.get(path) ?? path;
  }

  private resolveCanonicalPaths(): Promise<void> {
    const generation = ++this.canonicalGeneration;
    const paths = [
      this.currentSessionFilePath,
      ...this.allSessions.flatMap((session) => [session.path, session.parentSessionPath]),
    ];
    return canonicalPathMap(paths).then((canonicalPaths) => {
      if (generation !== this.canonicalGeneration) return;
      this.canonicalPaths = canonicalPaths;
      const current = this.currentSessionFilePath;
      this.currentSessionCanonicalPath =
        current === undefined ? undefined : this.canonical(current);
      this.filterSessions(this.searchInput.getValue());
      this.onPathsResolved?.();
      return undefined;
    });
  }

  setSessions(sessions: sessionManagerTypes.SessionInfo[], showCwd: boolean): void {
    const selectedPath = this.selectionTouched ? this.getSelectedSessionPath() : undefined;
    this.allSessions = sessions;
    this.pathsResolved = this.resolveCanonicalPaths();
    this.showCwd = showCwd;
    this.filterSessions(this.searchInput.getValue());
    if (!this.selectionTouched) {
      this.selectedIndex = 0;
    } else if (selectedPath !== undefined && selectedPath !== "") {
      const selectedIndex = this.filteredSessions.findIndex(
        (node) => node.session.path === selectedPath,
      );
      if (selectedIndex >= 0) this.selectedIndex = selectedIndex;
    }
  }

  filterSessions(query: string): void {
    const trimmed = query.trim();
    const nameFiltered =
      this.nameFilter === "all"
        ? this.allSessions
        : this.allSessions.filter((session) => hasSessionName(session));

    if (this.sortMode === "threaded" && trimmed === "") {
      const roots = buildSessionTree(nameFiltered, (path) => this.canonical(path));
      this.filteredSessions = flattenSessionTree(roots);
    } else {
      const filtered = filterAndSortSessions(nameFiltered, query, this.sortMode, "all");
      this.filteredSessions = filtered.map((session) => ({
        ancestorContinues: [],
        depth: 0,
        isLast: true,
        session,
      }));
    }
    this.selectedIndex = Math.min(
      this.selectedIndex,
      Math.max(0, this.filteredSessions.length - 1),
    );
  }

  isCurrentSessionPath(path: string): boolean {
    if (this.currentSessionCanonicalPath === undefined || this.currentSessionCanonicalPath === "")
      return false;
    return this.canonical(path) === this.currentSessionCanonicalPath;
  }

  invalidate(): void {}

  render(width: number): string[] {
    return this.rendering.render(width);
  }

  handleInput(data: string): void {
    this.input.handleInput(data);
  }

  constructor(
    sessions: sessionManagerTypes.SessionInfo[],
    showCwd: boolean,
    sortMode: sessionSelectorSearchTypes.SortMode,
    nameFilter: sessionSelectorSearchTypes.NameFilter,
    keybindings: keybindingsTypes.KeybindingsManager,
    currentSessionFilePath?: string,
  ) {
    this.rendering = new SessionListRendering(this);
    this.input = new SessionListInput(this);
    this.allSessions = sessions;
    this.filteredSessions = [];
    this.searchInput = new Input();
    this.showCwd = showCwd;
    this.sortMode = sortMode;
    this.nameFilter = nameFilter;
    this.keybindings = keybindings;
    this.currentSessionFilePath = currentSessionFilePath;
    this.currentSessionCanonicalPath = currentSessionFilePath;
    this.filterSessions("");
    this.pathsResolved = this.resolveCanonicalPaths();

    this.searchInput.onSubmit = () => {
      const selected = this.filteredSessions[this.selectedIndex];
      if (selected !== undefined) {
        if (this.onSelect !== undefined) {
          this.onSelect(selected.session.path);
        }
      }
    };
  }
}
