import type MaxHeightTestComponentClass from "./max-height-test-component.ts";

declare namespace maxHeightTestComponentTypes {
  type MaxHeightTestComponent = (typeof MaxHeightTestComponentClass)["prototype"];
}

export type { maxHeightTestComponentTypes as default };
