import { APP_NAME } from "../config.ts";
import { configureHttpDispatcher } from "../core/http-dispatcher.ts";

export function setupCli(): void {
  process.title = APP_NAME;
  Object.assign(process.env, { MSA_CODING_AGENT: "true", AI_AGENT: "msa" });
  process.emitWarning = (() => {}) as typeof process.emitWarning;

  configureHttpDispatcher();
}
