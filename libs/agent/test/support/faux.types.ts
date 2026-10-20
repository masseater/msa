import type { registerFauxProvider } from "@msa/ai/compat";

declare namespace fauxTypes {
  type FauxOptions = Parameters<typeof registerFauxProvider>[0];
}

export type { fauxTypes as default };
