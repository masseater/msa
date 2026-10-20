import overlayContains from "./overlay-contains.ts";
import type terminalProtocolTypes from "./terminal-protocol.types.ts";
import tuiComponent from "./tui-component.ts";
import type tuiComponentTypes from "./tui-component.types.ts";
import type tuiInterfaceTypes from "./tui-interface.types.ts";
import type tuiOverlayLayoutTypes from "./tui-overlay-layout.types.ts";
import OverlayStack from "./tui-overlay-stack.ts";
import type tuiOverlayStackTypes from "./tui-overlay-stack.types.ts";

const { containsComponent } = overlayContains;

const { Container, isFocusable } = tuiComponent;

type OverlayFocusRestorePolicy = "clear" | "preserve";

export default abstract class TuiOverlayHost extends Container {
  public terminal: terminalProtocolTypes.Terminal;
  protected stopped = false;
  protected readonly overlays = new OverlayStack(() => this.terminal);
  private focusedComponent: tuiComponentTypes.Component | null = null;

  constructor(terminal: terminalProtocolTypes.Terminal) {
    super();
    this.terminal = terminal;
  }

  abstract requestRender(force?: boolean): void;

  get hasOverlayEntries(): boolean {
    return this.overlays.entries.length > 0;
  }

  getFocusedComponent(): tuiComponentTypes.Component | null {
    return this.focusedComponent;
  }

  setFocus(component: tuiComponentTypes.Component | null): void {
    this.setFocusInternal(component, "clear");
  }

  private setFocusInternal(
    component: tuiComponentTypes.Component | null,
    policy: OverlayFocusRestorePolicy,
  ): void {
    const nextFocus = this.resolveNextFocus(component, policy);
    if (isFocusable(this.focusedComponent)) {
      this.focusedComponent.focused = false;
    }
    this.focusedComponent = nextFocus;
    if (isFocusable(nextFocus)) {
      nextFocus.focused = true;
    }
    const focusedOverlay = this.overlays.findVisible(nextFocus);
    if (focusedOverlay !== undefined) {
      this.overlays.restore = { overlay: focusedOverlay, status: "eligible" };
    }
  }

  private resolveNextFocus(
    component: tuiComponentTypes.Component | null,
    policy: OverlayFocusRestorePolicy,
  ): tuiComponentTypes.Component | null {
    const previousFocus = this.focusedComponent;
    const restoreState = this.overlays.getVisibleRestore();
    if (component === null) {
      if (restoreState.status === "blocked" && restoreState.blockedBy === previousFocus) {
        return this.overlays.resolveBlockedResume(restoreState);
      }
      if (policy === "clear") this.overlays.clearRestore();
      return null;
    }
    if (this.overlays.hasComponent(component)) return component;
    return this.resolveUnderlayFocus(component, previousFocus, restoreState);
  }

  private resolveUnderlayFocus(
    component: tuiComponentTypes.Component,
    previousFocus: tuiComponentTypes.Component | null,
    restoreState: tuiOverlayStackTypes.OverlayFocusRestoreState,
  ): tuiComponentTypes.Component | null {
    if (restoreState.status === "blocked" && restoreState.blockedBy === previousFocus) {
      if (
        restoreState.resume.status === "focus-target" ||
        !this.isComponentMounted(restoreState.blockedBy)
      ) {
        return this.overlays.resolveBlockedResume(restoreState);
      }
      this.overlays.restore = { ...restoreState, blockedBy: component };
      return component;
    }
    const previousFocusedOverlay = this.overlays.findVisible(previousFocus);
    if (
      previousFocusedOverlay !== undefined &&
      restoreState.status !== "inactive" &&
      restoreState.overlay === previousFocusedOverlay &&
      !this.overlays.isFocusAncestor(previousFocusedOverlay, component)
    ) {
      this.overlays.restore = {
        blockedBy: component,
        overlay: previousFocusedOverlay,
        resume: { status: "restore-overlay" },
        status: "blocked",
      };
    }
    return component;
  }

  protected refreshOverlayFocus(): void {
    const focused = this.focusedComponent;
    const focusedOverlay = this.overlays.entries.find((entry) => entry.component === focused);
    if (focusedOverlay !== undefined && !this.overlays.isVisible(focusedOverlay)) {
      const topVisible = this.overlays.getTopmostVisible();
      if (topVisible === undefined) {
        this.setFocusInternal(focusedOverlay.preFocus, "preserve");
      } else {
        this.setFocus(topVisible.component);
      }
    }
    if (!this.overlays.hasComponent(this.focusedComponent)) {
      this.resumeOverlayFocus();
    }
  }

  private resumeOverlayFocus(): void {
    const restoreState = this.overlays.getVisibleRestore();
    if (restoreState.status === "eligible") {
      this.setFocus(restoreState.overlay.component);
      return;
    }
    if (restoreState.status !== "blocked" || restoreState.blockedBy === this.focusedComponent) {
      return;
    }
    if (restoreState.resume.status === "restore-overlay") {
      this.setFocus(restoreState.overlay.component);
    } else {
      this.overlays.clearRestore();
      this.setFocus(restoreState.resume.target);
    }
  }

  protected getMountedRoots(): readonly tuiComponentTypes.Component[] {
    return this.children;
  }

  private isComponentMounted(component: tuiComponentTypes.Component): boolean {
    return this.getMountedRoots().some((child) => containsComponent(child, component));
  }

