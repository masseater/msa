import delay from "../delay.ts";
import type delayTypes from "../delay.types.ts";
import layoutNode from "../layout-node.ts";
import type layoutNodeTypes from "../layout-node.types.ts";
import tuiComponent from "../tui-component.ts";
import type tuiComponentTypes from "../tui-component.types.ts";
import type scrollViewTypes from "./scroll-view.types.ts";
const { runAfterUnref } = delay;
const { LAYOUT_NODE } = layoutNode;

export default class ScrollView extends tuiComponent.Container {
  private readonly child: tuiComponentTypes.Component;
  readonly followEnd: boolean;
  readonly primary: boolean;
  readonly overscroll: "chain" | "contain";
  readonly scrollbarTrackStyle: (text: string) => string;
  readonly scrollbarThumbStyle: (text: string) => string;
  private currentScrollbar: scrollViewTypes.ScrollViewScrollbar;
  private readonly scrollbarHideDelayMs: number;
  private currentScrollTop = 0;
  private contentHeight = 0;
  private currentViewportHeight = 0;
  private followingEnd: boolean;
  private followSuppressedAtEnd = false;
  private requestRenderCallback: (() => void) | undefined;
  private transientScrollbarVisible = false;
  private scrollbarActive = false;
  private cancelScrollbarHide: delayTypes.CancelDelay | undefined;

  constructor(
    component: tuiComponentTypes.Component,
    options: scrollViewTypes.ScrollViewOptions = {},
  ) {
    super();
    if (options.axis !== undefined && options.axis !== "vertical") {
      throw new Error(`Unsupported ScrollView axis: ${options.axis}`);
    }
    this.child = component;
    this.children.push(component);
    this.followEnd = (options.follow ?? "none") === "end";
    this.followingEnd = this.followEnd;
    this.primary = options.primary ?? false;
    this.overscroll = options.overscroll ?? "chain";
    this.currentScrollbar = options.scrollbar ?? "hidden";
    this.scrollbarTrackStyle = options.scrollbarTrackStyle ?? ((text) => `\x1b[90m${text}\x1b[39m`);
    this.scrollbarThumbStyle = options.scrollbarThumbStyle ?? ((text) => `\x1b[37m${text}\x1b[39m`);
    this.scrollbarHideDelayMs = Math.max(0, Math.floor(options.scrollbarHideDelayMs ?? 1000));
  }

  get scrollTop(): number {
    return this.currentScrollTop;
  }

  get isFollowingEnd(): boolean {
    return this.followingEnd;
  }

  get viewportHeight(): number {
    return this.currentViewportHeight;
  }

  get scrollbar(): scrollViewTypes.ScrollViewScrollbar {
    return this.currentScrollbar;
  }

  get isScrollbarVisible(): boolean {
    if (this.scrollbar === "always") return this.currentViewportHeight > 0;
    return (
      this.scrollbar === "auto" &&
      this.contentHeight > this.currentViewportHeight &&
      this.transientScrollbarVisible
    );
  }

  get isScrollbarActive(): boolean {
    return this.scrollbarActive;
  }

  setScrollbar(scrollbar: scrollViewTypes.ScrollViewScrollbar): void {
    if (scrollbar === this.currentScrollbar) return;
    this.currentScrollbar = scrollbar;
    if (scrollbar !== "auto") this.hideTransientScrollbar();
    else if (this.scrollbarActive) this.markScrollbarActivity();
    this.requestRenderCallback?.();
  }

  getContentWidth(width: number): number {
    return this.scrollbar === "always" && width > 1 ? width - 1 : width;
  }

  private markScrollbarActivity(): void {
    if (this.scrollbar !== "auto" || this.contentHeight <= this.currentViewportHeight) return;
    this.transientScrollbarVisible = true;
    if (this.cancelScrollbarHide !== undefined) {
      this.cancelScrollbarHide();
      this.cancelScrollbarHide = undefined;
    }
    if (this.scrollbarActive) return;
    this.cancelScrollbarHide = runAfterUnref(this.scrollbarHideDelayMs, () => {
      this.cancelScrollbarHide = undefined;
      this.transientScrollbarVisible = false;
      this.requestRenderCallback?.();
    });
  }

  private hideTransientScrollbar(): void {
    this.transientScrollbarVisible = false;
    if (this.cancelScrollbarHide === undefined) return;
    this.cancelScrollbarHide();
    this.cancelScrollbarHide = undefined;
  }

  setScrollbarActive(active: boolean): void {
    if (active === this.scrollbarActive) return;
    this.scrollbarActive = active;
    this.markScrollbarActivity();
    this.requestRenderCallback?.();
  }

