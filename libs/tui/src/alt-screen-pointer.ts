import { ScrollToEndIndicator } from "./alt-screen-end-indicator.ts";
import {
  rawEventType,
  type SgrMouseEvent,
  shouldPasteOnRightClick,
  type WheelEvent,
} from "./alt-screen-mouse-protocol.ts";
import { AltScreenMouseRouter, type MouseRouterHost } from "./alt-screen-mouse-router.ts";
import { AltScreenScrollbars } from "./alt-screen-scrollbars.ts";
import type { AltScreenSearchController } from "./alt-screen-search-controller.ts";
import { AltScreenSelection } from "./alt-screen-selection.ts";
import type { TuiMouseDispatchResult, TuiMouseEvent } from "./tui-component.ts";
import { WheelScrollAccelerator, type WheelScrollLines } from "./wheel-scroll.ts";

const ALT_WHEEL_SCROLL_MULTIPLIER = 5;

export interface OverlayDispatch {
  hit: boolean;
  result?: TuiMouseDispatchResult;
}

export interface PointerHost extends MouseRouterHost {
  readonly search: AltScreenSearchController;
  dispatchToOverlay(event: TuiMouseEvent): OverlayDispatch;
  scrollToBottom(): void;
  openUrl: ((url: string) => void) | undefined;
  onRightClickPaste: (() => void) | undefined;
  scrollToEndIndicator: (() => string) | undefined;
  wheelScrollLines: WheelScrollLines;
  copyOnSelect(): boolean;
  copySelection(): void;
}

export class AltScreenPointer {
  readonly selection: AltScreenSelection;
  readonly scrollbars: AltScreenScrollbars;
  readonly endIndicator: ScrollToEndIndicator;
  private readonly router: AltScreenMouseRouter;
  private readonly wheelScroll: WheelScrollAccelerator;
  private readonly host: PointerHost;

  constructor(host: PointerHost) {
    this.host = host;
    this.router = new AltScreenMouseRouter(host);
    this.scrollbars = new AltScreenScrollbars(host.view);
    this.endIndicator = new ScrollToEndIndicator(host.scrollToEndIndicator);
    this.wheelScroll = new WheelScrollAccelerator(host.wheelScrollLines);
    this.selection = new AltScreenSelection({
      view: host.view,
      openUrl: host.openUrl,
      copyOnSelect: () => host.copyOnSelect(),
      copySelection: () => host.copySelection(),
      dispatchClick: (event, clickCount) => this.dispatchClick(event, clickCount),
    });
  }

  setWheelScrollLines(lines: WheelScrollLines): void {
    this.wheelScroll.setLines(lines);
  }

  reset(): void {
    this.selection.reset();
    this.scrollbars.stopHover();
    this.scrollbars.stopDrag();
    this.router.clearGesture();
    this.router.forgetClick();
  }

  stop(): void {
    this.selection.stopPress();
    this.scrollbars.stopHover();
    this.scrollbars.stopDrag();
    this.router.clearGesture();
  }

  focusOut(): void {
    this.selection.focusOut();
    this.scrollbars.stopHover();
    this.scrollbars.stopDrag();
    this.router.clearGesture();
    this.router.forgetClick();
  }

  handleWheel(wheelEvent: WheelEvent): void {
    const lines = this.wheelScroll.next(wheelEvent.direction, performance.now());
    const wheelDelta =
      wheelEvent.direction *
      ((wheelEvent.button & 8) === 0 ? lines : lines * ALT_WHEEL_SCROLL_MULTIPLIER);
    const event = this.router.mouseEvent("wheel", wheelEvent, { wheelDelta });
    const result = this.dispatchToTargets(event);
    if (result !== undefined) {
      if (this.router.applyResult(event, result)) this.host.view.requestRender();
      return;
    }
    this.scrollbars.routeWheel(wheelEvent, wheelDelta);
  }

  handleMouse(raw: SgrMouseEvent): void {
    const type = rawEventType(raw);
    const event = this.router.mouseEvent(type, raw);
    if (this.router.hasGesture) {
      this.router.handleGesture(raw, event);
      return;
    }
    if (this.host.search.handleMouse(raw)) return;

    const overlay = this.host.dispatchToOverlay(event);
    if (overlay.hit) {
      this.scrollbars.stopHover();
    } else if (this.handleChrome(raw)) {
      return;
    }

    const result =
      overlay.result ?? (overlay.hit ? undefined : this.router.dispatchToLayout(event));
    if (result !== undefined) {
      const render = this.router.applyResult(event, result);
      if (type === "press") {
        this.selection.clear();
        this.router.startPress(result.target, raw);
      }
      if (render) this.host.view.requestRender();
      return;
    }

    if (this.handleRightClickPaste(raw)) return;
    this.selection.handleMouse(raw);
  }

  private handleChrome(raw: SgrMouseEvent): boolean {
    if (this.endIndicator.hit(raw)) {
      this.host.scrollToBottom();
      return true;
    }
    const scrollbarHandled = this.scrollbars.handleMouse(raw, () => this.selection.reset());
    if (!this.scrollbars.isDragging) this.scrollbars.updateHover(raw.x, raw.y);
    return scrollbarHandled;
  }

  private handleRightClickPaste(event: SgrMouseEvent): boolean {
    const paste = this.host.onRightClickPaste;
    if (paste === undefined || !shouldPasteOnRightClick(event)) return false;
    try {
      paste();
    } catch {}
    return true;
  }

  private dispatchToTargets(event: TuiMouseEvent): TuiMouseDispatchResult | undefined {
    const overlay = this.host.dispatchToOverlay(event);
    return overlay.result ?? (overlay.hit ? undefined : this.router.dispatchToLayout(event));
  }

  private dispatchClick(raw: SgrMouseEvent, clickCount: number): boolean | undefined {
    const clickEvent = this.router.mouseEvent("click", raw, { clickCount });
    const result = this.dispatchToTargets(clickEvent);
    return result === undefined ? undefined : this.router.applyResult(clickEvent, result);
  }
}
