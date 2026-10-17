import { performance } from "node:perf_hooks";

import { Effect } from "effect";
import { dual } from "effect/Function";

import { type CancelDelay, runAfter } from "./delay.ts";
import { isKeyRelease, matchesKey } from "./keys.ts";
import { getCapabilities, setCellDimensions } from "./terminal-capabilities.ts";
import {
  parseOscColorResponse,
  parseTerminalColorSchemeReport,
  type RgbColor,
  type TerminalColorScheme,
  type TerminalColors,
} from "./terminal-colors.ts";
import { isImageLine } from "./terminal-image-kitty.ts";
import type { Terminal } from "./terminal.ts";
import { type OverlayOptions, resolveOverlayLayout } from "./tui-overlay-layout.ts";
import {
  extractSegments,
  normalizeTerminalOutput,
  sliceByColumn,
  sliceWithWidth,
  visibleWidth,
} from "./utils.ts";

export type TuiMouseEventType = "press" | "release" | "move" | "drag" | "click" | "wheel";
export type TuiMouseButton = "left" | "middle" | "right" | "none";

export interface TuiMouseEvent {
  type: TuiMouseEventType;
  button: TuiMouseButton;
  x: number;
  y: number;
  screenX: number;
  screenY: number;
  width: number;
  height: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  wheelDelta?: number;
  clickCount?: number;
}

export interface TuiMouseEventResult {
  handled?: boolean;
  capture?: boolean;
  focus?: boolean;
  render?: boolean;
}

export interface TuiMouseDispatchTarget {
  component: Component;
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface TuiMouseDispatchResult extends TuiMouseEventResult {
  handled: true;
  target: TuiMouseDispatchTarget;
  focusTarget?: Component;
}

export const dispatchMouseEvent: {
  (component: Component, event: TuiMouseEvent): TuiMouseDispatchResult | undefined;
  (event: TuiMouseEvent): (component: Component) => TuiMouseDispatchResult | undefined;
} = dual(2, (component: Component, event: TuiMouseEvent): TuiMouseDispatchResult | undefined => {
  const result = component.handleMouse?.(event);
  if (result === undefined) return undefined;
  if ("target" in result) {
    const forwarded = result as TuiMouseDispatchResult;
    return forwarded.focus === true && component.handleInput !== undefined
      ? { ...forwarded, focusTarget: component }
      : forwarded;
  }
  if (result.handled !== true && result.capture !== true && result.focus !== true) return undefined;
  return {
    ...result,
    handled: true,
    ...(result.focus === true ? { focusTarget: component } : {}),
    target: {
      component,
      originX: event.screenX - event.x,
      originY: event.screenY - event.y,
      width: event.width,
      height: event.height,
    },
  };
});

export const retargetMouseEvent: {
  (event: TuiMouseEvent, target: TuiMouseDispatchTarget): TuiMouseEvent;
  (target: TuiMouseDispatchTarget): (event: TuiMouseEvent) => TuiMouseEvent;
} = dual(2, (event: TuiMouseEvent, target: TuiMouseDispatchTarget): TuiMouseEvent => ({
  ...event,
  x: event.screenX - target.originX,
  y: event.screenY - target.originY,
  width: target.width,
  height: target.height,
}));

export interface Component {
  render(width: number): string[];

  handleInput?(data: string): void;

  handleMouse?(event: TuiMouseEvent): TuiMouseEventResult | undefined;

  wantsKeyRelease?: boolean;

  invalidate(): void;
}

export type TuiInputListenerResult = { consume?: boolean; data?: string } | undefined;
export type TuiInputListener = (data: string) => TuiInputListenerResult;
type PendingTerminalColorQuery = {
  foreground?: RgbColor | undefined;
  background?: RgbColor | undefined;
  palette: Array<RgbColor | undefined>;
  replied: Set<string>;
  deliver: ((colors: TerminalColors) => void) | undefined;
  cancelTimeout: CancelDelay | undefined;
};

const TERMINAL_PALETTE_SIZE = 16;
const TERMINAL_COLOR_REPLY_COUNT = 2 + TERMINAL_PALETTE_SIZE;
const TERMINAL_COLOR_QUERY = `\x1b]10;?\x07\x1b]11;?\x07${Array.from(
  { length: TERMINAL_PALETTE_SIZE },
  (_, index) => `\x1b]4;${index};?\x07`,
).join("")}\x1b[c`;
const DEVICE_ATTRIBUTES_BODY = /^\?[\d;]*$/u;
const CELL_SIZE_BODY = /^6;(\d+);(\d+)$/u;

export interface Focusable {
  focused: boolean;
}

export function isFocusable(component: Component | null): component is Component & Focusable {
  return component !== null && "focused" in component;
}

export const CURSOR_MARKER = "\x1b_pi:c\x07";

export const FAKE_CURSOR_START = "\x1b_pi:fc\x07";
export const FAKE_CURSOR_END = "\x1b_pi:/fc\x07";

