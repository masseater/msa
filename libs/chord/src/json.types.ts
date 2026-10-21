declare namespace jsonTypes {
  type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

  type IsAny<T> = 0 extends 1 & T ? true : false;

  type JsonRepresentation<T> =
    IsAny<T> extends true
      ? JsonValue
      : unknown extends T
        ? JsonValue
        : T extends null | boolean | number | string
          ? T
          : T extends readonly (infer TItem)[]
            ? JsonRepresentation<TItem>[]
            : T extends object
              ? { [TKey in keyof T]: JsonRepresentation<T[TKey]> }
              : never;

  type CopyJsonOptions = {
    readonly omitUndefinedProperties?: boolean;
  };
}

export type { jsonTypes as default };