  showOverlay(
    component: tuiComponentTypes.Component,
    options?: tuiOverlayLayoutTypes.OverlayOptions,
  ): tuiInterfaceTypes.OverlayHandle {
    const entry: tuiOverlayStackTypes.OverlayStackEntry = {
      component,
      focusOrder: this.overlays.nextFocusOrder(),
      hidden: false,
      preFocus: this.focusedComponent,
      ...(options === undefined ? {} : { options }),
    };
    this.overlays.entries.push(entry);
    if (options?.nonCapturing !== true && this.overlays.isVisible(entry)) {
      this.setFocus(component);
    }
    this.hideTerminalCursor();
    this.requestRender();
    return this.overlayHandle(entry);
  }

  private overlayHandle(
    entry: tuiOverlayStackTypes.OverlayStackEntry,
  ): tuiInterfaceTypes.OverlayHandle {
    return {
      focus: () => {
        if (!this.overlays.isLive(entry)) return;
        entry.focusOrder = this.overlays.nextFocusOrder();
        this.setFocus(entry.component);
        this.requestRender();
      },
      getBounds: () => {
        if (!this.overlays.isLive(entry) || entry.bounds === undefined) return undefined;
        return { ...entry.bounds };
      },
      hide: () => this.detachOverlay(entry),
      isFocused: () => this.focusedComponent === entry.component,
      isHidden: () => entry.hidden,
      setHidden: (hidden: boolean) => this.setOverlayEntryHidden(entry, hidden),
      unfocus: (unfocusOptions) => this.unfocusOverlayEntry(entry, unfocusOptions),
    };
  }

  private focusAfterOverlayLeaves(entry: tuiOverlayStackTypes.OverlayStackEntry): void {
    if (this.focusedComponent === entry.component) {
      const topVisible = this.overlays.getTopmostVisible();
      this.setFocus(topVisible?.component ?? entry.preFocus);
    }
  }

  private detachOverlay(entry: tuiOverlayStackTypes.OverlayStackEntry): void {
    if (!this.overlays.remove(entry)) return;
    this.focusAfterOverlayLeaves(entry);
    if (this.overlays.entries.length === 0) this.hideTerminalCursor();
    this.requestRender();
  }

  private setOverlayEntryHidden(
    entry: tuiOverlayStackTypes.OverlayStackEntry,
    hidden: boolean,
  ): void {
    if (entry.hidden === hidden) return;
    entry.hidden = hidden;
    if (hidden) {
      this.overlays.clearRestoreFor(entry);
      this.focusAfterOverlayLeaves(entry);
    } else if (entry.options?.nonCapturing !== true && this.overlays.isVisible(entry)) {
      entry.focusOrder = this.overlays.nextFocusOrder();
      this.setFocus(entry.component);
    }
    this.requestRender();
  }

  private unfocusOverlayEntry(
    entry: tuiOverlayStackTypes.OverlayStackEntry,
    unfocusOptions: tuiInterfaceTypes.OverlayUnfocusOptions | undefined,
  ): void {
    const isFocused = this.focusedComponent === entry.component;
    const restoreState = this.overlays.restore;
    const hasPendingRestore = restoreState.status !== "inactive" && restoreState.overlay === entry;
    if (!isFocused && !hasPendingRestore) return;
    if (
      restoreState.status === "blocked" &&
      restoreState.overlay === entry &&
      this.focusedComponent === restoreState.blockedBy
    ) {
      if (unfocusOptions === undefined) {
        this.overlays.clearRestore();
      } else {
        this.overlays.restore = {
          ...restoreState,
          resume: { status: "focus-target", target: unfocusOptions.target },
        };
      }
      this.requestRender();
      return;
    }
    this.overlays.clearRestoreFor(entry);
    if (isFocused || unfocusOptions !== undefined) {
      const topVisible = this.overlays.getTopmostVisible();
      const fallbackTarget =
        topVisible !== undefined && topVisible !== entry ? topVisible.component : entry.preFocus;
      this.setFocus(unfocusOptions === undefined ? fallbackTarget : unfocusOptions.target);
    }
    this.requestRender();
  }

  hideOverlay(): void {
    const overlay = this.overlays.entries.at(-1);
    if (overlay !== undefined) this.detachOverlay(overlay);
  }

  protected hideTerminalCursor(): void {
    if (!this.stopped) this.terminal.hideCursor();
  }

  hasOverlay(): boolean {
    return this.overlays.entries.some((entry) => this.overlays.isVisible(entry));
  }

  protected isOverlayFocused(): boolean {
    return this.overlays.findVisible(this.focusedComponent) !== undefined;
  }

  protected resolveMouseFocusTarget(
    component: tuiComponentTypes.Component,
  ): tuiComponentTypes.Component {
    const overlay = this.overlays.entries.findLast(
      (entry) => this.overlays.isVisible(entry) && containsComponent(entry.component, component),
    );
    return overlay?.component ?? component;
  }

  protected dispatchMouseToOverlay(event: tuiComponentTypes.TuiMouseEvent): {
    hit: boolean;
    result?: tuiComponentTypes.TuiMouseDispatchResult;
  } {
    return this.overlays.dispatchMouse(event);
  }

  override invalidate(): void {
    for (const root of this.getMountedRoots()) root.invalidate();
    for (const overlay of this.overlays.entries) overlay.component.invalidate();
  }
}
