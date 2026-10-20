import type jsonTypes from "../json.types.ts";
import type decodeTypes from "./decode.types.ts";
import type draftTypes from "./draft.ts";
import type encodeTypes from "./encode.types.ts";
import type pathErrorTypes from "./path-error.types.ts";
import type trackerTypesModule from "./tracker-types.types.ts";
import type unsafePathErrorTypes from "./unsafe-path-error.types.ts";

declare namespace deltaTypes {
  type Seg = string | number;

  type Path = readonly Seg[];

  type NonEmptyPath = readonly [Seg, ...Seg[]];

  type PathRef<P extends Path = Path> = P | number;

  type Op =
    | readonly ["r", jsonTypes.JsonValue]
    | readonly ["s", NonEmptyPath, jsonTypes.JsonValue]
    | readonly ["d", NonEmptyPath]
    | readonly ["a", NonEmptyPath, string]
    | readonly ["t", NonEmptyPath, number]
    | readonly ["p", Path, number, number, jsonTypes.JsonValue[]]
    | readonly ["m", Path, number[]];

  type WireOp =
    | readonly ["r", jsonTypes.JsonValue]
    | readonly ["s", PathRef<NonEmptyPath>, jsonTypes.JsonValue]
    | readonly ["s", jsonTypes.JsonValue]
    | readonly ["d", PathRef<NonEmptyPath>]
    | readonly ["d"]
    | readonly ["a", PathRef<NonEmptyPath>, string]
    | readonly ["a", string]
    | readonly ["t", PathRef<NonEmptyPath>, number]
    | readonly ["t", number]
    | readonly ["p", PathRef, number, number, jsonTypes.JsonValue[]]
    | readonly ["p", number, number, jsonTypes.JsonValue[]]
    | readonly ["m", PathRef, number[]]
    | readonly ["m", number[]]
    | readonly ["#", number, Path];

  type JsonValue = jsonTypes.JsonValue;

  type Decoder = decodeTypes.Decoder;

  type Draft<T, Depth extends readonly unknown[] = []> = draftTypes.Draft<T, Depth>;

  type Encoder = encodeTypes.Encoder;

  type Change<T extends object> = trackerTypesModule.Change<T>;

  type Prepared<T extends object> = trackerTypesModule.Prepared<T>;

  type Tracker<T extends object> = trackerTypesModule.Tracker<T>;

  type PathError = pathErrorTypes.PathError;

  type UnsafePathError = unsafePathErrorTypes.UnsafePathError;
}

export type { deltaTypes as default };
