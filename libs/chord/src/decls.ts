import Decls from "./decls-class.ts";
import type serviceTypes from "./service.types.ts";

const isStateInit = (value: unknown): value is serviceTypes.StateInit<unknown> =>
  value !== null &&
  typeof value === "object" &&
  typeof (value as { init?: unknown }).init === "function";

const declsModule = {
  Decls,
  isStateInit,
};

export default declsModule;
