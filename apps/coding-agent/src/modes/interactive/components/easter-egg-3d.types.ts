import type EasterEgg3dAnimationClass from "./easter-egg-3d-animation.ts";

declare namespace easterEgg3dTypes {
  type EasterEgg3dAnimation = (typeof EasterEgg3dAnimationClass)["prototype"];
}

export type { easterEgg3dTypes as default };
