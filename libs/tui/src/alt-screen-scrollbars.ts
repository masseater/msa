import { isPlainPress, type SgrMouseEvent, type WheelEvent } from "./alt-screen-mouse-protocol.ts";
import type { AltScreenView } from "./alt-screen-view.ts";
import type { ScrollView } from "./components/scroll-view.ts";
import {
  getScrollbarGeometry,
  getScrollViewBox,
  getScrollViewsAt,
  type ScrollbarGeometry,
} from "./layout.ts";

interface ScrollbarDrag {
  scrollView: ScrollView;
  grabOffset: number;
}

interface ScrollbarTarget {
  scrollView: ScrollView;
  geometry: ScrollbarGeometry;
}

interface ScrollbarPointer {
  pointerY: number;
  grabOffset: number;
}

function scrollToPointer(
  scrollView: ScrollView,
  geometry: ScrollbarGeometry,
  { pointerY, grabOffset }: ScrollbarPointer,
): void {
  const maxThumbOffset = geometry.trackHeight - geometry.thumbHeight;
  const thumbOffset = Math.max(
    0,
    Math.min(maxThumbOffset, pointerY - geometry.trackTop - grabOffset),
  );
  const scrollTop =
    maxThumbOffset === 0 ? 0 : Math.round((thumbOffset / maxThumbOffset) * geometry.maxScrollTop);
  scrollView.scrollTo(scrollTop);
}

export class AltScreenScrollbars {
  private readonly view: AltScreenView;
  private drag: ScrollbarDrag | undefined;
  private hover: ScrollView | undefined;

  constructor(view: AltScreenView) {
    this.view = view;
  }

  get isDragging(): boolean {
    return this.drag !== undefined;
  }

  updateHover(x: number, y: number): void {
    this.setHover(this.targetAt(x, y, true)?.scrollView);
  }

  stopHover(): void {
    this.setHover(undefined);
  }

  stopDrag(): void {
    this.drag = undefined;
  }

  routeWheel(event: WheelEvent, delta: number): void {
    const layout = this.view.frame.currentLayout;
    let remaining = delta;
    const seen = new Set<ScrollView>();
    for (const scrollView of layout === undefined
      ? []
      : getScrollViewsAt(layout, event.x, event.y)) {
      seen.add(scrollView);
      remaining = scrollView.scrollBy(remaining);
      if (remaining === 0 || scrollView.overscroll === "contain") break;
    }
    const primary = this.view.primaryScrollView();
    if (remaining !== 0 && !seen.has(primary)) primary.scrollBy(remaining);
    this.updateHover(event.x, event.y);
    this.view.requestRender();
  }

  handleMouse(event: SgrMouseEvent, onGrab: () => void): boolean {
    if (this.drag !== undefined) {
      this.continueDrag(this.drag, event);
      return true;
    }
    if (!isPlainPress(event)) return false;
    const target = this.targetAt(event.x, event.y);
    if (target === undefined) return false;
    onGrab();
    this.setHover(target.scrollView);
    const { geometry } = target;
    const onThumb =
      event.y >= geometry.thumbTop && event.y < geometry.thumbTop + geometry.thumbHeight;
    const grabOffset = onThumb ? event.y - geometry.thumbTop : Math.floor(geometry.thumbHeight / 2);
    if (!onThumb) scrollToPointer(target.scrollView, geometry, { pointerY: event.y, grabOffset });
    this.drag = { scrollView: target.scrollView, grabOffset };
    return true;
  }

  private continueDrag(drag: ScrollbarDrag, event: SgrMouseEvent): void {
    if (event.release) {
      this.stopDrag();
      return;
    }
    const layout = this.view.frame.currentLayout;
    const box = layout === undefined ? undefined : getScrollViewBox(layout, drag.scrollView);
    const geometry = box === undefined ? undefined : getScrollbarGeometry(box);
    if (geometry !== undefined) {
      scrollToPointer(drag.scrollView, geometry, {
        pointerY: event.y,
        grabOffset: drag.grabOffset,
      });
    }
  }

  private setHover(scrollView: ScrollView | undefined): void {
    if (scrollView === this.hover) return;
    this.hover?.setScrollbarActive(false);
    this.hover = scrollView;
    this.hover?.setScrollbarActive(true);
  }

  private targetAt(x: number, y: number, includeHiddenAuto = false): ScrollbarTarget | undefined {
    const layout = this.view.frame.currentLayout;
    if (this.view.hasOverlay() || layout === undefined) return undefined;
    for (const scrollView of getScrollViewsAt(layout, x, y)) {
      const box = getScrollViewBox(layout, scrollView);
      const geometry = box === undefined ? undefined : getScrollbarGeometry(box, includeHiddenAuto);
      if (
        geometry !== undefined &&
        x === geometry.column &&
        y >= geometry.trackTop &&
        y < geometry.trackTop + geometry.trackHeight
      ) {
        return { scrollView, geometry };
      }
    }
    return undefined;
  }
}
