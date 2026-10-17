import { Function } from "effect";
import { type TUnsafe, Type } from "typebox";

export const StringEnum: {
  <T extends readonly string[]>(options?: {
    description?: string;
    default?: T[number];
  }): (values: T) => TUnsafe<T[number]>;
  <T extends readonly string[]>(
    values: T,
    options?: { description?: string; default?: T[number] },
  ): TUnsafe<T[number]>;
} = Function.dual(
  (args) => Array.isArray(args[0]),
  function <T extends readonly string[]>(
    values: T,
    options?: { description?: string; default?: T[number] },
  ): TUnsafe<T[number]> {
    return Type.Unsafe<T[number]>({
      type: "string",
      enum: values as any,
      ...(options?.description && { description: options.description }),
      ...(options?.default && { default: options.default }),
    });
  },
);