function unwrapFocusedFakeCursor(line: string): string {
  const marker = `${CURSOR_MARKER}${FAKE_CURSOR_START}`;
  const markerStart = line.indexOf(marker);
  if (markerStart === -1) return line;
  const contentStart = markerStart + marker.length;
  const contentEnd = line.indexOf(FAKE_CURSOR_END, contentStart);
  const content =
    contentEnd === -1 ? line.slice(contentStart) : line.slice(contentStart, contentEnd);
  const rest = contentEnd === -1 ? "" : line.slice(contentEnd + FAKE_CURSOR_END.length);
  return `${line.slice(0, markerStart)}${CURSOR_MARKER}${content}${rest}`;
}

export function renderFakeCursor(text: string): string {
  return `${FAKE_CURSOR_START}${text}${FAKE_CURSOR_END}`;
}

export { visibleWidth };

export type {
  OverlayAnchor,
  OverlayMargin,
  OverlayOptions,
  SizeValue,
} from "./tui-overlay-layout.ts";
import { matchCsiSequence } from "./ansi-sequences.ts";

export interface OverlayUnfocusOptions {
  target: Component | null;
}

export interface OverlayBounds {
  row: number;
  col: number;
  width: number;
  height: number;
}

export interface OverlayHandle {
  hide(): void;
  setHidden(hidden: boolean): void;
  isHidden(): boolean;
  focus(): void;
  unfocus(options?: OverlayUnfocusOptions): void;
  isFocused(): boolean;
  getBounds(): OverlayBounds | undefined;
}

type OverlayStackEntry = {
  component: Component;
  options?: OverlayOptions;
  preFocus: Component | null;
  hidden: boolean;
  focusOrder: number;
  bounds?: OverlayBounds | undefined;
};

type RenderedOverlayLayout = {
  entry: OverlayStackEntry;
  row: number;
  col: number;
  width: number;
  height: number;
};

type OverlayBlockedFocusResume =
  | { status: "restore-overlay" }
  | { status: "focus-target"; target: Component | null };
type EligibleOverlayFocusRestoreState = { status: "eligible"; overlay: OverlayStackEntry };
type BlockedOverlayFocusRestoreState = {
  status: "blocked";
  overlay: OverlayStackEntry;
  blockedBy: Component;
  resume: OverlayBlockedFocusResume;
};
type ActiveOverlayFocusRestoreState =
  | EligibleOverlayFocusRestoreState
  | BlockedOverlayFocusRestoreState;
type OverlayFocusRestoreState = { status: "inactive" } | ActiveOverlayFocusRestoreState;
type OverlayFocusRestorePolicy = "clear" | "preserve";

export class Container implements Component {
  children: Component[] = [];
  private mouseLayout?: {
    width: number;
    children: Array<{ component: Component; height: number }>;
  };

  addChild(component: Component): void {
    this.children.push(component);
  }

  removeChild(component: Component): void {
    const index = this.children.indexOf(component);
    if (index !== -1) {
      this.children.splice(index, 1);
    }
  }

  clear(): void {
    this.children = [];
  }

  invalidate(): void {
    for (const child of this.children) {
      child.invalidate?.();
    }
  }

  handleMouse(event: TuiMouseEvent): TuiMouseDispatchResult | undefined {
    if (event.y < 0 || event.y >= event.height) return undefined;
    const mouseChildren =
      this.mouseLayout?.width === event.width
        ? this.mouseLayout.children
        : this.children.map((component) => ({
            component,
            height: component.render(event.width).length,
          }));
    let childY = 0;
    for (const { component: child, height: childHeight } of mouseChildren) {
      if (event.y >= childY && event.y < childY + childHeight) {
        const result = dispatchMouseEvent(child, {
          ...event,
          y: event.y - childY,
          height: childHeight,
        });
        if (result?.focus === true && (this as Component).handleInput !== undefined)
          return { ...result, focusTarget: this };
        return result;
      }
      childY += childHeight;
    }
    return undefined;
  }

  render(width: number): string[] {
    const lines: string[] = [];
    const mouseChildren: Array<{ component: Component; height: number }> = [];
    for (const child of this.children) {
      const childLines = child.render(width);
      mouseChildren.push({ component: child, height: childLines.length });
      for (const line of childLines) {
        lines.push(line);
      }
    }
    this.mouseLayout = { width, children: mouseChildren };
    return lines;
  }
}

const SEGMENT_RESET = "\x1b[0m\x1b]8;;\x07";

