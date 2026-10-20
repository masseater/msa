import type tuiTypes from "@msa/tui/index.types";

import type platformTypes from "../../../core/platform.types.ts";
import type arminInternalTypes from "./armin-internal.types.ts";

export default abstract class ArminComponentLayer0 {
  protected ui!: tuiTypes.TUI;
  protected interval: platformTypes.Scheduled | null = null;
  protected effect!: arminInternalTypes.Effect;
  protected finalGrid!: string[][];
  protected currentGrid!: string[][];
  protected effectState: Record<string, unknown> = {};
  protected cachedLines: string[] = [];
  protected cachedWidth = 0;
  protected gridVersion = 0;
  protected cachedVersion = -1;
}
