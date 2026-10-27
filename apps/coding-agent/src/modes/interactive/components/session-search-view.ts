import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import hitFormat from "../../../core/session-search/hit-format.ts";
import type sessionSearchTypes from "../../../core/session-search/session-search.types.ts";
import errors from "../../../utils/errors.ts";
import themeModule from "../theme/theme.ts";
import keybindingHints from "./keybinding-hints.ts";
import scrollWindow from "./scroll-window.ts";
import type sessionSearchViewTypes from "./session-search-view.types.ts";

const { Input, getKeybindings, matchesKey, truncateToWidth, wrapTextWithAnsi } = tui;
const { toErrorMessage } = errors;
const { theme } = themeModule;
const { rawKeyHint } = keybindingHints;
const { fitView } = scrollWindow;
const { hitHeading, hitLocation, skippedLines } = hitFormat;

type Options = sessionSearchViewTypes.SessionSearchViewOptions;

export default class SessionSearchView implements tuiTypes.Component, tuiTypes.Focusable {
  readonly wantsViewportKeys = true;

  private readonly options: Options;

  readonly queryInput = new Input({ placeholder: "Words to find in past sessions", prompt: "› " });

  typing: boolean;

  busy = false;

  error: string | undefined;

  hits: readonly sessionSearchTypes.Hit[] | undefined;

  skipped: readonly sessionSearchTypes.SkippedFile[] = [];

  selected = 0;

  page: sessionSearchViewTypes.OpenPage | undefined;

  private scroll = 0;

  private room = 0;

  private focusedState = false;

  get focused(): boolean {
    return this.focusedState;
  }

  set focused(value: boolean) {
    this.focusedState = value;
    this.queryInput.focused = value && this.typing;
  }

  constructor(options: Options) {
    this.options = options;
    this.queryInput.onSubmit = (value) => this.submit(value);
    this.queryInput.onEscape = () => this.stopTyping();
    const initial = options.initialQuery?.trim() ?? "";
    this.typing = initial === "";
    if (initial !== "") this.submit(initial);
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (this.typing) this.queryInput.handleInput(data);
    else if (this.page === undefined) this.handleListKey(data);
    else this.handlePageKey(data);
    this.options.requestRender();
  }

  private handleListKey(data: string): void {
    const kb = getKeybindings();
    const count = this.hits?.length ?? 0;
    if (kb.matches(data, "tui.select.cancel")) this.options.onClose();
    else if (kb.matches(data, "tui.select.up")) this.selected = Math.max(0, this.selected - 1);
    else if (kb.matches(data, "tui.select.down"))
      this.selected = Math.min(Math.max(0, count - 1), this.selected + 1);
    else if (kb.matches(data, "tui.select.confirm") && !this.busy) this.openSelected();
    else if (matchesKey(data, "/")) this.startTyping();
  }

  private handlePageKey(data: string): void {
    const kb = getKeybindings();
    const page = Math.max(1, this.room - 1);
    if (kb.matches(data, "tui.select.cancel")) {
      this.page = undefined;
      this.scroll = 0;
    } else if (kb.matches(data, "tui.select.up")) this.scroll = Math.max(0, this.scroll - 1);
    else if (kb.matches(data, "tui.select.down")) this.scroll += 1;
    else if (kb.matches(data, "tui.select.pageUp")) this.scroll = Math.max(0, this.scroll - page);
    else if (kb.matches(data, "tui.select.pageDown")) this.scroll += page;
    else if (matchesKey(data, "n") && this.page?.next !== undefined && !this.busy) {
      const { hit, path, next } = this.page;
      this.load(hit, path, next.entry, next.from);
    }
  }

  private startTyping(): void {
    this.typing = true;
    this.queryInput.focused = this.focusedState;
  }

  private stopTyping(): void {
    this.typing = false;
    this.queryInput.focused = false;
    this.options.requestRender();
  }

  private finish(error?: unknown): void {
    this.busy = false;
    this.error = error === undefined ? undefined : toErrorMessage(error);
    this.scroll = 0;
    this.options.requestRender();
  }

  private submit(value: string): void {
    const query = value.trim();
    this.stopTyping();
    if (query === "") return;
    this.queryInput.setValue(query);
    this.busy = true;
    this.page = undefined;
    void this.options.search(query).then(
      ({ hits, skipped }) => {
        this.hits = hits;
        this.skipped = skipped;
        this.selected = 0;
        return this.finish();
      },
      (error: unknown) => this.finish(error),
    );
  }