export const compositeTuiLine: {
  (
    baseLine: string,
    overlayLine: string,
    startCol: number,
    overlayWidth: number,
    totalWidth: number,
  ): string;
  (
    overlayLine: string,
    startCol: number,
    overlayWidth: number,
    totalWidth: number,
  ): (baseLine: string) => string;
} = dual(
  5,
  (
    baseLine: string,
    overlayLine: string,
    startCol: number,
    overlayWidth: number,
    totalWidth: number,
  ): string => {
    if (isImageLine(baseLine)) return baseLine;

    const afterStart = startCol + overlayWidth;
    const base = extractSegments(baseLine, startCol, afterStart, totalWidth - afterStart, true);
    const overlay = sliceWithWidth(overlayLine, 0, overlayWidth, true);
    const beforePad = Math.max(0, startCol - base.beforeWidth);
    const overlayPad = Math.max(0, overlayWidth - overlay.width);
    const actualBeforeWidth = Math.max(startCol, base.beforeWidth);
    const actualOverlayWidth = Math.max(overlayWidth, overlay.width);
    const afterTarget = Math.max(0, totalWidth - actualBeforeWidth - actualOverlayWidth);
    const afterPad = Math.max(0, afterTarget - base.afterWidth);
    const result =
      base.before +
      " ".repeat(beforePad) +
      SEGMENT_RESET +
      overlay.text +
      " ".repeat(overlayPad) +
      SEGMENT_RESET +
      base.after +
      " ".repeat(afterPad);

    return visibleWidth(result) <= totalWidth ? result : sliceByColumn(result, 0, totalWidth, true);
  },
);

export type TuiMode = "regular" | "fullscreen";

export interface TuiStopOptions {
  preserveScreen?: boolean;
}

export interface TUI extends Component {
  readonly mode: TuiMode;
  children: Component[];
  terminal: Terminal;
  onDebug?: () => void;
  readonly fullRedraws: number;
  addChild(component: Component): void;
  removeChild(component: Component): void;
  clear(): void;
  getShowHardwareCursor(): boolean;
  setShowHardwareCursor(enabled: boolean): void;
  getClearOnShrink(): boolean;
  setClearOnShrink(enabled: boolean): void;
  setFocus(component: Component | null): void;
  showOverlay(component: Component, options?: OverlayOptions): OverlayHandle;
  hideOverlay(): void;
  hasOverlay(): boolean;
  start(): void;
  stop(options?: TuiStopOptions): void;
  renderNow(force?: boolean): void;
  requestRender(force?: boolean): void;
  addInputListener(listener: TuiInputListener): () => void;
  removeInputListener(listener: TuiInputListener): void;
  onTerminalColorSchemeChange(listener: (scheme: TerminalColorScheme) => void): () => void;
  setTerminalColorSchemeNotifications(enabled: boolean): void;
  queryTerminalColors(options: {
    timeoutMs: number;
    onLateReply?: (colors: TerminalColors) => void;
  }): Promise<TerminalColors>;
}

export const VIEWPORT_TUI = Symbol.for("@msa/tui/viewport");

export interface ViewportTUI extends TUI {
  readonly [VIEWPORT_TUI]: true;
  setLayoutRoot(component: Component | undefined): void;
}

export function isViewportTUI(tui: TUI): tui is ViewportTUI {
  return (tui as Partial<ViewportTUI>)[VIEWPORT_TUI] === true;
}

export abstract class TuiBase extends Container implements TUI {
  abstract readonly mode: TuiMode;
  public terminal: Terminal;
  private focusedComponent: Component | null = null;
  private inputListeners = new Set<TuiInputListener>();

  public onDebug?: () => void;
  private renderRequested = false;
  private immediateRenderScheduled = false;
  private cancelPendingRender: CancelDelay | undefined;
  private lastRenderAt = 0;
  private static readonly MIN_RENDER_INTERVAL_MS = 16;
  private showHardwareCursor = false;
  private clearOnShrink = false;
  protected fullRedrawCount = 0;
  protected stopped = false;
  private pendingTerminalColorQueries: PendingTerminalColorQuery[] = [];
  private terminalColorSchemeListeners = new Set<(scheme: TerminalColorScheme) => void>();
  private terminalColorSchemeNotificationsEnabled = false;
  protected readonly logDirectory: string | undefined;

  private focusOrderCounter = 0;
  private overlayStack: OverlayStackEntry[] = [];
  private renderedOverlayLayouts: RenderedOverlayLayout[] = [];

  get hasOverlayEntries(): boolean {
    return this.overlayStack.length > 0;
  }
  private overlayFocusRestore: OverlayFocusRestoreState = { status: "inactive" };

  constructor(terminal: Terminal, showHardwareCursor?: boolean, logDirectory?: string) {
    super();
    this.terminal = terminal;
    this.logDirectory = logDirectory;
    if (showHardwareCursor !== undefined) {
      this.showHardwareCursor = showHardwareCursor;
    }
  }

  protected abstract doRender(): void;

  protected resetRenderState(): void {}

  protected beforeTerminalStart(): void {}

  protected afterTerminalStart(): void {}

  protected beforeTerminalStop(_options: TuiStopOptions): void {}

  protected afterTerminalStop(_options: TuiStopOptions): void {}

  get fullRedraws(): number {
    return this.fullRedrawCount;
  }

  getShowHardwareCursor(): boolean {
    return this.showHardwareCursor;
  }

  setShowHardwareCursor(enabled: boolean): void {
    if (this.showHardwareCursor === enabled) return;
    this.showHardwareCursor = enabled;
    if (!enabled) {
      this.hideTerminalCursor();
    }
    this.requestRender();
  }

  getClearOnShrink(): boolean {
    return this.clearOnShrink;
  }

