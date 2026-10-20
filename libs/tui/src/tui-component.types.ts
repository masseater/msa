import type tuiComponent from "./tui-component.ts";

declare namespace tuiComponentTypes {
  type TuiMouseEventType = "press" | "release" | "move" | "drag" | "click" | "wheel";

  type TuiMouseButton = "left" | "middle" | "right" | "none";

  interface TuiMouseEvent {
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

  interface TuiMouseEventResult {
    handled?: boolean;
    capture?: boolean;
    focus?: boolean;
    render?: boolean;
  }

  interface TuiMouseDispatchTarget {
    component: Component;
    originX: number;
    originY: number;
    width: number;
    height: number;
  }

  interface TuiMouseDispatchResult extends TuiMouseEventResult {
    handled: true;
    target: TuiMouseDispatchTarget;
    focusTarget?: Component;
  }

  interface Component {
    render(width: number): string[];

    handleInput?(data: string): void;

    handleMouse?(event: TuiMouseEvent): TuiMouseEventResult | undefined;

    wantsKeyRelease?: boolean;

    wantsViewportKeys?: boolean;

    invalidate(): void;
  }

  interface Focusable {
    focused: boolean;
  }

  type Container = (typeof tuiComponent.Container)["prototype"];
}

export type { tuiComponentTypes as default };
