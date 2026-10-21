import type jsonTypes from "../json.types.ts";

type JsonContainer = jsonTypes.JsonValue[] | Record<string, jsonTypes.JsonValue>;

const isContainer = (value: jsonTypes.JsonValue): value is JsonContainer =>
  typeof value === "object" && value !== null;

export default class JsonRevisionValidator {
  readonly #validated = new WeakSet<object>();

  validate<T extends jsonTypes.JsonValue>(value: T): T {
    return this.#validate(value, new Set<object>(), new WeakSet<object>()) as T;
  }

  #validate(
    value: jsonTypes.JsonValue,
    ancestors: Set<object>,
    finished: WeakSet<object>,
  ): jsonTypes.JsonValue {
    if (!isContainer(value) || this.#validated.has(value))
      return isContainer(value) ? value : assertPrimitive(value);
    if (finished.has(value)) return value;
    if (ancestors.has(value)) throw new TypeError("Replicated state cannot contain cycles");
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        assertDenseArray(value);
        for (let index = 0; index < value.length; index++)
          this.#validate(value[index]!, ancestors, finished);
      } else {
        assertPlainObject(value);
        for (const key of Reflect.ownKeys(value)) {
          if (typeof key === "symbol")
            throw new TypeError("Replicated state cannot contain symbol properties");
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (
            descriptor === undefined ||
            descriptor.enumerable !== true ||
            !("value" in descriptor)
          ) {
            throw new TypeError("Replicated state objects must contain enumerable data properties");
          }
          this.#validate(descriptor.value as jsonTypes.JsonValue, ancestors, finished);
        }
      }
      finished.add(value);
      this.#validated.add(value);
      return value;
    } finally {
      ancestors.delete(value);
    }
  }
}

function assertPrimitive(value: unknown): null | boolean | number | string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new TypeError("Replicated state values must be strict JSON");
}

function assertPlainObject(value: object): void {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Replicated state containers must be plain objects or arrays");
  }
}

function assertDenseArray(value: readonly unknown[]): void {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key !== "string")) {
    throw new TypeError("Replicated state arrays must be dense and contain only indexed entries");
  }
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !("value" in descriptor) ||
      descriptor.value === undefined
    ) {
      throw new TypeError(
        "Replicated state arrays must contain enumerable indexed data properties with defined values",
      );
    }
  }
}
