import { scrollSelectionPoint } from "./alt-screen-selection-points.ts";
import { type SelectionPoint, visibleRows } from "./alt-screen-selection-text.ts";
import type { AltScreenView } from "./alt-screen-view.ts";
import type { ScrollView } from "./components/scroll-view.ts";
import { type CancelDelay, runEvery } from "./delay.ts";
import { getScrollViewBox } from "./layout.ts";

const AUTO_SCROLL_INTERVAL_MS = 50;

export interface AutoScrollHost {
  readonly view: AltScreenView;
  anchorScrollView(): ScrollView | undefined;
  onScroll(point: SelectionPoint | undefined): void;
}

export class SelectionAutoScroll {
  private readonly host: AutoScrollHost;
  private pointer: { x: number; y: number } | undefined;
  private direction: -1 | 0 | 1 = 0;
  private cancel: CancelDelay | undefined;

  constructor(host: AutoScrollHost) {
    this.host = host;
  }

  update(pointer: { x: number; y: number }): void {
    const scrollView = this.host.anchorScrollView();
    const layout = this.host.view.frame.currentLayout;
    const rows =
      scrollView === undefined || layout === undefined
        ? undefined
        : visibleRows(getScrollViewBox(layout, scrollView), this.host.view.rows());
    if (rows === undefined) {
      this.stop();
      return;
    }
    this.pointer = { x: pointer.x, y: pointer.y };
    this.direction = pointer.y <= rows.top ? -1 : pointer.y >= rows.bottom ? 1 : 0;
    if (this.direction === 0) {
      this.stop();
      return;
    }
    if (this.cancel !== undefined) return;
    this.cancel = runEvery(AUTO_SCROLL_INTERVAL_MS, () => this.tick());
  }

  stop(): void {
    if (this.cancel !== undefined) {
      this.cancel();
      this.cancel = undefined;
    }
    this.direction = 0;
    this.pointer = undefined;
  }

  private tick(): void {
    const scrollView = this.host.anchorScrollView();
    const pointer = this.pointer;
    const direction = this.direction;
    if (scrollView === undefined || pointer === undefined || direction === 0) {
      this.stop();
      return;
    }
    const remaining = scrollView.scrollBy(direction);
    if (remaining === direction) {
      this.stop();
      return;
    }
    this.host.onScroll(scrollSelectionPoint(this.host.view, { scrollView, ...pointer }));
  }
}
