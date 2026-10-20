import type tuiTypes from "@msa/tui/index.types";

import platform from "../../../core/platform.ts";
import arminHelpers from "./armin-helpers.ts";
import ArminComponentLayer2 from "./armin-layer-2.ts";

const { randomUnit } = platform;
const { EFFECTS, buildFinalGrid } = arminHelpers;

export default class ArminComponent extends ArminComponentLayer2 implements tuiTypes.Component {
  constructor(ui: tuiTypes.TUI) {
    super();
    this.ui = ui;
    this.effect = EFFECTS[Math.floor(randomUnit() * EFFECTS.length)] ?? "typewriter";
    this.finalGrid = buildFinalGrid();
    this.currentGrid = this.createEmptyGrid();

    this.initEffect();
    this.startAnimation();
  }
}
