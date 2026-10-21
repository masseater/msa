import config from "./config.ts";
import httpDispatcher from "./core/http-dispatcher.ts";
import mainModule from "./main.ts";

const { APP_NAME } = config;
const { configureHttpDispatcher } = httpDispatcher;
const { main } = mainModule;

process.title = `${APP_NAME}-rpc`;
Object.assign(process.env, { AI_AGENT: "msa", MSA_CODING_AGENT: "true" });
process.emitWarning = (() => {}) as typeof process.emitWarning;

configureHttpDispatcher();

main(["--mode", "rpc", ...process.argv.slice(2)]);
