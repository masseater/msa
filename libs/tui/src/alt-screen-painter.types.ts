import type altScreenFrameTypes from "./alt-screen-frame.types.ts";
import type AltScreenPainterClass from "./alt-screen-painter.ts";
import type altScreenPointerTypes from "./alt-screen-pointer.types.ts";
import type altScreenSearchControllerTypes from "./alt-screen-search-controller.types.ts";
import type altScreenViewTypes from "./alt-screen-view.ts";
import type scrollViewTypes from "./components/scroll-view.types.ts";
import type tuiComponentTypes from "./tui-component.types.ts";

declare namespace altScreenPainterTypes {
  interface PainterHost {
    readonly view: altScreenViewTypes.AltScreenView;
    readonly implicitScrollView: scrollViewTypes.ScrollView;
    readonly search: altScreenSearchControllerTypes.AltScreenSearchController;
    readonly pointer: altScreenPointerTypes.AltScreenPointer;
    layoutRoot(): tuiComponentTypes.Component | undefined;
    imageProtocol(): altScreenFrameTypes.AltScreenFrameInput["imageProtocol"];
    showHardwareCursor(): boolean;
    renderFlashes(width: number): string[];
    resolveFakeCursors(lines: string[]): string[];
    compositeOverlays(lines: string[], width: number, height: number): string[];
    extractCursorPosition(lines: string[], height: number): { row: number; col: number } | null;
    applyLineResets(lines: string[]): string[];
    onFullRedraw(): void;
    write(data: string): void;
  }

  type AltScreenPainter = AltScreenPainterClass;
}

export type { altScreenPainterTypes as default };
