import altScreenFrame from "./alt-screen-frame.ts";
import KittyImageCache from "./alt-screen-kitty-cache.ts";
import type altScreenPainterTypes from "./alt-screen-painter.types.ts";
import altScreenTerminalModes from "./alt-screen-terminal-modes.ts";
import ansiSequences from "./ansi-sequences.ts";
import type scrollViewTypes from "./components/scroll-view.types.ts";
import layoutModule from "./layout.ts";
import type layoutTypes from "./layout.types.ts";

const { fitLinesToWidth } = altScreenTerminalModes;
const { buildAltScreenFrame, compositeFlashes } = altScreenFrame;
const { renderLayoutFrame } = layoutModule;
const { stripOsc133ZonePrefix } = ansiSequences;

export default class AltScreenPainter {
  readonly kittyImages = new KittyImageCache();
  private readonly host: altScreenPainterTypes.PainterHost;

  constructor(host: altScreenPainterTypes.PainterHost) {
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
      cursor,
      height,
      imageProtocol: host.imageProtocol(),
      kittyImages: this.kittyImages,
      previousHeight: frame.previousScreenHeight,
      previousScreen: frame.previousScreen,
      previousWidth: frame.previousScreenWidth,
      screen: lines,
      showHardwareCursor: host.showHardwareCursor(),
      width,
    });
    if (output.fullRedraw) host.onFullRedraw();
    host.write(output.buffer);
    frame.previousScreen = lines;
    frame.previousScreenWidth = width;
    frame.previousScreenHeight = height;
    frame.currentLayout = layout;
  }

  private scrollViewOf(layout: layoutTypes.LayoutFrame): scrollViewTypes.ScrollView {
    return layout.primaryScrollView ?? this.host.implicitScrollView;
  }

  private renderLayout(width: number, height: number): layoutTypes.LayoutFrame {
    const { host } = this;
    const root = host.layoutRoot() ?? host.implicitScrollView;
    const requestRender = (): void => host.view.requestRender();
    const layout = renderLayoutFrame(root, width, height, requestRender);
    return host.search.refresh(layout, this.scrollViewOf(layout))
      ? renderLayoutFrame(root, width, height, requestRender)
      : layout;
  }

  private compose(layout: layoutTypes.LayoutFrame, width: number, height: number): string[] {
    const { host } = this;
    const scrollView = this.scrollViewOf(layout);
    let screen = host.resolveFakeCursors(layout.lines.map((line) => stripOsc133ZonePrefix(line)));
    screen = host.search.highlight(screen, layout, scrollView);
    screen = host.pointer.endIndicator.composite(screen, { layout, scrollView, width });
    screen = host.compositeOverlays(screen, width, height);
    if (screen.length > height) screen = screen.slice(screen.length - height);
    screen = host.pointer.selection.apply(screen, layout);
    return compositeFlashes(screen, host.renderFlashes(width), { height, width });
  }
}
