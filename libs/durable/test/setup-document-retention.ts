import { environmentVariable } from "../src/env/node-process.ts";
import { setDefaultDocumentRetention } from "../src/session/session.ts";

const forced = environmentVariable("MSA_DURABLE_DOCUMENT_RETENTION_MS", true);
if (forced !== undefined) setDefaultDocumentRetention(Number(forced));
