import testing from "@msa/testing";

import type harnessTypes from "./harness.types.ts";

const harnesses: harnessTypes.Harness[] = [];

const { gate } = testing;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  const promise = gate();
  return { promise, resolve: () => promise.release() };
}

const agentSessionBoundariesSupport = {
  deferred,
  harnesses,
};

export default agentSessionBoundariesSupport;
