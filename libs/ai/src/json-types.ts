export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

type IsAny<T> = 0 extends 1 & T ? true : false;
type IsExactlyJsonValue<T> = [T] extends [JsonValue]
  ? [JsonValue] extends [T]
    ? true
    : false
  : false;
type IsJsonProperty<T> =
  IsAny<T> extends true
    ? false
    : unknown extends T
      ? false
      : [Exclude<T, undefined>] extends [never]
        ? true
        : IsJsonCompatible<Exclude<T, undefined>>;
type InvalidJsonKeys<T extends object> = {
  [TKey in keyof T]-?: TKey extends string | number
    ? IsJsonProperty<T[TKey]> extends true
      ? never
      : TKey
    : TKey;
}[keyof T];
export type IsJsonCompatible<T> =
  IsAny<T> extends true
    ? false
    : unknown extends T
      ? false
      : IsExactlyJsonValue<T> extends true
        ? true
        : T extends null | boolean | number | string
          ? true
          : T extends undefined
            ? false
            : T extends readonly (infer TItem)[]
              ? IsJsonCompatible<TItem>
              : T extends (...args: never[]) => unknown
                ? false
                : T extends object
                  ? [InvalidJsonKeys<T>] extends [never]
                    ? true
                    : false
                  : false;

export type JsonRepresentation<T> =
  IsAny<T> extends true
    ? JsonValue
    : unknown extends T
      ? JsonValue
      : [T] extends [JsonValue]
        ? T
        : T extends readonly unknown[]
          ? { [TKey in keyof T]: JsonRepresentation<Exclude<T[TKey], undefined>> }
          : T extends object
            ? { [TKey in keyof T]: JsonRepresentation<Exclude<T[TKey], undefined>> }
            : never;
