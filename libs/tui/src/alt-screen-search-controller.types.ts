import type AltScreenSearchControllerClass from "./alt-screen-search-controller.ts";
import type altScreenSearchResultsTypes from "./alt-screen-search-results.types.ts";
import type altScreenViewTypes from "./alt-screen-view.ts";
import type tuiComponentTypes from "./tui-component.types.ts";
import type tuiInterfaceTypes from "./tui-interface.types.ts";
import type tuiOverlayLayoutTypes from "./tui-overlay-layout.types.ts";

declare namespace altScreenSearchControllerTypes {
  interface SearchControllerOptions {
    view: altScreenViewTypes.AltScreenView;
    styles: altScreenSearchResultsTypes.SearchHighlightStyles;
    navigationButtonStyle: (text: string, hovered: boolean) => string;
    showOverlay: (
      component: tuiComponentTypes.Component,
      options: tuiOverlayLayoutTypes.OverlayOptions,
    ) => tuiInterfaceTypes.OverlayHandle;
  }

  type AltScreenSearchController = AltScreenSearchControllerClass;
}

export type { altScreenSearchControllerTypes as default };
