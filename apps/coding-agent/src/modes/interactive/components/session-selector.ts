import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect, FileSystem, Stream } from "effect";
import { ChildProcess } from "effect/process";

import { awaited, awaitingWith, performed } from "../../../core/awaiting.ts";
import { KeybindingsManager } from "../../../core/keybindings.ts";
import { type Scheduled, nowMs, schedule, toDate } from "../../../core/platform.ts";
import type { SessionInfo, SessionListProgress } from "../../../core/session-manager.ts";
import { toErrorMessage } from "../../../utils/errors.ts";
import { canonicalizePath as _canonicalizePath, abbreviateHomePath } from "../../../utils/paths.ts";
import { nodeRuntime } from "../../services.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint, keyText } from "./keybinding-hints.ts";
import {
  type NameFilter,
  type SortMode,
  filterAndSortSessions,
  hasSessionName,
} from "./session-selector-search.ts";

const { Container, Input, Spacer, Text, getKeybindings, truncateToWidth, visibleWidth } = tui;

type SessionScope = "current" | "all";

function formatSessionDate(date: Date): string {
  const now = toDate(nowMs());
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`;
  return `${Math.floor(diffDays / 365)}y`;
}

function canonicalizePath(path: string | undefined): string | undefined {
  if (path === undefined || path === "") return path;
  return _canonicalizePath(path);
}

class SessionSelectorHeader implements tuiTypes.Component {
  private scope: SessionScope;
  private sortMode: SortMode;
  private nameFilter: NameFilter;
  private requestRender: () => void;
  private loading = false;
  private loadProgress: { loaded: number; total: number } | null = null;
  private showPath = false;
  private confirmingDeletePath: string | null = null;
  private statusMessage: { type: "info" | "error"; message: string } | null = null;
  private statusTimeout: Scheduled | null = null;
  private showRenameHint = false;

  constructor(
    scope: SessionScope,
    sortMode: SortMode,
    nameFilter: NameFilter,
    requestRender: () => void,
  ) {
    this.scope = scope;
    this.sortMode = sortMode;
    this.nameFilter = nameFilter;
    this.requestRender = requestRender;
  }

  setScope(scope: SessionScope): void {
    this.scope = scope;
  }

  setSortMode(sortMode: SortMode): void {
    this.sortMode = sortMode;
  }

  setNameFilter(nameFilter: NameFilter): void {
    this.nameFilter = nameFilter;
  }

  setLoading(loading: boolean): void {
    this.loading = loading;
    this.loadProgress = null;
  }

  setProgress(loaded: number, total: number): void {
    this.loadProgress = { loaded, total };
  }

  setShowPath(showPath: boolean): void {
    this.showPath = showPath;
  }

  setShowRenameHint(show: boolean): void {
    this.showRenameHint = show;
  }

  setConfirmingDeletePath(path: string | null): void {
    this.confirmingDeletePath = path;
  }

  private clearStatusTimeout(): void {
    if (this.statusTimeout === null) return;
    this.statusTimeout.cancel();
    this.statusTimeout = null;
  }

  setStatusMessage(
    msg: { type: "info" | "error"; message: string } | null,
    autoHideMs?: number,
  ): void {
    this.clearStatusTimeout();
    this.statusMessage = msg;
    if (msg === null || autoHideMs === undefined || autoHideMs === 0) return;

    this.statusTimeout = schedule(() => {
      this.statusMessage = null;
      this.statusTimeout = null;
      this.requestRender();
    }, autoHideMs);
  }

  invalidate(): void {}

  render(width: number): string[] {
    const title =
      this.scope === "current" ? "Resume Session (Current Folder)" : "Resume Session (All)";
    const leftText = theme.bold(title);

    const sortLabel =
      this.sortMode === "threaded" ? "Threaded" : this.sortMode === "recent" ? "Recent" : "Fuzzy";
    const sortText = theme.fg("muted", "Sort: ") + theme.fg("accent", sortLabel);

    const nameLabel = this.nameFilter === "all" ? "All" : "Named";
    const nameText = theme.fg("muted", "Name: ") + theme.fg("accent", nameLabel);

    let scopeText: string;
    if (this.loading) {
      const progressText =
        this.loadProgress === null
          ? "..."
          : `${this.loadProgress.loaded}/${this.loadProgress.total}`;
      scopeText = `${theme.fg("muted", "○ Current Folder | ")}${theme.fg("accent", `Loading ${progressText}`)}`;
    } else if (this.scope === "current") {
      scopeText = `${theme.fg("accent", "◉ Current Folder")}${theme.fg("muted", " | ○ All")}`;
    } else {
      scopeText = `${theme.fg("muted", "○ Current Folder | ")}${theme.fg("accent", "◉ All")}`;
    }

    const rightText = truncateToWidth(`${scopeText}  ${nameText}  ${sortText}`, width, "");
    const availableLeft = Math.max(0, width - visibleWidth(rightText) - 1);
    const left = truncateToWidth(leftText, availableLeft, "");
    const spacing = Math.max(0, width - visibleWidth(left) - visibleWidth(rightText));

    let hintLine1: string;
    let hintLine2: string;
    if (this.confirmingDeletePath !== null) {
      const confirmHint = `Delete session? ${keyHint("tui.select.confirm", "confirm")} · ${keyHint("tui.select.cancel", "cancel")}`;
      hintLine1 = theme.fg("error", truncateToWidth(confirmHint, width, "…"));
      hintLine2 = "";
    } else if (this.statusMessage === null) {
      const pathState = this.showPath ? "(on)" : "(off)";
      const sep = theme.fg("muted", " · ");
      const hint1 =
        keyHint("tui.input.tab", "scope") +
        sep +
        theme.fg("muted", 're:<pattern> regex · "phrase" exact');
      const hint2Parts = [
        keyHint("app.session.toggleSort", "sort"),
        keyHint("app.session.toggleNamedFilter", "named"),
        keyHint("app.session.delete", "delete"),
        keyHint("app.session.togglePath", `path ${pathState}`),
      ];
      if (this.showRenameHint) {
        hint2Parts.push(keyHint("app.session.rename", "rename"));
      }
      const hint2 = hint2Parts.join(sep);
      hintLine1 = truncateToWidth(hint1, width, "…");
      hintLine2 = truncateToWidth(hint2, width, "…");
    } else {
      const color = this.statusMessage.type === "error" ? "error" : "accent";
      hintLine1 = theme.fg(color, truncateToWidth(this.statusMessage.message, width, "…"));
      hintLine2 = "";
    }

    return [`${left}${" ".repeat(spacing)}${rightText}`, hintLine1, hintLine2];
  }
}

interface SessionTreeNode {
  session: SessionInfo;
  children: SessionTreeNode[];
  latestActivity: number;
}

interface FlatSessionNode {
  session: SessionInfo;
  depth: number;
  isLast: boolean;
  ancestorContinues: boolean[];
}

function buildSessionTree(sessions: SessionInfo[]): SessionTreeNode[] {
  const byPath = new Map<string, SessionTreeNode>();

  for (const session of sessions) {
    const sessionPath = canonicalizePath(session.path) ?? session.path;
    byPath.set(sessionPath, { children: [], latestActivity: session.modified.getTime(), session });
  }

  const roots: SessionTreeNode[] = [];

  for (const session of sessions) {
    const sessionPath = canonicalizePath(session.path) ?? session.path;
    const node = byPath.get(sessionPath)!;
    const parentPath = canonicalizePath(session.parentSessionPath);

    if (parentPath !== undefined && parentPath !== "" && byPath.has(parentPath)) {
      byPath.get(parentPath)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const updateLatestActivity = (node: SessionTreeNode): number => {
    let latestActivity = node.session.modified.getTime();
    for (const child of node.children) {
      latestActivity = Math.max(latestActivity, updateLatestActivity(child));
    }
    node.latestActivity = latestActivity;
    return latestActivity;
  };

  for (const root of roots) {
    updateLatestActivity(root);
  }

  const sortNodes = (nodes: SessionTreeNode[]): void => {
    nodes.sort((a, b) => b.latestActivity - a.latestActivity);
    for (const node of nodes) {
      sortNodes(node.children);
    }
  };
  sortNodes(roots);

  return roots;
}

function flattenSessionTree(roots: SessionTreeNode[]): FlatSessionNode[] {
  const result: FlatSessionNode[] = [];

  const walk = (
    node: SessionTreeNode,
    depth: number,
    ancestorContinues: boolean[],
    isLast: boolean,
  ): void => {
    result.push({ ancestorContinues, depth, isLast, session: node.session });

    for (let i = 0; i < node.children.length; i++) {
      const childIsLast = i === node.children.length - 1;
      const continues = depth > 0 ? !isLast : false;
      walk(node.children[i]!, depth + 1, [...ancestorContinues, continues], childIsLast);
    }
  };

  for (let i = 0; i < roots.length; i++) {
    walk(roots[i]!, 0, [], i === roots.length - 1);
  }

  return result;
}

class SessionList implements tuiTypes.Component, tuiTypes.Focusable {
  public getSelectedSessionPath(): string | undefined {
    const selected = this.filteredSessions[this.selectedIndex];
    return selected?.session.path;
  }
  private allSessions: SessionInfo[] = [];
  private filteredSessions: FlatSessionNode[] = [];
  private selectedIndex: number = 0;
  private selectionTouched = false;
  private searchInput: tuiTypes.Input;
  private showCwd = false;
  private sortMode: SortMode = "threaded";
  private nameFilter: NameFilter = "all";
  private keybindings: KeybindingsManager;
  private showPath = false;
  private confirmingDeletePath: string | null = null;
  private currentSessionCanonicalPath?: string | undefined;
  public onSelect?: (sessionPath: string) => void;
  public onCancel?: () => void;
  public onExit: () => void = () => {};
  public onToggleScope?: () => void;
  public onToggleSort?: () => void;
  public onToggleNameFilter?: () => void;
  public onTogglePath?: (showPath: boolean) => void;
  public onDeleteConfirmationChange?: (path: string | null) => void;
  public onDeleteSession?: (sessionPath: string) => Promise<void>;
  public onRenameSession?: (sessionPath: string) => void;
  public onError?: (message: string) => void;
  private maxVisible: number = 10;

  private focusedState = false;
  get focused(): boolean {
    return this.focusedState;
  }
  set focused(value: boolean) {
    this.focusedState = value;
    this.searchInput.focused = value;
  }

  constructor(
    sessions: SessionInfo[],
    showCwd: boolean,
    sortMode: SortMode,
    nameFilter: NameFilter,
    keybindings: KeybindingsManager,
    currentSessionFilePath?: string,
  ) {
    this.allSessions = sessions;
    this.filteredSessions = [];
    this.searchInput = new Input();
    this.showCwd = showCwd;
    this.sortMode = sortMode;
    this.nameFilter = nameFilter;
    this.keybindings = keybindings;
    this.currentSessionCanonicalPath = canonicalizePath(currentSessionFilePath);
    this.filterSessions("");

    this.searchInput.onSubmit = () => {
      const selected = this.filteredSessions[this.selectedIndex];
      if (selected !== undefined) {
        if (this.onSelect !== undefined) {
          this.onSelect(selected.session.path);
        }
      }
    };
  }

  setSortMode(sortMode: SortMode): void {
    this.sortMode = sortMode;
    this.filterSessions(this.searchInput.getValue());
  }

  setNameFilter(nameFilter: NameFilter): void {
    this.nameFilter = nameFilter;
    this.filterSessions(this.searchInput.getValue());
  }

  setSessions(sessions: SessionInfo[], showCwd: boolean): void {
    const selectedPath = this.selectionTouched ? this.getSelectedSessionPath() : undefined;
    this.allSessions = sessions;
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

  private filterSessions(query: string): void {
    const trimmed = query.trim();
    const nameFiltered =
      this.nameFilter === "all"
        ? this.allSessions
        : this.allSessions.filter((session) => hasSessionName(session));

    if (this.sortMode === "threaded" && trimmed === "") {
      const roots = buildSessionTree(nameFiltered);
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

  private setConfirmingDeletePath(path: string | null): void {
    this.confirmingDeletePath = path;
    this.onDeleteConfirmationChange?.(path);
  }

  private startDeleteConfirmationForSelectedSession(): void {
    const selected = this.filteredSessions[this.selectedIndex];
    if (selected === undefined) return;

    if (this.isCurrentSessionPath(selected.session.path)) {
      this.onError?.("Cannot delete the currently active session");
      return;
    }

    this.setConfirmingDeletePath(selected.session.path);
  }

  private isCurrentSessionPath(path: string): boolean {
    if (this.currentSessionCanonicalPath === undefined || this.currentSessionCanonicalPath === "")
      return false;
    return (canonicalizePath(path) ?? path) === this.currentSessionCanonicalPath;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const lines: string[] = [];

    lines.push(...this.searchInput.render(width));
    lines.push("");

    if (this.filteredSessions.length === 0) {
      let emptyMessage: string;
      if (this.nameFilter === "named") {
        const toggleKey = keyText("app.session.toggleNamedFilter");
        if (this.showCwd) {
          emptyMessage = `  No named sessions found. Press ${toggleKey} to show all.`;
        } else {
          emptyMessage = `  No named sessions in current folder. Press ${toggleKey} to show all, or Tab to view all.`;
        }
      } else if (this.showCwd) {
        emptyMessage = "  No sessions found";
      } else {
        emptyMessage = "  No sessions in current folder. Press Tab to view all.";
      }
      lines.push(theme.fg("muted", truncateToWidth(emptyMessage, width, "…")));
      return lines;
    }

    const { startIndex, endIndex } = SessionList.renderStartIndex(this);

    for (let i = startIndex; i < endIndex; i++) {
      let { isSelected, styledMsg, cursor, prefix, rightPart, isConfirmingDelete } =
        SessionList.renderIsSelected(this, i, width);
      if (isSelected) {
        styledMsg = theme.bold(styledMsg);
      }

      renderPart3(
        cursor,
        prefix,
        styledMsg,
        width,
        rightPart,
        isConfirmingDelete,
        isSelected,
        lines,
      );
    }

    if (startIndex > 0 || endIndex < this.filteredSessions.length) {
      const scrollText = `  (${this.selectedIndex + 1}/${this.filteredSessions.length})`;
      const scrollInfo = theme.fg("muted", truncateToWidth(scrollText, width, ""));
      lines.push(scrollInfo);
    }

    return lines;
  }

  private static renderStartIndex(self: SessionList): { startIndex: number; endIndex: number } {
    const startIndex = Math.max(
      0,
      Math.min(
        self.selectedIndex - Math.floor(self.maxVisible / 2),
        self.filteredSessions.length - self.maxVisible,
      ),
    );
    const endIndex = Math.min(startIndex + self.maxVisible, self.filteredSessions.length);
    return { endIndex, startIndex };
  }

  private static renderIsSelected(
    self: SessionList,
    i: number,
    width: number,
  ): {
    isSelected: boolean;
    styledMsg: string;
    cursor: string;
    prefix: string;
    rightPart: string;
    isConfirmingDelete: boolean;
  } {
    const node = self.filteredSessions[i]!;
    const session = node.session;
    const isSelected = i === self.selectedIndex;
    const isConfirmingDelete = session.path === self.confirmingDeletePath;
    const isCurrent = self.isCurrentSessionPath(session.path);

    const prefix = self.buildTreePrefix(node);

    const hasName = session.name !== undefined && session.name !== "";
    const displayText = session.name ?? session.firstMessage;
    const normalizedMessage = Array.from(displayText, (ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f ? " " : ch;
    })
      .join("")
      .trim();

    const age = formatSessionDate(session.modified);
    const msgCount = String(session.messageCount);
    let rightPart = `${msgCount} ${age}`;
    if (self.showCwd && session.cwd !== "") {
      rightPart = `${abbreviateHomePath(session.cwd)} ${rightPart}`;
    }
    if (self.showPath) {
      rightPart = `${abbreviateHomePath(session.path)} ${rightPart}`;
    }

    const cursor = isSelected ? theme.fg("accent", "› ") : "  ";

    const prefixWidth = visibleWidth(prefix);
    const rightWidth = visibleWidth(rightPart) + 2;
    const availableForMsg = width - 2 - prefixWidth - rightWidth;

    const truncatedMsg = truncateToWidth(normalizedMessage, Math.max(10, availableForMsg), "…");

    let messageColor: "error" | "warning" | "accent" | null = null;
    if (isConfirmingDelete) {
      messageColor = "error";
    } else if (isCurrent) {
      messageColor = "accent";
    } else if (hasName) {
      messageColor = "warning";
    }
    let styledMsg = messageColor === null ? truncatedMsg : theme.fg(messageColor, truncatedMsg);
    return { cursor, isConfirmingDelete, isSelected, prefix, rightPart, styledMsg };
  }

  private buildTreePrefix(node: FlatSessionNode): string {
    if (node.depth === 0) {
      return "";
    }

    const parts = node.ancestorContinues.map((continues) => (continues ? "│  " : "   "));
    const branch = node.isLast ? "└─ " : "├─ ";
    return parts.join("") + branch;
  }

  handleInput(keyData: string): void {
    const kb = getKeybindings();

    if (this.confirmingDeletePath !== null) {
      if (kb.matches(keyData, "tui.select.confirm")) {
        const pathToDelete = this.confirmingDeletePath;
        this.setConfirmingDeletePath(null);
        void this.onDeleteSession?.(pathToDelete);
        return;
      }
      if (kb.matches(keyData, "tui.select.cancel")) {
        this.setConfirmingDeletePath(null);
        return;
      }
      return;
    }

    if (kb.matches(keyData, "tui.input.tab")) {
      if (this.onToggleScope !== undefined) {
        this.onToggleScope();
      }
      return;
    }

    if (kb.matches(keyData, "app.session.toggleSort")) {
      this.onToggleSort?.();
      return;
    }

    if (this.keybindings.matches(keyData, "app.session.toggleNamedFilter")) {
      this.onToggleNameFilter?.();
      return;
    }

    if (kb.matches(keyData, "app.session.togglePath")) {
      this.showPath = !this.showPath;
      this.onTogglePath?.(this.showPath);
      return;
    }

    if (kb.matches(keyData, "app.session.delete")) {
      this.startDeleteConfirmationForSelectedSession();
      return;
    }

    if (kb.matches(keyData, "app.session.rename")) {
      const selected = this.filteredSessions[this.selectedIndex];
      if (selected !== undefined) {
        this.onRenameSession?.(selected.session.path);
      }
      return;
    }

    if (kb.matches(keyData, "app.session.deleteNoninvasive")) {
      if (this.searchInput.getValue().length > 0) {
        this.searchInput.handleInput(keyData);
        this.filterSessions(this.searchInput.getValue());
        return;
      }

      this.startDeleteConfirmationForSelectedSession();
      return;
    }

    this.selectionTouched = true;
    if (kb.matches(keyData, "tui.select.up")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
    } else if (kb.matches(keyData, "tui.select.down")) {
      this.selectedIndex = Math.min(this.filteredSessions.length - 1, this.selectedIndex + 1);
    } else if (kb.matches(keyData, "tui.select.pageUp")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - this.maxVisible);
    } else if (kb.matches(keyData, "tui.select.pageDown")) {
      this.selectedIndex = Math.min(
        this.filteredSessions.length - 1,
        this.selectedIndex + this.maxVisible,
      );
    } else if (kb.matches(keyData, "tui.select.confirm")) {
      const selected = this.filteredSessions[this.selectedIndex];
      if (selected !== undefined && this.onSelect !== undefined) {
        this.onSelect(selected.session.path);
      }
    } else if (kb.matches(keyData, "tui.select.cancel")) {
      if (this.onCancel !== undefined) {
        this.onCancel();
      }
    } else {
      this.searchInput.handleInput(keyData);
      this.filterSessions(this.searchInput.getValue());
    }
  }
}

function renderPart3(
  cursor: string,
  prefix: string,
  styledMsg: string,
  width: number,
  rightPart: string,
  isConfirmingDelete: boolean,
  isSelected: boolean,
  lines: string[],
): void {
  const leftPart = cursor + theme.fg("dim", prefix) + styledMsg;
  const leftWidth = visibleWidth(leftPart);
  const spacing = Math.max(1, width - leftWidth - visibleWidth(rightPart));
  const styledRight = theme.fg(isConfirmingDelete ? "error" : "dim", rightPart);

  let line = leftPart + " ".repeat(spacing) + styledRight;
  if (isSelected) {
    line = theme.bg("selectedBg", line);
  }
  lines.push(truncateToWidth(line, width));
}

type SessionsLoader = (
  onProgress?: SessionListProgress,
  signal?: AbortSignal,
) => Promise<SessionInfo[]>;

function deleteSessionFile(
  sessionPath: string,
): Promise<{ ok: boolean; method: "trash" | "unlink"; error?: string }> {
  return nodeRuntime.runPromise(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const trashArgs = sessionPath.startsWith("-") ? ["--", sessionPath] : [sessionPath];
      const trashResult = yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* ChildProcess.make("trash", trashArgs, {
            stdin: "ignore",
            stdout: "ignore",
          });
          const [stderr, status] = yield* Effect.all(
            [Stream.mkString(Stream.decodeText(handle.stderr)), handle.exitCode],
            { concurrency: 2 },
          );
          return { spawnError: undefined as string | undefined, status, stderr };
        }),
      ).pipe(
        Effect.catch((failure) =>
          Effect.succeed({ spawnError: toErrorMessage(failure), status: -1, stderr: "" }),
        ),
      );

      const getTrashErrorHint = (): string | null => {
        const parts: string[] = [];
        if (trashResult.spawnError !== undefined) {
          parts.push(trashResult.spawnError);
        }
        const stderr = trashResult.stderr.trim();
        if (stderr !== "") {
          parts.push(stderr.split("\n")[0] ?? stderr);
        }
        if (parts.length === 0) return null;
        return `trash: ${parts.join(" · ").slice(0, 200)}`;
      };

      const exists = yield* fileSystem.exists(sessionPath).pipe(Effect.orElseSucceed(() => false));
      if (trashResult.status === 0 || !exists) {
        return { method: "trash" as const, ok: true };
      }

      return yield* fileSystem.remove(sessionPath).pipe(
        Effect.as({ method: "unlink" as const, ok: true }),
        Effect.catch((err) => {
          const unlinkError = toErrorMessage(err);
          const trashErrorHint = getTrashErrorHint();
          const error =
            trashErrorHint !== null && trashErrorHint !== ""
              ? `${unlinkError} (${trashErrorHint})`
              : unlinkError;
          return Effect.succeed({ error, method: "unlink" as const, ok: false });
        }),
      );
    }),
  );
}

export class SessionSelectorComponent extends Container implements tuiTypes.Focusable {
  handleInput(data: string): void {
    if (this.mode === "rename") {
      const kb = getKeybindings();
      if (kb.matches(data, "tui.select.cancel")) {
        this.exitRenameMode();
        return;
      }
      this.renameInput.handleInput(data);
      return;
    }

    this.sessionList.handleInput(data);
  }

  private canRename = true;
  private sessionList: SessionList;
  private header: SessionSelectorHeader;
  private keybindings: KeybindingsManager;
  private scope: SessionScope = "current";
  private sortMode: SortMode = "threaded";
  private nameFilter: NameFilter = "all";
  private currentSessions: SessionInfo[] | null = null;
  private allSessions: SessionInfo[] | null = null;
  private currentSessionsLoader: SessionsLoader;
  private allSessionsLoader: SessionsLoader;
  private requestRender: () => void;
  private renameSession?:
    | ((sessionPath: string, currentName: string | undefined) => Promise<void>)
    | undefined;
  private currentLoad: AbortController | null = null;
  private allLoad: AbortController | null = null;

  private mode: "list" | "rename" = "list";
  private renameInput = new Input();
  private renameTargetPath: string | null = null;

  private focusedState = false;
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

  private buildBaseLayout(content: tuiTypes.Component, options?: { showHeader?: boolean }): void {
    this.clear();
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
    this.addChild(new Spacer(1));
    if (options?.showHeader ?? true) {
      this.addChild(this.header);
      this.addChild(new Spacer(1));
    }
    this.addChild(content);
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
  }

  constructor(
    currentSessionsLoader: SessionsLoader,
    allSessionsLoader: SessionsLoader,
    onSelect: (sessionPath: string) => void,
    onCancel: () => void,
    onExit: () => void,
    requestRender: () => void,
    options?: {
      renameSession?: (sessionPath: string, currentName: string | undefined) => Promise<void>;
      showRenameHint?: boolean;
      keybindings?: KeybindingsManager;
    },
    currentSessionFilePath?: string,
  ) {
    super();
    this.keybindings = options?.keybindings ?? KeybindingsManager.create();
    this.currentSessionsLoader = currentSessionsLoader;
    this.allSessionsLoader = allSessionsLoader;
    this.requestRender = requestRender;
    this.header = new SessionSelectorHeader(
      this.scope,
      this.sortMode,
      this.nameFilter,
      this.requestRender,
    );
    const renameSession = options?.renameSession;
    this.renameSession = renameSession;
    this.canRename = renameSession !== undefined;
    this.header.setShowRenameHint(options?.showRenameHint ?? this.canRename);

    this.sessionList = new SessionList(
      [],
      false,
      this.sortMode,
      this.nameFilter,
      this.keybindings,
      currentSessionFilePath,
    );

    const clearStatusMessage = SessionSelectorComponent.buildClearStatusMessage(
      this,
      onSelect,
      onCancel,
    );
    SessionSelectorComponent.buildPart2(this, clearStatusMessage, onExit, renameSession);

    this.sessionList.onDeleteSession = (sessionPath: string) =>
      Effect.runPromise(
        awaitingWith(function* () {
          const result = yield* awaited(deleteSessionFile(sessionPath));

          if (result.ok) {
            if (this.currentSessions !== null) {
              this.currentSessions = this.currentSessions.filter((s) => s.path !== sessionPath);
            }
            if (this.allSessions !== null) {
              this.allSessions = this.allSessions.filter((s) => s.path !== sessionPath);
            }

            const sessions =
              this.scope === "all" ? (this.allSessions ?? []) : (this.currentSessions ?? []);
            const showCwd = this.scope === "all";
            this.sessionList.setSessions(sessions, showCwd);

            const msg = result.method === "trash" ? "Session moved to trash" : "Session deleted";
            this.header.setStatusMessage({ message: msg, type: "info" }, 2000);
            yield* performed(this.refreshSessionsAfterMutation());
          } else {
            const errorMessage = result.error ?? "Unknown error";
            this.header.setStatusMessage(
              { message: `Failed to delete: ${errorMessage}`, type: "error" },
              3000,
            );
          }

          this.requestRender();
        }, this),
      );

    void Effect.runFork(this.loadScope("current"));
  }

  private static buildClearStatusMessage(
    self: SessionSelectorComponent,
    onSelect: (sessionPath: string) => void,
    onCancel: () => void,
  ): () => void {
    self.buildBaseLayout(self.sessionList);

    self.renameInput.onSubmit = (value) => {
      void Effect.runFork(self.confirmRename(value));
    };

    const clearStatusMessage = () => self.header.setStatusMessage(null);
    self.sessionList.onSelect = (sessionPath) => {
      clearStatusMessage();
      self.cancelLoads();
      onSelect(sessionPath);
    };
    self.sessionList.onCancel = () => {
      clearStatusMessage();
      self.cancelLoads();
      onCancel();
    };
    return clearStatusMessage;
  }

  private static buildPart2(
    self: SessionSelectorComponent,
    clearStatusMessage: () => void,
    onExit: () => void,
    renameSession:
      | ((sessionPath: string, currentName: string | undefined) => Promise<void>)
      | undefined,
  ): void {
    self.sessionList.onExit = () => {
      clearStatusMessage();
      self.cancelLoads();
      onExit();
    };
    self.sessionList.onToggleScope = () => self.toggleScope();
    self.sessionList.onToggleSort = () => self.toggleSortMode();
    self.sessionList.onToggleNameFilter = () => self.toggleNameFilter();
    self.sessionList.onRenameSession = (sessionPath) => {
      if (renameSession === undefined) return;
      if ((self.scope === "current" ? self.currentLoad : self.allLoad) !== null) return;

      const sessions =
        self.scope === "all" ? (self.allSessions ?? []) : (self.currentSessions ?? []);
      const session = sessions.find((s) => s.path === sessionPath);
      self.enterRenameMode(sessionPath, session?.name);
    };

    self.sessionList.onTogglePath = (showPath) => {
      self.header.setShowPath(showPath);
      self.requestRender();
    };
    self.sessionList.onDeleteConfirmationChange = (path) => {
      self.header.setConfirmingDeletePath(path);
      self.requestRender();
    };
    self.sessionList.onError = (msg) => {
      self.header.setStatusMessage({ message: msg, type: "error" }, 3000);
      self.requestRender();
    };
  }

  private cancelLoads(): void {
    if (this.currentLoad !== null) {
      this.currentLoad.abort();
      this.currentLoad = null;
      this.currentSessions = null;
    }
    if (this.allLoad !== null) {
      this.allLoad.abort();
      this.allLoad = null;
      this.allSessions = null;
    }
  }

  private enterRenameMode(sessionPath: string, currentName: string | undefined): void {
    this.mode = "rename";
    this.renameTargetPath = sessionPath;
    this.renameInput.setValue(currentName ?? "");
    this.renameInput.focused = true;

    const panel = new Container();
    panel.addChild(new Text(theme.bold("Rename Session"), 1, 0));
    panel.addChild(new Spacer(1));
    panel.addChild(this.renameInput);
    panel.addChild(new Spacer(1));
    panel.addChild(
      new Text(
        theme.fg(
          "muted",
          `${keyText("tui.select.confirm")} to save · ${keyText("tui.select.cancel")} to cancel`,
        ),
        1,
        0,
      ),
    );

    this.buildBaseLayout(panel, { showHeader: false });
    this.requestRender();
  }

  private exitRenameMode(): void {
    this.mode = "list";
    this.renameTargetPath = null;

    this.buildBaseLayout(this.sessionList);

    this.requestRender();
  }

  private confirmRename(value: string): Effect.Effect<void> {
    return awaitingWith(function* () {
      const next = value.trim();
      if (next === "") return;
      const target = this.renameTargetPath;
      if (target === null || target === "") {
        this.exitRenameMode();
        return;
      }

      const renameSession = this.renameSession;
      if (renameSession === undefined) {
        this.exitRenameMode();
        return;
      }

      try {
        yield* awaited(renameSession(target, next));
        yield* performed(this.refreshSessionsAfterMutation());
      } finally {
        this.exitRenameMode();
      }
    }, this);
  }

  private loadScope(scope: SessionScope): Effect.Effect<void> {
    return awaitingWith(function* () {
      if ((scope === "current" ? this.currentLoad : this.allLoad) !== null) return;

      const { onProgress, controller, isActive, showCwd } =
        SessionSelectorComponent.loadScopeOnProgress(this, scope);

      try {
        const sessions = yield* awaited(
          scope === "current"
            ? this.currentSessionsLoader(onProgress, controller.signal)
            : this.allSessionsLoader(onProgress, controller.signal),
        );
        if (!isActive()) return;

        if (scope === "current") {
          this.currentSessions = sessions;
          this.currentLoad = null;
        } else {
          this.allSessions = sessions;
          this.allLoad = null;
        }

        if (scope !== this.scope) return;
        this.header.setLoading(false);
        this.sessionList.setSessions(sessions, showCwd);
        this.requestRender();
      } catch (err) {
        if (!isActive()) return;
        if (scope === "current") {
          this.currentLoad = null;
          this.currentSessions = null;
        } else {
          this.allLoad = null;
          this.allSessions = null;
        }
        if (scope !== this.scope) return;

        SessionSelectorComponent.loadScopePart2(this, err, showCwd);
      }
    }, this);
  }

  private static loadScopeOnProgress(
    self: SessionSelectorComponent,
    scope: SessionScope,
  ): {
    onProgress: SessionListProgress;
    controller: AbortController;
    isActive: () => boolean;
    showCwd: boolean;
  } {
    const showCwd = scope === "all";
    const controller = new AbortController();
    if (scope === "current") {
      self.currentLoad = controller;
    } else {
      self.allLoad = controller;
    }
    self.header.setScope(scope);
    self.header.setLoading(true);
    self.requestRender();

    const isActive = () => (scope === "current" ? self.currentLoad : self.allLoad) === controller;
    const onProgress: SessionListProgress = (loaded, total, partialSessions) => {
      if (!isActive()) return;
      if (partialSessions !== undefined) {
        const sessions = [...partialSessions];
        if (scope === "current") {
          self.currentSessions = sessions;
        } else {
          self.allSessions = sessions;
        }
        if (scope === self.scope) self.sessionList.setSessions(sessions, showCwd);
      }
      if (scope !== self.scope) return;
      self.header.setProgress(loaded, total);
      self.requestRender();
    };
    return { controller, isActive, onProgress, showCwd };
  }

  private static loadScopePart2(
    self: SessionSelectorComponent,
    err: unknown,
    showCwd: boolean,
  ): void {
    const message = toErrorMessage(err);
    self.header.setLoading(false);
    self.header.setStatusMessage(
      { message: `Failed to load sessions: ${message}`, type: "error" },
      4000,
    );
    self.sessionList.setSessions([], showCwd);
    self.requestRender();
  }

  private toggleSortMode(): void {
    this.sortMode =
      this.sortMode === "threaded"
        ? "recent"
        : this.sortMode === "recent"
          ? "relevance"
          : "threaded";
    this.header.setSortMode(this.sortMode);
    this.sessionList.setSortMode(this.sortMode);
    this.requestRender();
  }

  private toggleNameFilter(): void {
    this.nameFilter = this.nameFilter === "all" ? "named" : "all";
    this.header.setNameFilter(this.nameFilter);
    this.sessionList.setNameFilter(this.nameFilter);
    this.requestRender();
  }

  private refreshSessionsAfterMutation(): Effect.Effect<void> {
    return awaitingWith(function* () {
      this.cancelLoads();
      this.currentSessions = null;
      this.allSessions = null;
      yield* performed(this.loadScope(this.scope));
    }, this);
  }

  private toggleScope(): void {
    this.scope = this.scope === "current" ? "all" : "current";
    const sessions = this.scope === "current" ? this.currentSessions : this.allSessions;
    const loading = (this.scope === "current" ? this.currentLoad : this.allLoad) !== null;
    this.header.setScope(this.scope);
    this.header.setLoading(loading);
    this.sessionList.setSessions(sessions ?? [], this.scope === "all");
    this.requestRender();
    if (sessions === null && !loading) void Effect.runFork(this.loadScope(this.scope));
  }

  getSessionList(): SessionList {
    return this.sessionList;
  }
}
