const PROBE_TAG = JSON.stringify("msa/class-seal/probe");

const classFactories: ReadonlyMap<string, (callee: string) => string> = new Map([
  ["effect/Context/Service", (callee: string) => `${callee}()(${PROBE_TAG})`],
  ["effect/Data/TaggedError", (callee: string) => `${callee}(${PROBE_TAG})`],
  ["effect/Schema/TaggedError", (callee: string) => `${callee}()(${PROBE_TAG}, {})`],
]);

export default classFactories;
