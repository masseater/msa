import ResourceImpl from "./resource-impl.ts";

const facades = new WeakMap<object, ResourceImpl>();

const resourceOf = (value: unknown): ResourceImpl | undefined =>
  value instanceof ResourceImpl
    ? value
    : value !== null && typeof value === "object"
      ? facades.get(value)
      : undefined;

const resource = {
  ResourceImpl,
  facades,
  resourceOf,
};

export default resource;
