import nodeProcess from "../src/env/node/node-process.ts";
import session from "../src/session/session-state.ts";

const { environmentVariable } = nodeProcess;
const { setDefaultDocumentRetention } = session;

const forced = environmentVariable("MSA_DURABLE_DOCUMENT_RETENTION_MS", true);
if (forced !== undefined) setDefaultDocumentRetention(Number(forced));
