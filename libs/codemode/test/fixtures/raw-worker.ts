import { parentPort, workerData } from "node:worker_threads";

const messages: unknown = JSON.parse((workerData as { code: string }).code);
for (const message of Array.isArray(messages) ? messages : [messages])
  parentPort?.postMessage(message);
