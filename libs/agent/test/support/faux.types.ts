import type compat from "@msa/ai/compat";

declare namespace fauxTypes {
  type FauxOptions = Parameters<typeof compat.registerFauxProvider>[0];
}

export type { fauxTypes as default };