  setClearOnShrink(enabled: boolean): void {
    this.clearOnShrink = enabled;
  }

  getFocusedComponent(): Component | null {
    return this.focusedComponent;
  }

  setFocus(component: Component | null): void {
    this.setFocusInternal({ component, overlayFocusRestore: "clear" });
  }

  private setFocusInternal({
    component,
    overlayFocusRestore,
  }: {
    component: Component | null;
    overlayFocusRestore: OverlayFocusRestorePolicy;
  }): void {
    const previousFocus = this.focusedComponent;
    let nextFocus = component;
    const previousFocusedOverlay =
      previousFocus === null
        ? undefined
        : this.overlayStack.find(
            (entry) => entry.component === previousFocus && this.isOverlayVisible(entry),
          );
    const nextFocusIsOverlay =
      nextFocus === null ? false : this.overlayStack.some((entry) => entry.component === nextFocus);
    const restoreState = this.getVisibleOverlayFocusRestore();
    if (nextFocus !== null && !nextFocusIsOverlay) {
      if (restoreState.status === "blocked" && restoreState.blockedBy === previousFocus) {
        if (
          restoreState.resume.status === "focus-target" ||
          !this.isComponentMounted(restoreState.blockedBy)
        ) {
          nextFocus = this.resolveBlockedOverlayFocusResume(restoreState);
        } else {
          this.overlayFocusRestore = {
            status: "blocked",
            overlay: restoreState.overlay,
            blockedBy: nextFocus,
            resume: restoreState.resume,
          };
        }
      } else if (
        previousFocusedOverlay !== undefined &&
        restoreState.status !== "inactive" &&
        restoreState.overlay === previousFocusedOverlay &&
        !this.isOverlayFocusAncestor(previousFocusedOverlay, nextFocus)
      ) {
        this.overlayFocusRestore = {
          status: "blocked",
          overlay: previousFocusedOverlay,
          blockedBy: nextFocus,
          resume: { status: "restore-overlay" },
        };
      }
    } else if (nextFocus === null) {
      if (restoreState.status === "blocked" && restoreState.blockedBy === previousFocus) {
        nextFocus = this.resolveBlockedOverlayFocusResume(restoreState);
      } else if (overlayFocusRestore === "clear") {
        this.clearOverlayFocusRestore();
      }
    }

    if (isFocusable(this.focusedComponent)) {
      this.focusedComponent.focused = false;
    }

    this.focusedComponent = nextFocus;

    if (isFocusable(nextFocus)) {
      nextFocus.focused = true;
    }

    const focusedOverlay =
      nextFocus === null
        ? undefined
        : this.overlayStack.find(
            (entry) => entry.component === nextFocus && this.isOverlayVisible(entry),
          );
    if (focusedOverlay !== undefined) {
      this.overlayFocusRestore = { status: "eligible", overlay: focusedOverlay };
    }
  }

  private clearOverlayFocusRestore(): void {
    this.overlayFocusRestore = { status: "inactive" };
  }

  private clearOverlayFocusRestoreFor(overlay: OverlayStackEntry): void {
    if (
      this.overlayFocusRestore.status !== "inactive" &&
      this.overlayFocusRestore.overlay === overlay
    ) {
      this.clearOverlayFocusRestore();
    }
  }

  private resolveBlockedOverlayFocusResume(
    restoreState: BlockedOverlayFocusRestoreState,
  ): Component | null {
    if (restoreState.resume.status === "restore-overlay") return restoreState.overlay.component;
    this.clearOverlayFocusRestore();
    return restoreState.resume.target;
  }

  private getVisibleOverlayFocusRestore(): OverlayFocusRestoreState {
    const restoreState = this.overlayFocusRestore;
    if (restoreState.status === "inactive") return restoreState;
    if (
      !this.overlayStack.includes(restoreState.overlay) ||
      !this.isOverlayVisible(restoreState.overlay)
    ) {
      return { status: "inactive" };
    }
    return restoreState;
  }

  private isOverlayFocusAncestor(entry: OverlayStackEntry, component: Component): boolean {
    const visited = new Set<Component>();
    let current = entry.preFocus;
    while (current !== null && !visited.has(current)) {
      visited.add(current);
      if (current === component) return true;
      current = this.findOverlayPreFocus(current);
    }
    return false;
  }

  private findOverlayPreFocus(component: Component): Component | null {
    return this.overlayStack.find((overlay) => overlay.component === component)?.preFocus ?? null;
  }

  private retargetOverlayPreFocus(removed: OverlayStackEntry): void {
    for (const overlay of this.overlayStack) {
      if (overlay !== removed && overlay.preFocus === removed.component) {
        overlay.preFocus = removed.preFocus;
      }
    }
  }

  protected getMountedRoots(): readonly Component[] {
    return this.children;
  }

  private isComponentMounted(component: Component): boolean {
    return this.getMountedRoots().some((child) => this.containsComponent(child, component));
  }

  private containsComponent(root: Component, target: Component): boolean {
    if (root === target) return true;
    if (!(root instanceof Container)) return false;
    return root.children.some((child) => this.containsComponent(child, target));
  }

