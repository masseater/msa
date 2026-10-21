import keybindingDefinitions from "./keybinding-definitions.ts";
import keybindingMigrations from "./keybinding-migrations.ts";
import type keybindingsTypes from "./keybindings.types.ts";

const { APP_KEYBINDINGS, KEYBINDINGS, useWindowsKeybindings } = keybindingDefinitions;
const { migrateKeybindingsConfig } = keybindingMigrations;

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
