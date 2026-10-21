import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type keybindingsTypes from "../../core/keybindings.types.ts";
import AuthUrlComponent from "../../modes/interactive/components/auth-url.ts";
import DynamicBorder from "../../modes/interactive/components/dynamic-border.ts";
import keybindingHints from "../../modes/interactive/components/keybinding-hints.ts";
import themeModule from "../../modes/interactive/theme/theme.ts";
import type themeTypes from "../../modes/interactive/theme/theme.types.ts";
import interop from "../../utils/interop.ts";
import type uiTypes from "./ui.types.ts";
const { getSelectListTheme } = themeModule;
const { callbackPromise } = interop;
const { keyHint } = keybindingHints;
const { Container, Input, SelectList, Spacer, Text, truncateToWidth, visibleWidth } = tuiModule;

function frame(
  theme: themeTypes.Theme,
  title: string,
  body: tuiTypes.Component[],
  footer?: string,
): tuiTypes.Container {
  const container = new Container();
  container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
  container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
  for (const child of body) container.addChild(child);
  if (footer !== undefined && footer !== "") {
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("dim", footer), 1, 0));
  }
  container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
  return container;
}
const MAX_VISIBLE_ITEMS = 12;
export default class McpManagerView
  implements uiTypes.McpUi, tuiTypes.Component, tuiTypes.Focusable
{
  private readonly tui: tuiTypes.TUI;
  private readonly theme: themeTypes.Theme;
  private readonly keybindings: keybindingsTypes.KeybindingsManager;
  private content: tuiTypes.Container;
  private inputHandler: ((data: string) => void) | undefined;
  private inputTarget: tuiTypes.Focusable | undefined;
  private isFocused = false;

  constructor(
    tui: tuiTypes.TUI,
    theme: themeTypes.Theme,
    keybindings: keybindingsTypes.KeybindingsManager,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.content = frame(theme, "MCP servers", [new Text(theme.fg("muted", "Loading…"), 1, 1)]);
  }

  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
    if (this.inputTarget !== undefined) this.inputTarget.focused = value;
  }

  private setContent(
    content: tuiTypes.Container,
    inputHandler?: (data: string) => void,
    inputTarget?: tuiTypes.Focusable,
  ): void {
    if (this.inputTarget !== undefined) this.inputTarget.focused = false;
    this.content = content;
    this.inputHandler = inputHandler;
    this.inputTarget = inputTarget;
    if (this.inputTarget !== undefined) this.inputTarget.focused = this.isFocused;
    this.tui.requestRender();
  }

  menu(
    build: () => uiTypes.McpMenu,
    subscribe?: (listener: () => void) => () => void,
  ): Promise<string | undefined> {
    return callbackPromise((resolve) => {
      let unsubscribe: (() => void) | undefined;
      let settled = false;
      const finish = (value: string | undefined) => {
        if (settled) return;
        settled = true;
        unsubscribe?.();
        resolve(value);
      };
      let selected: string | undefined;
      const render = () => {
        const menu = build();
        const wanted = selected ?? menu.selected;
        const body: tuiTypes.Component[] = [];
        if (menu.details !== undefined && menu.details !== "")
          body.push(new Text(this.theme.fg("muted", menu.details), 1, 0));
        if (menu.error !== undefined && menu.error !== "")
          body.push(new Text(this.theme.fg("error", menu.error), 1, 0));
        body.push(new Spacer(1));
        const footer = `${keyHint("tui.select.confirm", menu.confirmLabel)} • ${keyHint("tui.select.cancel", menu.cancelLabel)}`;
        if (menu.items.length === 0) {
          body.push(new Text(this.theme.fg("muted", menu.empty ?? "Nothing to show."), 1, 0));
          this.setContent(
            frame(this.theme, menu.title, body, keyHint("tui.select.cancel", menu.cancelLabel)),
            (data) => {
              if (this.keybindings.matches(data, "tui.select.cancel")) finish(undefined);
            },
          );
          return;
        }
        const list = new SelectList(
          menu.items,
          Math.min(menu.items.length, MAX_VISIBLE_ITEMS),
          getSelectListTheme(),
        );
        const index = menu.items.findIndex((item) => item.value === wanted);
        if (index !== -1) list.setSelectedIndex(index);
        selected = list.getSelectedItem()?.value;
        list.onSelectionChange = (item) => {
          selected = item.value;
        };
        list.onSelect = (item) => finish(item.value);
        list.onCancel = () => finish(undefined);
        body.push(list);
        this.setContent(frame(this.theme, menu.title, body, footer), (data) =>
          list.handleInput(data),
        );
      };
      render();
      unsubscribe = subscribe?.(() => {
        if (!settled) render();
      });
    });
  }

  status(title: string, message: string, onCancel?: () => void): void {
    const body = [new Spacer(1), new Text(this.theme.fg("muted", message), 1, 0)];
    if (onCancel === undefined) {
      this.setContent(frame(this.theme, title, body));
      return;
    }
    this.setContent(
      frame(this.theme, title, body, keyHint("tui.select.cancel", "cancel")),
      (data) => {
        if (this.keybindings.matches(data, "tui.select.cancel")) onCancel();
      },
    );
  }

  redirectUrl(
    title: string,
    authorizationUrl: string,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    return callbackPromise((resolve) => {
      let settled = false;
      const finish = (value: string | undefined) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      };
      const onAbort = () => finish(undefined);
      if (signal.aborted) {
        finish(undefined);
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      const input = new Input();
      const link = new AuthUrlComponent(this.tui, authorizationUrl);
      const body: tuiTypes.Component[] = this.authUrlPrompt(link, input);
      this.setContent(
        frame(
          this.theme,
          title,
          body,
          `${keyHint("tui.select.confirm", "submit")} • ${keyHint("tui.select.cancel", "cancel")}`,
        ),
        (data) => {
          if (this.keybindings.matches(data, "tui.select.confirm")) {
            const value = input.getValue().trim();
            if (value !== "") finish(value);
            return;
          }
          if (this.keybindings.matches(data, "tui.select.cancel")) {
            finish(undefined);
            return;
          }
          if (this.keybindings.matches(data, "app.message.copy")) {
            void link.copy();
            return;
          }
          input.handleInput(data);
        },
        input,
      );
    });
  }

  private authUrlPrompt(link: AuthUrlComponent, input: tuiTypes.Input): tuiTypes.Component[] {
    return [
      new Spacer(1),
      new Text(
        this.theme.fg("muted", "Approve access in your browser. If it did not open, visit:"),
        1,
        0,
      ),
      link,
      new Spacer(1),
      new Text(
        this.theme.fg(
          "muted",
          "If the browser runs on another machine, paste the URL it was redirected to:",
        ),
        1,
        0,
      ),
      input,
    ];
  }

  handleInput(data: string): void {
    this.inputHandler?.(data);
    this.tui.requestRender();
  }

  render(width: number): string[] {
    return this.content
      .render(width)
      .map((line) => (visibleWidth(line) > width ? truncateToWidth(line, width, "") : line));
  }

  invalidate(): void {
    this.content.invalidate();
  }
}