  showOverlay(component: Component, options?: OverlayOptions): OverlayHandle {
    const entry: OverlayStackEntry = {
      component,
      ...(options === undefined ? {} : { options }),
      preFocus: this.focusedComponent,
      hidden: false,
      focusOrder: ++this.focusOrderCounter,
    };
    this.overlayStack.push(entry);
    if (options?.nonCapturing !== true && this.isOverlayVisible(entry)) {
      this.setFocus(component);
    }
    this.hideTerminalCursor();
    this.requestRender();

    return {
      hide: () => this.removeOverlayEntry(entry),
      setHidden: (hidden: boolean) => this.setOverlayEntryHidden(entry, hidden),
      isHidden: () => entry.hidden,
      focus: () => {
        if (!this.overlayStack.includes(entry) || !this.isOverlayVisible(entry)) return;
        entry.focusOrder = ++this.focusOrderCounter;
        this.setFocus(component);
        this.requestRender();
      },
      unfocus: (unfocusOptions) => this.unfocusOverlayEntry(entry, unfocusOptions),
      isFocused: () => this.focusedComponent === component,
      getBounds: () => {
        if (
          !this.overlayStack.includes(entry) ||
          !this.isOverlayVisible(entry) ||
          entry.bounds === undefined
        )
          return undefined;
        return { ...entry.bounds };
      },
    };
  }

  private removeOverlayEntry(entry: OverlayStackEntry): void {
    const index = this.overlayStack.indexOf(entry);
    if (index === -1) return;
    this.clearOverlayFocusRestoreFor(entry);
    this.retargetOverlayPreFocus(entry);
    this.overlayStack.splice(index, 1);
    if (this.focusedComponent === entry.component) {
      const topVisible = this.getTopmostVisibleOverlay();
      this.setFocus(topVisible?.component ?? entry.preFocus);
    }
    if (this.overlayStack.length === 0) this.hideTerminalCursor();
    this.requestRender();
  }

  private setOverlayEntryHidden(entry: OverlayStackEntry, hidden: boolean): void {
    if (entry.hidden === hidden) return;
    entry.hidden = hidden;
    if (hidden) {
      this.clearOverlayFocusRestoreFor(entry);
      if (this.focusedComponent === entry.component) {
        const topVisible = this.getTopmostVisibleOverlay();
        this.setFocus(topVisible?.component ?? entry.preFocus);
      }
    } else if (entry.options?.nonCapturing !== true && this.isOverlayVisible(entry)) {
      entry.focusOrder = ++this.focusOrderCounter;
      this.setFocus(entry.component);
    }
    this.requestRender();
  }

  private unfocusOverlayEntry(
    entry: OverlayStackEntry,
    unfocusOptions: OverlayUnfocusOptions | undefined,
  ): void {
    const isFocused = this.focusedComponent === entry.component;
    const restoreState = this.overlayFocusRestore;
    const hasPendingRestore = restoreState.status !== "inactive" && restoreState.overlay === entry;
    if (!isFocused && !hasPendingRestore) return;
    if (
      restoreState.status === "blocked" &&
      restoreState.overlay === entry &&
      this.focusedComponent === restoreState.blockedBy
    ) {
      if (unfocusOptions === undefined) {
        this.clearOverlayFocusRestore();
      } else {
        this.overlayFocusRestore = {
          status: "blocked",
          overlay: entry,
          blockedBy: restoreState.blockedBy,
          resume: { status: "focus-target", target: unfocusOptions.target },
        };
      }
      this.requestRender();
      return;
    }
    this.clearOverlayFocusRestoreFor(entry);
    if (isFocused || unfocusOptions !== undefined) {
      const topVisible = this.getTopmostVisibleOverlay();
      const fallbackTarget =
        topVisible !== undefined && topVisible !== entry ? topVisible.component : entry.preFocus;
      this.setFocus(unfocusOptions === undefined ? fallbackTarget : unfocusOptions.target);
    }
    this.requestRender();
  }

  hideOverlay(): void {
    const overlay = this.overlayStack[this.overlayStack.length - 1];
    if (overlay === undefined) return;
    this.clearOverlayFocusRestoreFor(overlay);
    this.retargetOverlayPreFocus(overlay);
    this.overlayStack.pop();
    if (this.focusedComponent === overlay.component) {
      const topVisible = this.getTopmostVisibleOverlay();
      this.setFocus(topVisible?.component ?? overlay.preFocus);
    }
    if (this.overlayStack.length === 0) this.hideTerminalCursor();
    this.requestRender();
  }

  private hideTerminalCursor(): void {
    if (!this.stopped) this.terminal.hideCursor();
  }

  hasOverlay(): boolean {
    return this.overlayStack.some((o) => this.isOverlayVisible(o));
  }

  protected isOverlayFocused(): boolean {
    return this.overlayStack.some(
      (entry) => entry.component === this.focusedComponent && this.isOverlayVisible(entry),
    );
  }

