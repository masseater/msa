import keybindingsPart1 from "./keybindings-part1.ts";
import keybindingsPart2 from "./keybindings-part2.ts";
import type keybindingsTypes from "./keybindings.types.ts";

const { APP_KEYBINDINGS, KEYBINDINGS, useWindowsKeybindings } = keybindingsPart1;
const { migrateKeybindingsConfig } = keybindingsPart2;

declare global {
  interface MsaTuiKeybindings extends keybindingsTypes.AppKeybindings {}
}

const keybindings = {
  APP_KEYBINDINGS,
  KEYBINDINGS,
  migrateKeybindingsConfig,
  useWindowsKeybindings,
};

export default keybindings;
