import distribution from "./startup-ui/distribution.ts";
import firstTimeSetup from "./startup-ui/first-time-setup.ts";
import startupPrompts from "./startup-ui/startup-prompts.ts";
import startupTui from "./startup-ui/startup-tui.ts";
import terminalTheme from "./startup-ui/terminal-theme.ts";

const { createStartupTui } = startupTui;
const { shouldRunFirstTimeSetup } = distribution;
const { showFirstTimeSetup } = firstTimeSetup;
const { showStartupInput, showStartupSelector } = startupPrompts;
const { startStartupTui } = terminalTheme;

const startupUi = {
  createStartupTui,
  shouldRunFirstTimeSetup,
  showFirstTimeSetup,
  showStartupInput,
  showStartupSelector,
  startStartupTui,
};

export default startupUi;