  private openSelected(): void {
    const hit = this.hits?.[this.selected];
    if (hit?.entryId === null || hit?.entryId === undefined) return;
    this.load(hit, hit.session.path, hit.entryId, 0);
  }

  private load(hit: sessionSearchTypes.Hit, path: string, entry: string, from: number): void {
    this.busy = true;
    void this.options.read({ entry, from, path }).then(
      (page) => {
        this.page =
          page === undefined ? undefined : { hit, next: page.next, path, text: page.text };
        return this.finish(page === undefined ? new Error(`No entry ${entry}`) : undefined);
      },
      (error: unknown) => this.finish(error),
    );
  }

  private listBody(width: number): { body: string[]; cursor: number | undefined } {
    if (this.hits === undefined) return { body: [], cursor: undefined };
    const skipped = skippedLines(this.skipped).map((line) =>
      truncateToWidth(theme.fg("warning", ` ${line}`), width),
    );
    if (this.hits.length === 0) {
      return {
        body: [
          theme.fg("dim", " No matching messages."),
          ...(skipped.length > 0 ? ["", ...skipped] : []),
        ],
        cursor: undefined,
      };
    }
    const hitLines = this.hits.flatMap((hit, index) => {
      const chosen = index === this.selected;
      const heading = `${chosen ? "›" : " "} ${hitHeading(hit)}`;
      return [
        truncateToWidth(chosen ? theme.fg("accent", heading) : heading, width),
        truncateToWidth(theme.fg("dim", `   ${hit.snippet}`), width),
      ];
    });
    const body = [...hitLines, ...(skipped.length > 0 ? ["", ...skipped] : [])];
    return { body, cursor: this.selected * 2 };
  }

  private pageBody(page: sessionSearchViewTypes.OpenPage, width: number): string[] {
    return [
      truncateToWidth(` ${theme.bold(hitHeading(page.hit))}`, width),
      ...hitLocation(page.hit).map((line) => truncateToWidth(theme.fg("dim", ` ${line}`), width)),
      "",
      ...wrapTextWithAnsi(page.text, Math.max(10, width - 2)).map((line) => ` ${line}`),
    ];
  }

  private footer(width: number): string[] {
    if (this.typing) {
      return [
        "",
        ...this.queryInput.render(width),
        ` ${rawKeyHint("enter", "search")}  ${rawKeyHint("esc", "cancel")}`,
      ];
    }
    const hints =
      this.page === undefined
        ? [
            rawKeyHint("enter", "read"),
            rawKeyHint("↑↓", "select"),
            rawKeyHint("/", "new search"),
            rawKeyHint("esc", "close"),
          ]
        : [
            rawKeyHint("↑↓", "scroll"),
            ...(this.page.next === undefined ? [] : [rawKeyHint("n", "next page")]),
            rawKeyHint("esc", "back"),
          ];
    return ["", ` ${hints.join("  ")}`];
  }

  render(width: number): string[] {
    const status = this.busy
      ? [theme.fg("dim", " Searching…")]
      : this.error === undefined
        ? []
        : [theme.fg("error", ` ${this.error}`)];
    const list = this.page === undefined ? this.listBody(width) : undefined;
    const body = [
      ...status,
      ...(list?.body ?? this.pageBody(this.page as sessionSearchViewTypes.OpenPage, width)),
    ];
    const cursor = list?.cursor === undefined ? undefined : list.cursor + status.length;
    const frame = {
      body,
      footer: this.footer(width),
      header: [
        "",
        truncateToWidth(
          ` ${theme.bold("Search sessions")}  ${theme.fg("dim", this.queryInput.getValue())}`,
          width,
        ),
        theme.fg("borderMuted", "─".repeat(width)),
      ],
      ...(cursor === undefined ? {} : { cursorEnd: cursor + 1, cursorLine: cursor }),
    };
    const max = Math.max(8, this.options.maxHeight());
    this.room = Math.max(0, max - frame.header.length - frame.footer.length);
    const fitted = fitView(frame, width, max, cursor === undefined ? this.scroll : 0);
    if (cursor === undefined) this.scroll = fitted.offset;
    return fitted.lines;
  }
}