  protected resolveMouseFocusTarget(component: Component): Component {
    for (let index = this.overlayStack.length - 1; index >= 0; index--) {
      const overlay = this.overlayStack[index]!;
      if (this.isOverlayVisible(overlay) && this.containsComponent(overlay.component, component)) {
        return overlay.component;
      }
    }
    return component;
  }

  protected dispatchMouseToOverlay(event: TuiMouseEvent): {
    hit: boolean;
    result?: TuiMouseDispatchResult;
  } {
    for (let index = this.renderedOverlayLayouts.length - 1; index >= 0; index--) {
      const layout = this.renderedOverlayLayouts[index]!;
      if (
        event.screenX < layout.col ||
        event.screenX >= layout.col + layout.width ||
        event.screenY < layout.row ||
        event.screenY >= layout.row + layout.height
      ) {
        continue;
      }
      const result = dispatchMouseEvent(layout.entry.component, {
        ...event,
        x: event.screenX - layout.col,
        y: event.screenY - layout.row,
        width: layout.width,
        height: layout.height,
      });
      return result === undefined
        ? { hit: true }
        : {
            hit: true,
            result:
              result.focus === true ? { ...result, focusTarget: layout.entry.component } : result,
          };
    }
    return { hit: false };
  }

  private isOverlayVisible(entry: OverlayStackEntry): boolean {
    if (entry.hidden) return false;
    if (entry.options?.visible !== undefined) {
      return entry.options.visible(this.terminal.columns, this.terminal.rows);
    }
    return true;
  }

  private getTopmostVisibleOverlay(): OverlayStackEntry | undefined {
    let topmost: OverlayStackEntry | undefined;
    for (const overlay of this.overlayStack) {
      if (overlay.options?.nonCapturing === true || !this.isOverlayVisible(overlay)) continue;
      if (topmost === undefined || overlay.focusOrder > topmost.focusOrder) {
        topmost = overlay;
      }
    }
    return topmost;
  }

  override invalidate(): void {
    for (const root of this.getMountedRoots()) root.invalidate();
    for (const overlay of this.overlayStack) overlay.component.invalidate();
  }

  start(): void {
    this.stopped = false;
    this.beforeTerminalStart();
    this.terminal.start(
      (data) => this.handleTerminalInput(data),
      () => this.requestRender(),
    );
    this.afterTerminalStart();
    this.terminal.hideCursor();
    if (this.terminalColorSchemeNotificationsEnabled) {
      this.terminal.write("\x1b[?2031h");
    }
    this.queryCellSize();
    this.requestRender();
  }

  addInputListener(listener: TuiInputListener): () => void {
    this.inputListeners.add(listener);
    return () => {
      this.inputListeners.delete(listener);
    };
  }

  removeInputListener(listener: TuiInputListener): void {
    this.inputListeners.delete(listener);
  }

  onTerminalColorSchemeChange(listener: (scheme: TerminalColorScheme) => void): () => void {
    this.terminalColorSchemeListeners.add(listener);
    return () => {
      this.terminalColorSchemeListeners.delete(listener);
    };
  }

  setTerminalColorSchemeNotifications(enabled: boolean): void {
    if (this.terminalColorSchemeNotificationsEnabled === enabled) {
      return;
    }
    this.terminalColorSchemeNotificationsEnabled = enabled;
    if (!this.stopped) {
      this.terminal.write(enabled ? "\x1b[?2031h" : "\x1b[?2031l");
    }
  }

  private queryCellSize(): void {
    if (getCapabilities().images === null) {
      return;
    }
    this.terminal.write("\x1b[16t");
  }

  stop(options: TuiStopOptions = {}): void {
    this.stopped = true;
    this.cancelRenderTimer();
    if (this.terminalColorSchemeNotificationsEnabled) {
      this.terminal.write("\x1b[?2031l");
    }
    this.beforeTerminalStop(options);
    this.terminal.showCursor();
    this.terminal.stop();
    this.afterTerminalStop(options);
  }

  renderNow(force = false): void {
    if (force) this.resetRenderState();
    this.renderRequested = false;
    this.cancelRenderTimer();
    this.lastRenderAt = performance.now();
    this.doRender();
  }

  requestRender(force = false): void {
    if (force) {
      this.resetRenderState();
      this.requestImmediateRender();
      return;
    }
    if (this.renderRequested) return;
    this.renderRequested = true;
    process.nextTick(() => this.scheduleRender());
  }

  private requestImmediateRender(): void {
    this.cancelRenderTimer();
    this.renderRequested = true;
    if (this.immediateRenderScheduled) return;
    this.immediateRenderScheduled = true;
    process.nextTick(() => {
      this.immediateRenderScheduled = false;
      if (this.stopped || !this.renderRequested) return;
      this.cancelRenderTimer();
      this.renderRequested = false;
      this.lastRenderAt = performance.now();
      this.doRender();
    });
  }

  private cancelRenderTimer(): void {
    if (this.cancelPendingRender === undefined) return;
    this.cancelPendingRender();
    this.cancelPendingRender = undefined;
  }

