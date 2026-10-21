import type altScreenEndIndicatorTypes from "./alt-screen-end-indicator.types.ts";
import type altScreenMouseProtocolTypes from "./alt-screen-mouse-protocol.types.ts";
import type altScreenMouseRouterTypes from "./alt-screen-mouse-router.types.ts";
import altScreenPointerKit from "./alt-screen-pointer-kit.ts";
import type altScreenPointerTypes from "./alt-screen-pointer.types.ts";
import type altScreenScrollbarsTypes from "./alt-screen-scrollbars.types.ts";
import type altScreenSelectionTypes from "./alt-screen-selection.types.ts";
import type tuiComponentTypes from "./tui-component.types.ts";
import WheelScrollAccelerator from "./wheel-scroll.ts";
import type wheelScrollTypes from "./wheel-scroll.types.ts";

const {
  ScrollToEndIndicator,
  altScreenMouseProtocol,
  AltScreenMouseRouter,
  AltScreenScrollbars,
  AltScreenSelection,
} = altScreenPointerKit;

const { rawEventType, shouldPasteOnRightClick } = altScreenMouseProtocol;

const ALT_WHEEL_SCROLL_MULTIPLIER = 5;

export default class AltScreenPointer {
  readonly selection: altScreenSelectionTypes.AltScreenSelection;
  readonly scrollbars: altScreenScrollbarsTypes.AltScreenScrollbars;
  readonly endIndicator: altScreenEndIndicatorTypes.ScrollToEndIndicator;
  private readonly router: altScreenMouseRouterTypes.AltScreenMouseRouter;
  private readonly wheelScroll: wheelScrollTypes.WheelScrollAccelerator;
  private readonly host: altScreenPointerTypes.PointerHost;

  constructor(host: altScreenPointerTypes.PointerHost) {
    this.host = host;
    this.router = new AltScreenMouseRouter(host);
    this.scrollbars = new AltScreenScrollbars(host.view);
    this.endIndicator = new ScrollToEndIndicator(host.scrollToEndIndicator);
    this.wheelScroll = new WheelScrollAccelerator(host.wheelScrollLines);
    this.selection = new AltScreenSelection({
      copyOnSelect: () => host.copyOnSelect(),
      copySelection: () => host.copySelection(),
      dispatchClick: (event, clickCount) => this.dispatchClick(event, clickCount),
      openUrl: host.openUrl,
      view: host.view,
    });
  }

  setWheelScrollLines(lines: wheelScrollTypes.WheelScrollLines): void {
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

  handleWheel(wheelEvent: altScreenMouseProtocolTypes.WheelEvent): void {
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

  handleMouse(raw: altScreenMouseProtocolTypes.SgrMouseEvent): void {
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

  private handleChrome(raw: altScreenMouseProtocolTypes.SgrMouseEvent): boolean {
    if (this.endIndicator.hit(raw)) {
      this.host.scrollToBottom();
      return true;
    }
    const scrollbarHandled = this.scrollbars.handleMouse(raw, () => this.selection.reset());
    if (!this.scrollbars.isDragging) this.scrollbars.updateHover(raw.x, raw.y);
    return scrollbarHandled;
  }

  private handleRightClickPaste(event: altScreenMouseProtocolTypes.SgrMouseEvent): boolean {
    const paste = this.host.onRightClickPaste;
    if (paste === undefined || !shouldPasteOnRightClick(event)) return false;
    try {
      paste();
    } catch {}
    return true;
  }

  private dispatchToTargets(
    event: tuiComponentTypes.TuiMouseEvent,
  ): tuiComponentTypes.TuiMouseDispatchResult | undefined {
    const overlay = this.host.dispatchToOverlay(event);
    return overlay.result ?? (overlay.hit ? undefined : this.router.dispatchToLayout(event));
  }

  private dispatchClick(
    raw: altScreenMouseProtocolTypes.SgrMouseEvent,
    clickCount: number,
  ): boolean | undefined {
    const clickEvent = this.router.mouseEvent("click", raw, { clickCount });
    const result = this.dispatchToTargets(clickEvent);
    return result === undefined ? undefined : this.router.applyResult(clickEvent, result);
  }
}
