import { Clock, Effect } from "effect";

import { createMouseEvent, type SgrMouseEvent } from "./alt-screen-mouse-protocol.ts";
import type { AltScreenView } from "./alt-screen-view.ts";
import { getLayoutNode } from "./layout-node.ts";
import { getLayoutBoxesAt } from "./layout.ts";
import {
  type Component,
  Container,
  dispatchMouseEvent,
  retargetMouseEvent,
  type TuiMouseDispatchResult,
  type TuiMouseDispatchTarget,
  type TuiMouseEvent,
} from "./tui-component.ts";

const DOUBLE_CLICK_INTERVAL_MS = 500;

interface ComponentClick {
  timestamp: number;
  count: number;
  component: Component;
  x: number;
  y: number;
}

export interface MouseRouterHost {
  readonly view: AltScreenView;
  resolveFocusTarget(component: Component): Component;
  focusedComponent(): Component | null;
  setFocus(component: Component): void;
}

export class AltScreenMouseRouter {
  private readonly host: MouseRouterHost;
  private capture: TuiMouseDispatchTarget | undefined;
  private pressTarget: TuiMouseDispatchTarget | undefined;
  private pressPoint: { x: number; y: number } | undefined;
  private pressMoved = false;
  private lastComponentClick: ComponentClick | undefined;

  constructor(host: MouseRouterHost) {
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

  startPress(target: TuiMouseDispatchTarget, raw: SgrMouseEvent): void {
    this.pressTarget = target;
    this.pressPoint = { x: raw.x, y: raw.y };
    this.pressMoved = false;
  }

  mouseEvent(
    type: TuiMouseEvent["type"],
    raw: { button: number; x: number; y: number },
    extra: { wheelDelta?: number; clickCount?: number } = {},
  ): TuiMouseEvent {
    const { view } = this.host;
    return createMouseEvent({ type, ...raw, columns: view.columns(), rows: view.rows(), ...extra });
  }

  applyResult(event: TuiMouseEvent, result: TuiMouseDispatchResult): boolean {
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

  dispatchToLayout(event: TuiMouseEvent): TuiMouseDispatchResult | undefined {
    const layout = this.host.view.frame.currentLayout;
    if (layout === undefined) return undefined;
    const visited = new Set<Component>();
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
        x: event.screenX - box.rect.x,
        y: event.screenY - box.rect.y,
        width: box.rect.width,
        height: box.rect.height,
      });
      if (result !== undefined) return result;
    }
    return undefined;
  }

  handleGesture(raw: SgrMouseEvent, event: TuiMouseEvent): void {
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

  private dispatchGestureClick(raw: SgrMouseEvent, target: TuiMouseDispatchTarget): boolean {
    const clickEvent = this.mouseEvent("click", raw, {
      clickCount: this.componentClickCount(target, raw.x, raw.y),
    });
    const clickResult = dispatchMouseEvent(
      target.component,
      retargetMouseEvent(clickEvent, target),
    );
    return clickResult === undefined ? false : this.applyResult(clickEvent, clickResult);
  }

  private componentClickCount(target: TuiMouseDispatchTarget, x: number, y: number): number {
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
    this.lastComponentClick = { timestamp: now, count, component: target.component, x, y };
    return count;
  }
}
