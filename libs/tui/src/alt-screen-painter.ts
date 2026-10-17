import {
  type AltScreenFrameInput,
  buildAltScreenFrame,
  compositeFlashes,
} from "./alt-screen-frame.ts";
import { KittyImageCache } from "./alt-screen-kitty-cache.ts";
import type { AltScreenPointer } from "./alt-screen-pointer.ts";
import type { AltScreenSearchController } from "./alt-screen-search-controller.ts";
import { fitLinesToWidth } from "./alt-screen-terminal-modes.ts";
import type { AltScreenView } from "./alt-screen-view.ts";
import { stripOsc133ZonePrefix } from "./ansi-sequences.ts";
import type { ScrollView } from "./components/scroll-view.ts";
import { type LayoutFrame, renderLayoutFrame } from "./layout.ts";
import type { Component } from "./tui-component.ts";

export interface PainterHost {
  readonly view: AltScreenView;
  readonly implicitScrollView: ScrollView;
  readonly search: AltScreenSearchController;
  readonly pointer: AltScreenPointer;
  layoutRoot(): Component | undefined;
  imageProtocol(): AltScreenFrameInput["imageProtocol"];
  showHardwareCursor(): boolean;
  renderFlashes(width: number): string[];
  resolveFakeCursors(lines: string[]): string[];
  compositeOverlays(lines: string[], width: number, height: number): string[];
  extractCursorPosition(lines: string[], height: number): { row: number; col: number } | null;
  applyLineResets(lines: string[]): string[];
  onFullRedraw(): void;
  write(data: string): void;
}

export class AltScreenPainter {
  readonly kittyImages = new KittyImageCache();
  private readonly host: PainterHost;

  constructor(host: PainterHost) {
    this.host = host;
  }

  paint(width: number, height: number): void {
    const { host } = this;
    const layout = this.renderLayout(width, height);
    const screen = this.compose(layout, width, height);
    const cursor = host.extractCursorPosition(screen, height);
    const lines = fitLinesToWidth(host.applyLineResets(screen), width);
    const { frame } = host.view;
    const output = buildAltScreenFrame({
      screen: lines,
      previousScreen: frame.previousScreen,
      previousWidth: frame.previousScreenWidth,
      previousHeight: frame.previousScreenHeight,
      width,
      height,
      imageProtocol: host.imageProtocol(),
      kittyImages: this.kittyImages,
      cursor,
      showHardwareCursor: host.showHardwareCursor(),
    });
    if (output.fullRedraw) host.onFullRedraw();
    host.write(output.buffer);
    frame.previousScreen = lines;
    frame.previousScreenWidth = width;
    frame.previousScreenHeight = height;
    frame.currentLayout = layout;
  }

  private scrollViewOf(layout: LayoutFrame): ScrollView {
    return layout.primaryScrollView ?? this.host.implicitScrollView;
  }

  private renderLayout(width: number, height: number): LayoutFrame {
    const { host } = this;
    const root = host.layoutRoot() ?? host.implicitScrollView;
    const requestRender = (): void => host.view.requestRender();
    const layout = renderLayoutFrame(root, width, height, requestRender);
    return host.search.refresh(layout, this.scrollViewOf(layout))
      ? renderLayoutFrame(root, width, height, requestRender)
      : layout;
  }

  private compose(layout: LayoutFrame, width: number, height: number): string[] {
    const { host } = this;
    const scrollView = this.scrollViewOf(layout);
    let screen = host.resolveFakeCursors(layout.lines.map((line) => stripOsc133ZonePrefix(line)));
    screen = host.search.highlight(screen, layout, scrollView);
    screen = host.pointer.endIndicator.composite(screen, { layout, scrollView, width });
    screen = host.compositeOverlays(screen, width, height);
    if (screen.length > height) screen = screen.slice(screen.length - height);
    screen = host.pointer.selection.apply(screen, layout);
    return compositeFlashes(screen, host.renderFlashes(width), { width, height });
  }
}
