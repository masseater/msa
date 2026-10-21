import runMain from "./main/run-main.ts";
import sessionSetup from "./main/session-setup.ts";

const { createSessionManager } = sessionSetup;
const { main } = runMain;

const mainModule = {
  createSessionManager,
  main,
};

export default mainModule;