  scrollTo(scrollTop: number, options: scrollViewTypes.ScrollViewScrollToOptions = {}): void {
    const requested = Number.isFinite(scrollTop) ? Math.trunc(scrollTop) : this.currentScrollTop;
    const maxScrollTop = Math.max(0, this.contentHeight - this.currentViewportHeight);
    const next = Math.max(0, Math.min(maxScrollTop, requested));
    const nextFollowSuppressedAtEnd = options.disableFollow === true && next === maxScrollTop;
    const nextFollowingEnd = !nextFollowSuppressedAtEnd && this.followEnd && next === maxScrollTop;
    if (
      next === this.currentScrollTop &&
      nextFollowingEnd === this.followingEnd &&
      nextFollowSuppressedAtEnd === this.followSuppressedAtEnd
    ) {
      return;
    }
    const moved = next !== this.currentScrollTop;
    this.currentScrollTop = next;
    this.followingEnd = nextFollowingEnd;
    this.followSuppressedAtEnd = nextFollowSuppressedAtEnd;
    if (moved) this.markScrollbarActivity();
    this.requestRenderCallback?.();
  }

  scrollBy(lines: number): number {
    const requested = Number.isFinite(lines) ? Math.trunc(lines) : 0;
    if (requested === 0) return 0;
    const maxScrollTop = Math.max(0, this.contentHeight - this.currentViewportHeight);
    const start = this.followingEnd ? maxScrollTop : this.currentScrollTop;
    const next = Math.max(0, Math.min(maxScrollTop, start + requested));
    const moved = next - start;
    const wasFollowingEnd = this.followingEnd;
    this.currentScrollTop = next;
    this.followingEnd = this.followEnd && next === maxScrollTop;
    this.followSuppressedAtEnd = false;
    if (moved !== 0) this.markScrollbarActivity();
    if (moved !== 0 || this.followingEnd !== wasFollowingEnd) this.requestRenderCallback?.();
    return requested - moved;
  }

  scrollToStart(): void {
    const changed =
      this.currentScrollTop !== 0 ||
      this.followingEnd !== (this.followEnd && this.contentHeight <= this.currentViewportHeight);
    this.currentScrollTop = 0;
    this.followingEnd = this.followEnd && this.contentHeight <= this.currentViewportHeight;
    this.followSuppressedAtEnd = false;
    if (changed) {
      this.markScrollbarActivity();
      this.requestRenderCallback?.();
    }
  }

  scrollToEnd(): void {
    const next = Math.max(0, this.contentHeight - this.currentViewportHeight);
    const changed = this.currentScrollTop !== next || this.followingEnd !== this.followEnd;
    this.currentScrollTop = next;
    this.followingEnd = this.followEnd;
    this.followSuppressedAtEnd = false;
    if (changed) {
      this.markScrollbarActivity();
      this.requestRenderCallback?.();
    }
  }

  updateLayout(contentHeight: number, viewportHeight: number, requestRender: () => void): void {
    this.contentHeight = Math.max(0, Math.floor(contentHeight));
    this.currentViewportHeight = Math.max(0, Math.floor(viewportHeight));
    this.requestRenderCallback = requestRender;
    const maxScrollTop = Math.max(0, this.contentHeight - this.currentViewportHeight);
    if (this.followingEnd) this.currentScrollTop = maxScrollTop;
    else this.currentScrollTop = Math.max(0, Math.min(this.currentScrollTop, maxScrollTop));
    if (this.currentScrollTop < maxScrollTop) this.followSuppressedAtEnd = false;
    if (this.followEnd && this.currentScrollTop === maxScrollTop && !this.followSuppressedAtEnd) {
      this.followingEnd = true;
    }
    if (this.contentHeight <= this.currentViewportHeight) this.hideTransientScrollbar();
  }

  override addChild(_component: tuiComponentTypes.Component): void {
    throw new Error("ScrollView has exactly one child");
  }

  override removeChild(_component: tuiComponentTypes.Component): void {
    throw new Error("ScrollView child cannot be removed");
  }

  override clear(): void {
    throw new Error("ScrollView child cannot be cleared");
  }

  override render(width: number): string[] {
    const contentWidth = this.getContentWidth(width);
    const lines = this.child.render(contentWidth);
    return contentWidth === width ? lines : lines.map((line) => `${line} `);
  }

  [LAYOUT_NODE](): layoutNodeTypes.ScrollLayoutNode {
    return { component: this.child, state: this, type: "scroll" };
  }
}
