import config from "../config.ts";
import httpDispatcher from "../core/http-dispatcher.ts";

const { APP_NAME } = config;
const { configureHttpDispatcher } = httpDispatcher;

function setupCli(): void {
  process.title = APP_NAME;
  Object.assign(process.env, { AI_AGENT: "msa", MSA_CODING_AGENT: "true" });
  process.emitWarning = (() => {}) as typeof process.emitWarning;

  configureHttpDispatcher();
}

const setup = {
  setupCli,
};

export default setup;
