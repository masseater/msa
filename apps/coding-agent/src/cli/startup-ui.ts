import startupUiPart3 from "./startup-ui-part3.ts";
import startupUiPart4 from "./startup-ui-part4.ts";
import startupUiPart5 from "./startup-ui-part5.ts";
import startupUiPart6 from "./startup-ui-part6.ts";
import startupUiPart7 from "./startup-ui-part7.ts";
import startupUiPart8 from "./startup-ui-part8.ts";

const { createStartupTui } = startupUiPart3;
const { shouldRunFirstTimeSetup } = startupUiPart5;
const { showFirstTimeSetup } = startupUiPart7;
const { showStartupInput } = startupUiPart8;
const { showStartupSelector } = startupUiPart6;
const { startStartupTui } = startupUiPart4;

const startupUi = {
  createStartupTui,
  shouldRunFirstTimeSetup,
  showFirstTimeSetup,
  showStartupInput,
  showStartupSelector,
  startStartupTui,
};

export default startupUi;
