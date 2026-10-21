import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import platform from "../../../core/platform/index.ts";
import type platformTypes from "../../../core/platform/index.types.ts";
import paths from "../../../utils/paths.ts";
import themeModule from "../theme/theme.ts";
import keybindingHints from "./keybinding-hints.ts";
import type sessionSelectorSearchTypes from "./session-selector-search.types.ts";

const { schedule } = platform;
const { canonicalizePath: _canonicalizePath } = paths;
const { theme } = themeModule;
const { keyHint } = keybindingHints;
const { truncateToWidth, visibleWidth } = tui;

type SessionScope = "current" | "all";
export default class SessionSelectorHeader implements tuiTypes.Component {
  private scope: SessionScope;
  private sortMode: sessionSelectorSearchTypes.SortMode;
  private nameFilter: sessionSelectorSearchTypes.NameFilter;
  private requestRender: () => void;
  private loading = false;
  private loadProgress: { loaded: number; total: number } | null = null;
  private showPath = false;
  private confirmingDeletePath: string | null = null;
  private statusMessage: { type: "info" | "error"; message: string } | null = null;
  private statusTimeout: platformTypes.Scheduled | null = null;
  private showRenameHint = false;

  constructor(
    scope: SessionScope,
    sortMode: sessionSelectorSearchTypes.SortMode,
    nameFilter: sessionSelectorSearchTypes.NameFilter,
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

  setSortMode(sortMode: sessionSelectorSearchTypes.SortMode): void {
    this.sortMode = sortMode;
  }

  setNameFilter(nameFilter: sessionSelectorSearchTypes.NameFilter): void {
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
    const { sortLabel, leftText } = this.titleAndSortLabel();
    let { scopeText, nameText, sortText }: ReturnType<SessionSelectorHeader["filterSummary"]> =
      this.filterSummary(sortLabel);

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

  private titleAndSortLabel() {
    const title =
      this.scope === "current" ? "Resume Session (Current Folder)" : "Resume Session (All)";
    const leftText = theme.bold(title);

    const sortLabel =
      this.sortMode === "threaded" ? "Threaded" : this.sortMode === "recent" ? "Recent" : "Fuzzy";
    return { leftText, sortLabel };
  }

  private filterSummary(sortLabel: string) {
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
    return { nameText, scopeText, sortText };
  }
}
