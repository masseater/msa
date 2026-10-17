import type { ProviderStreams } from "../types.ts";
import { lazyApi } from "./lazy.ts";

export const msaMessagesApi = (): ProviderStreams => lazyApi(() => import("./msa-messages.ts"));
