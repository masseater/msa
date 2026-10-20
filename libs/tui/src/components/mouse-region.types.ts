import type tuiComponentTypes from "../tui-component.types.ts";
import type MouseRegionClass from "./mouse-region.ts";

declare namespace mouseRegionTypes {
  type MouseRegionHandler = (
    event: tuiComponentTypes.TuiMouseEvent,
  ) => tuiComponentTypes.TuiMouseEventResult | undefined;

  type MouseRegion = MouseRegionClass;
}

export type { mouseRegionTypes as default };
