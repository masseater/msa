import { Clock, Effect } from "effect";

import altScreenMouseProtocol from "./alt-screen-mouse-protocol.ts";
import type altScreenMouseProtocolTypes from "./alt-screen-mouse-protocol.types.ts";
import type altScreenMouseRouterTypes from "./alt-screen-mouse-router.types.ts";
import layoutNode from "./layout-node.ts";
import layoutModule from "./layout.ts";
import tuiComponent from "./tui-component.ts";
import type tuiComponentTypes from "./tui-component.types.ts";

const { createMouseEvent } = altScreenMouseProtocol;
const { getLayoutBoxesAt } = layoutModule;
const { getLayoutNode } = layoutNode;
const { Container, dispatchMouseEvent, retargetMouseEvent } = tuiComponent;

const DOUBLE_CLICK_INTERVAL_MS = 500;

interface ComponentClick {
  timestamp: number;
  count: number;
  component: tuiComponentTypes.Component;
  x: number;
  y: number;
}

export default class AltScreenMouseRouter {
  private readonly host: altScreenMouseRouterTypes.MouseRouterHost;
  private capture: tuiComponentTypes.TuiMouseDispatchTarget | undefined;
  private pressTarget: tuiComponentTypes.TuiMouseDispatchTarget | undefined;
  private pressPoint: { x: number; y: number } | undefined;
  private pressMoved = false;
  private lastComponentClick: ComponentClick | undefined;

  constructor(host: altScreenMouseRouterTypes.MouseRouterHost) {
    this.host = host;
  }

  get hasGesture(): boolean {
    return this.capture !== undefined || this.pressTarget !== undefined;
  }

  clearGesture(): void {
    this.capture = undefined;
    this.pressTarget = undefined;
    this.pressPoint = undefined;
    this.pressMoved = false;
  }

  forgetClick(): void {
    this.lastComponentClick = undefined;
  }

  startPress(
    target: tuiComponentTypes.TuiMouseDispatchTarget,
    raw: altScreenMouseProtocolTypes.SgrMouseEvent,
  ): void {
    this.pressTarget = target;
    this.pressPoint = { x: raw.x, y: raw.y };
    this.pressMoved = false;
  }

  mouseEvent(
    type: tuiComponentTypes.TuiMouseEvent["type"],
    raw: { button: number; x: number; y: number },
    extra: { wheelDelta?: number; clickCount?: number } = {},
  ): tuiComponentTypes.TuiMouseEvent {
    const { view } = this.host;
    return createMouseEvent({ type, ...raw, columns: view.columns(), rows: view.rows(), ...extra });
  }

  applyResult(
    event: tuiComponentTypes.TuiMouseEvent,
    result: tuiComponentTypes.TuiMouseDispatchResult,
  ): boolean {
    const focusTarget = this.host.resolveFocusTarget(result.focusTarget ?? result.target.component);
    const focusChanged = result.focus === true && this.host.focusedComponent() !== focusTarget;
    if (result.focus === true) this.host.setFocus(focusTarget);
    if (result.capture === true) this.capture = result.target;
    return (
      result.render ??
      (focusChanged ||
        event.type === "press" ||
        event.type === "click" ||
        event.type === "drag" ||
        event.type === "wheel")
    );
  }

  dispatchToLayout(
    event: tuiComponentTypes.TuiMouseEvent,
  ): tuiComponentTypes.TuiMouseDispatchResult | undefined {
    const layout = this.host.view.frame.currentLayout;
    if (layout === undefined) return undefined;
    const visited = new Set<tuiComponentTypes.Component>();
    for (const box of getLayoutBoxesAt(layout, event.screenX, event.screenY)) {
      if (visited.has(box.component)) continue;
      if (
        getLayoutNode(box.component) !== undefined &&
        box.component.handleMouse === Container.prototype.handleMouse
      )
        continue;
      visited.add(box.component);
      const result = dispatchMouseEvent(box.component, {
        ...event,
        height: box.rect.height,
        width: box.rect.width,
        x: event.screenX - box.rect.x,
        y: event.screenY - box.rect.y,
      });
      if (result !== undefined) return result;
    }
    return undefined;
  }

  handleGesture(
    raw: altScreenMouseProtocolTypes.SgrMouseEvent,
    event: tuiComponentTypes.TuiMouseEvent,
  ): void {
    const target = this.capture ?? this.pressTarget;
    if (target === undefined) return;
    if (
      this.pressPoint !== undefined &&
      (raw.x !== this.pressPoint.x || raw.y !== this.pressPoint.y)
    ) {
      this.pressMoved = true;
      this.lastComponentClick = undefined;
    }
    let render = false;
    const targetResult = dispatchMouseEvent(target.component, retargetMouseEvent(event, target));
    if (targetResult !== undefined) render = this.applyResult(event, targetResult);
    if (raw.release) {
      if (!this.pressMoved && this.pressPoint?.x === raw.x && this.pressPoint.y === raw.y) {
        render = this.dispatchGestureClick(raw, target) || render;
      }
      this.clearGesture();
    }
    if (render) this.host.view.requestRender();
  }

  private dispatchGestureClick(
    raw: altScreenMouseProtocolTypes.SgrMouseEvent,
    target: tuiComponentTypes.TuiMouseDispatchTarget,
  ): boolean {
    const clickEvent = this.mouseEvent("click", raw, {
      clickCount: this.componentClickCount(target, raw.x, raw.y),
    });
    const clickResult = dispatchMouseEvent(
      target.component,
      retargetMouseEvent(clickEvent, target),
    );
    return clickResult === undefined ? false : this.applyResult(clickEvent, clickResult);
  }

  private componentClickCount(
    target: tuiComponentTypes.TuiMouseDispatchTarget,
    x: number,
    y: number,
  ): number {
    const now = Effect.runSync(Clock.currentTimeMillis);
    const previous = this.lastComponentClick;
    const count =
      previous !== undefined &&
      now - previous.timestamp <= DOUBLE_CLICK_INTERVAL_MS &&
      previous.component === target.component &&
      previous.x === x &&
      previous.y === y
        ? (previous.count % 3) + 1
        : 1;
    this.lastComponentClick = { component: target.component, count, timestamp: now, x, y };
    return count;
  }
}
