import { dual } from "effect/Function";

import type jsonTypes from "./json.types.ts";

const DATA_DESCRIPTOR: PropertyDescriptor = {
  configurable: true,
  enumerable: true,
  value: undefined,
  writable: true,
};

function copied(value: unknown, options?: jsonTypes.CopyJsonOptions): jsonTypes.JsonValue {
  return copy(value, undefined, options?.omitUndefinedProperties === true);
}

function copy(
  value: unknown,
  ancestors: Set<object> | undefined,
  omitUndefinedProperties: boolean,
): jsonTypes.JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw new TypeError("Value contains a non-finite number and is not strict JSON");
  }
  if (typeof value !== "object")
    throw new TypeError(`Value contains a non-JSON ${typeof value}; expected strict JSON`);
  const active = ancestors ?? new Set<object>();
  if (active.has(value)) throw new TypeError("Value contains cycles and is not strict JSON");
  active.add(value);
  try {
    return Array.isArray(value)
      ? copyArray(value, active, omitUndefinedProperties)
      : copyObject(value, active, omitUndefinedProperties);
  } finally {
    active.delete(value);
  }
}

function copyArray(
  value: unknown[],
  active: Set<object>,
  omitUndefinedProperties: boolean,
): jsonTypes.JsonValue {
  if (
    Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    throw new TypeError("Value must contain strict JSON dense plain arrays");
  }
  const result = new Array<jsonTypes.JsonValue>(value.length);
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (descriptor === undefined || descriptor.enumerable !== true || !("value" in descriptor)) {
      throw new TypeError("Value must contain strict JSON enumerable indexed data properties");
    }
    defineData(result, String(index), copy(descriptor.value, active, omitUndefinedProperties));
  }
  return result;
}

function copyObject(
  value: object,
  active: Set<object>,
  omitUndefinedProperties: boolean,
): jsonTypes.JsonValue {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Value must contain strict JSON plain objects or arrays");
  }
  const result = Object.create(prototype) as Record<string, jsonTypes.JsonValue>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol")
      throw new TypeError("Value contains a symbol key and is not strict JSON");
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (descriptor.enumerable !== true || !("value" in descriptor)) {
      throw new TypeError("Value must contain strict JSON enumerable data properties");
    }
    if (descriptor.value === undefined && omitUndefinedProperties) continue;
    defineData(result, key, copy(descriptor.value, active, omitUndefinedProperties));
  }
  return result;
}

function defineData(target: object, key: PropertyKey, value: jsonTypes.JsonValue): void {
  DATA_DESCRIPTOR.value = value;
  Object.defineProperty(target, key, DATA_DESCRIPTOR);
  DATA_DESCRIPTOR.value = undefined;
}

function isJsonValue(value: unknown): value is jsonTypes.JsonValue {
  return check(value, new Set<object>());
}

function check(value: unknown, ancestors: Set<object>): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || keys.some((key) => typeof key !== "string"))
      return false;
    if (ancestors.has(value)) return false;
    ancestors.add(value);
    try {
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (
          descriptor === undefined ||
          descriptor.enumerable !== true ||
          !("value" in descriptor) ||
          !check(descriptor.value, ancestors)
        ) {
          return false;
        }
      }
      return true;
    } finally {
      ancestors.delete(value);
    }
  }
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string")) return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  try {
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (
        descriptor.enumerable !== true ||
        !("value" in descriptor) ||
        !check(descriptor.value, ancestors)
      ) {
        return false;
      }
    }
    return true;
  } finally {
    ancestors.delete(value);
  }
}

const copyJson: {
  (options?: jsonTypes.CopyJsonOptions): (value: unknown) => jsonTypes.JsonValue;
  (value: unknown, options?: jsonTypes.CopyJsonOptions): jsonTypes.JsonValue;
} = dual((args) => args.length >= 1, copied);

const json = {
  copyJson,
  isJsonValue,
};

export default json;