  private scheduleRender(): void {
    if (this.stopped || this.cancelPendingRender !== undefined || !this.renderRequested) {
      return;
    }
    const elapsed = performance.now() - this.lastRenderAt;
    const delay = Math.max(0, TuiBase.MIN_RENDER_INTERVAL_MS - elapsed);
    this.cancelPendingRender = runAfter(delay, () => {
      this.cancelPendingRender = undefined;
      if (this.stopped || !this.renderRequested) {
        return;
      }
      this.renderRequested = false;
      this.lastRenderAt = performance.now();
      this.doRender();
      if (this.renderRequested) {
        this.scheduleRender();
      }
    });
  }

  private handleTerminalInput(data: string): void {
    if (this.consumeTerminalColorResponse(data)) {
      return;
    }
    if (this.consumeTerminalColorSchemeReport(data)) {
      return;
    }

    if (this.inputListeners.size > 0) {
      let current = data;
      for (const listener of this.inputListeners) {
        const result = listener(current);
        if (result?.consume === true) {
          return;
        }
        if (result?.data !== undefined) {
          current = result.data;
        }
      }
      if (current.length === 0) {
        return;
      }
      data = current;
    }

    if (this.consumeCellSizeResponse(data)) {
      return;
    }

    if (matchesKey(data, "shift+ctrl+d") && this.onDebug !== undefined) {
      this.onDebug();
      return;
    }

    const focusedOverlay = this.overlayStack.find((o) => o.component === this.focusedComponent);
    if (focusedOverlay !== undefined && !this.isOverlayVisible(focusedOverlay)) {
      const topVisible = this.getTopmostVisibleOverlay();
      if (topVisible === undefined) {
        this.setFocusInternal({
          component: focusedOverlay.preFocus,
          overlayFocusRestore: "preserve",
        });
      } else {
        this.setFocus(topVisible.component);
      }
    }

    const focusIsOverlay = this.overlayStack.some((o) => o.component === this.focusedComponent);
    if (!focusIsOverlay) {
      const restoreState = this.getVisibleOverlayFocusRestore();
      if (restoreState.status === "eligible") {
        this.setFocus(restoreState.overlay.component);
      } else if (
        restoreState.status === "blocked" &&
        restoreState.blockedBy !== this.focusedComponent
      ) {
        if (restoreState.resume.status === "restore-overlay") {
          this.setFocus(restoreState.overlay.component);
        } else {
          this.clearOverlayFocusRestore();
          this.setFocus(restoreState.resume.target);
        }
      }
    }

    if (this.focusedComponent?.handleInput !== undefined) {
      if (isKeyRelease(data) && this.focusedComponent.wantsKeyRelease !== true) {
        return;
      }
      this.focusedComponent.handleInput(data);
      this.requestImmediateRender();
    }
  }

  private consumeTerminalColorResponse(data: string): boolean {
    const query = this.pendingTerminalColorQueries[0];
    if (query === undefined) {
      return false;
    }
    if (matchCsiSequence({ data, finals: "c", body: DEVICE_ATTRIBUTES_BODY }) !== null) {
      this.pendingTerminalColorQueries.shift();
      this.completeTerminalColorQuery(query);
      return true;
    }

    const response = parseOscColorResponse(data);
    if (response === undefined) {
      return false;
    }
    const { target, rgb } = response;
    const key = String(target);
    if (query.deliver === undefined || query.replied.has(key)) {
      return true;
    }
    query.replied.add(key);
    if (target === "foreground") {
      query.foreground = rgb;
    } else if (target === "background") {
      query.background = rgb;
    } else if (target < TERMINAL_PALETTE_SIZE) {
      query.palette[target] = rgb;
    }
    if (query.replied.size === TERMINAL_COLOR_REPLY_COUNT) {
      this.completeTerminalColorQuery(query);
    }
    return true;
  }

  private terminalColorQueryResult(query: PendingTerminalColorQuery): TerminalColors {
    const palette = query.palette.every((color) => color !== undefined)
      ? (query.palette as RgbColor[])
      : undefined;
    return { foreground: query.foreground, background: query.background, palette };
  }

  private completeTerminalColorQuery(query: PendingTerminalColorQuery): void {
    const deliver = query.deliver;
    query.deliver = undefined;
    query.cancelTimeout?.();
    deliver?.(this.terminalColorQueryResult(query));
  }

  private consumeTerminalColorSchemeReport(data: string): boolean {
    const scheme = parseTerminalColorSchemeReport(data);
    if (scheme === undefined) {
      return false;
    }

    for (const listener of this.terminalColorSchemeListeners) {
      listener(scheme);
    }
    return true;
  }

  private consumeCellSizeResponse(data: string): boolean {
    const [, height, width] =
      matchCsiSequence({ data, finals: "t", body: CELL_SIZE_BODY })?.groups ?? [];
    if (height === undefined || width === undefined) {
      return false;
    }

    const heightPx = parseInt(height, 10);
    const widthPx = parseInt(width, 10);
    if (heightPx <= 0 || widthPx <= 0) {
      return true;
    }

    setCellDimensions({ widthPx, heightPx });
    this.invalidate();
    this.requestRender();
    return true;
  }

