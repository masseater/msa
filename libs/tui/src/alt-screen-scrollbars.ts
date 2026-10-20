import altScreenMouseProtocol from "./alt-screen-mouse-protocol.ts";
import type altScreenMouseProtocolTypes from "./alt-screen-mouse-protocol.types.ts";
import type altScreenViewTypes from "./alt-screen-view.ts";
import type scrollViewTypes from "./components/scroll-view.types.ts";
import layoutModule from "./layout.ts";
import type layoutTypes from "./layout.types.ts";

const { getScrollViewBox, getScrollViewsAt, getScrollbarGeometry } = layoutModule;
const { isPlainPress } = altScreenMouseProtocol;

interface ScrollbarDrag {
  scrollView: scrollViewTypes.ScrollView;
  grabOffset: number;
}

interface ScrollbarTarget {
  scrollView: scrollViewTypes.ScrollView;
  geometry: layoutTypes.ScrollbarGeometry;
}

interface ScrollbarPointer {
  pointerY: number;
  grabOffset: number;
}

function scrollToPointer(
  scrollView: scrollViewTypes.ScrollView,
  geometry: layoutTypes.ScrollbarGeometry,
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

export default class AltScreenScrollbars {
  private readonly view: altScreenViewTypes.AltScreenView;
  private drag: ScrollbarDrag | undefined;
  private hover: scrollViewTypes.ScrollView | undefined;

  constructor(view: altScreenViewTypes.AltScreenView) {
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

  routeWheel(event: altScreenMouseProtocolTypes.WheelEvent, delta: number): void {
    const layout = this.view.frame.currentLayout;
    let remaining = delta;
    const seen = new Set<scrollViewTypes.ScrollView>();
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

  handleMouse(event: altScreenMouseProtocolTypes.SgrMouseEvent, onGrab: () => void): boolean {
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
    if (!onThumb) scrollToPointer(target.scrollView, geometry, { grabOffset, pointerY: event.y });
    this.drag = { grabOffset, scrollView: target.scrollView };
    return true;
  }

  private continueDrag(
    drag: ScrollbarDrag,
    event: altScreenMouseProtocolTypes.SgrMouseEvent,
  ): void {
    if (event.release) {
      this.stopDrag();
      return;
    }
    const layout = this.view.frame.currentLayout;
    const box = layout === undefined ? undefined : getScrollViewBox(layout, drag.scrollView);
    const geometry = box === undefined ? undefined : getScrollbarGeometry(box);
    if (geometry !== undefined) {
      scrollToPointer(drag.scrollView, geometry, {
        grabOffset: drag.grabOffset,
        pointerY: event.y,
      });
    }
  }

  private setHover(scrollView: scrollViewTypes.ScrollView | undefined): void {
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
        return { geometry, scrollView };
      }
    }
    return undefined;
  }
}
