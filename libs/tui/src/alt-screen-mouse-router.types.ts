import type AltScreenMouseRouterClass from "./alt-screen-mouse-router.ts";
import type altScreenViewTypes from "./alt-screen-view.ts";
import type tuiComponentTypes from "./tui-component.types.ts";

declare namespace altScreenMouseRouterTypes {
  interface MouseRouterHost {
    readonly view: altScreenViewTypes.AltScreenView;
    resolveFocusTarget(component: tuiComponentTypes.Component): tuiComponentTypes.Component;
    focusedComponent(): tuiComponentTypes.Component | null;
    setFocus(component: tuiComponentTypes.Component): void;
  }

  type AltScreenMouseRouter = AltScreenMouseRouterClass;
}

export type { altScreenMouseRouterTypes as default };