  protected compositeOverlays(lines: string[], termWidth: number, termHeight: number): string[] {
    if (this.overlayStack.length === 0) {
      this.renderedOverlayLayouts = [];
      return lines;
    }
    const result = [...lines];

    for (const entry of this.overlayStack) entry.bounds = undefined;

    const rendered: {
      entry: OverlayStackEntry;
      overlayLines: string[];
      row: number;
      col: number;
      w: number;
    }[] = [];
    let minLinesNeeded = result.length;

    const visibleEntries = this.overlayStack.filter((e) => this.isOverlayVisible(e));
    visibleEntries.sort((a, b) => a.focusOrder - b.focusOrder);
    for (const entry of visibleEntries) {
      const { component, options } = entry;

      const { width, maxHeight } = resolveOverlayLayout(options, 0, termWidth, termHeight);

      let overlayLines = this.resolveFakeCursors(component.render(width));

      if (maxHeight !== undefined && overlayLines.length > maxHeight) {
        overlayLines = overlayLines.slice(0, maxHeight);
      }

      const { row, col } = resolveOverlayLayout(
        options,
        overlayLines.length,
        termWidth,
        termHeight,
      );
      entry.bounds = { row, col, width, height: overlayLines.length };

      rendered.push({ entry, overlayLines, row, col, w: width });
      minLinesNeeded = Math.max(minLinesNeeded, row + overlayLines.length);
    }
    this.renderedOverlayLayouts = rendered.map(({ entry, row, col, w, overlayLines }) => ({
      entry,
      row,
      col,
      width: w,
      height: overlayLines.length,
    }));

    const workingHeight = Math.max(result.length, termHeight, minLinesNeeded);

    while (result.length < workingHeight) {
      result.push("");
    }

    const viewportStart = Math.max(0, workingHeight - termHeight);

    for (const { overlayLines, row, col, w } of rendered) {
      for (const [i, overlayLine] of overlayLines.entries()) {
        const idx = viewportStart + row + i;
        const baseLine = result[idx];
        if (baseLine !== undefined) {
          const truncatedOverlayLine =
            visibleWidth(overlayLine) > w ? sliceByColumn(overlayLine, 0, w, true) : overlayLine;
          result[idx] = this.compositeLineAt(baseLine, truncatedOverlayLine, col, w, termWidth);
        }
      }
    }

    return result;
  }

  protected applyLineResets(lines: string[]): string[] {
    const reset = SEGMENT_RESET;
    for (const [i, line] of lines.entries()) {
      if (!isImageLine(line)) {
        lines[i] = normalizeTerminalOutput(line) + reset;
      }
    }
    return lines;
  }

  private compositeLineAt(
    baseLine: string,
    overlayLine: string,
    startCol: number,
    overlayWidth: number,
    totalWidth: number,
  ): string {
    return compositeTuiLine(baseLine, overlayLine, startCol, overlayWidth, totalWidth);
  }

  protected extractCursorPosition(
    lines: string[],
    height: number,
  ): { row: number; col: number } | null {
    const viewportTop = Math.max(0, lines.length - height);
    for (let row = lines.length - 1; row >= viewportTop; row--) {
      const line = lines[row];
      if (line === undefined) continue;
      const markerIndex = line.indexOf(CURSOR_MARKER);
      if (markerIndex !== -1) {
        const beforeMarker = line.slice(0, markerIndex);
        const col = visibleWidth(beforeMarker);

        lines[row] = line.slice(0, markerIndex) + line.slice(markerIndex + CURSOR_MARKER.length);

        return { row, col };
      }
    }
    return null;
  }

  protected resolveFakeCursors(lines: string[]): string[] {
    return lines.map((line) => {
      if (!line.includes(FAKE_CURSOR_START)) return line;
      const resolved = this.showHardwareCursor ? unwrapFocusedFakeCursor(line) : line;
      return resolved
        .replaceAll(FAKE_CURSOR_START, "\x1b[7m")
        .replaceAll(FAKE_CURSOR_END, "\x1b[27m");
    });
  }

  queryTerminalColors({
    timeoutMs,
    onLateReply,
  }: {
    timeoutMs: number;
    onLateReply?: (colors: TerminalColors) => void;
  }): Promise<TerminalColors> {
    return Effect.runPromise(
      Effect.callback<TerminalColors>((resume) => {
        const resolve = (colors: TerminalColors): void => resume(Effect.succeed(colors));
        const query: PendingTerminalColorQuery = {
          palette: Array.from({ length: TERMINAL_PALETTE_SIZE }, () => undefined),
          replied: new Set(),
          deliver: resolve,
          cancelTimeout: undefined,
        };
        query.cancelTimeout = runAfter(timeoutMs, () => {
          query.deliver = onLateReply;
          resolve(this.terminalColorQueryResult(query));
        });
        this.pendingTerminalColorQueries.push(query);
        this.terminal.write(TERMINAL_COLOR_QUERY);
      }),
    );
  }
}
