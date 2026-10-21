import { dual } from "effect/Function";

import type coreTypes from "./core.types.ts";
import publish from "./publish.ts";
import type typesModule from "./types.types.ts";

const { enqueue } = publish;

const REF_BASE: ReadonlySet<PropertyKey> = new Set([
  "contract",
  "status",
  "ready",
  "variant",
  "shape",
  "error",
  "onShape",
  "onStatus",
  "release",
]);

const notifyStatus: {
  (
    status: typesModule.RefStatus,
    error: unknown,
    report: (error: unknown) => void,
  ): (listeners: ReadonlySet<coreTypes.StatusListener>) => void;
  (
    listeners: ReadonlySet<coreTypes.StatusListener>,
    status: typesModule.RefStatus,
    error: unknown,
    report: (error: unknown) => void,
  ): void;
} = dual(
  4,
  (
    listeners: ReadonlySet<coreTypes.StatusListener>,
    status: typesModule.RefStatus,
    error: unknown,
    report: (error: unknown) => void,
  ): void => {
    if (listeners.size === 0) return;
    const current = [...listeners];
    enqueue(() => {
      for (const listener of current) {
        try {
          listener(status, error);
        } catch (thrown) {
          report(thrown);
        }
      }
    });
  },
);

const refsByProxy = new WeakMap<object, coreTypes.RefCore>();
const refOf = (value: unknown): coreTypes.RefCore | undefined =>
  value !== null && typeof value === "object" ? refsByProxy.get(value) : undefined;

const core = {
  REF_BASE,
  notifyStatus,
  refOf,
  refsByProxy,
};

export default core;
