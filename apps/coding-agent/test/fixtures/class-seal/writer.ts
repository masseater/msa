import Local from "./local.ts";

const writer = {
  install: (): void => {
    (globalThis as Record<symbol, unknown>)[Symbol.for("msa.class-seal-fixture")] = Local;
  },
};

export default writer;
