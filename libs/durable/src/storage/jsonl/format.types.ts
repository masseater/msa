import type chordTypes from "@msa/chord/index.types";

import type typesModule from "../../types.types.ts";
import type formatModule from "./format.ts";

declare namespace formatTypes {
  type StoredTask = typesModule.TaskRecord<
    chordTypes.JsonValue,
    chordTypes.JsonValue,
    chordTypes.JsonValue
  >;

  type MainOperation =
    | Extract<
        typesModule.StorageWrite,
        { readonly type: "conversation" | "entry" | "submission" | "document.retire" }
      >
    | { readonly type: "task"; readonly value: StoredTask }
    | { readonly type: "task.sidecar"; readonly id: typesModule.TaskId; readonly ordinal: number }
    | {
        readonly type: "document.create";
        readonly record: typesModule.DocumentCreate;
        readonly ordinal: number;
      }
    | {
        readonly type: "document.change";
        readonly id: typesModule.DocumentId;
        readonly ordinal: number;
      };

  type MainMarker = {
    readonly format: typeof formatModule.FORMAT_VERSION;
    readonly type: "commit";
    readonly seq: typesModule.Seq;
    readonly writes: readonly MainOperation[];
  };

  type SidecarPayload =
    | { readonly type: "task"; readonly value: StoredTask }
    | {
        readonly type: "document";
        readonly id: typesModule.DocumentId;
        readonly content: typesModule.DocumentContent;
      };

  type SidecarRecord = {
    readonly format: typeof formatModule.FORMAT_VERSION;
    readonly type: "record";
    readonly seq: typesModule.Seq;
    readonly ordinal: number;
    readonly payload: SidecarPayload;
  };

  type ParsedLine<T> = {
    readonly value: T;
    readonly start: number;
  };

  type ParsedFile<T> = {
    readonly path: string;
    readonly lines: readonly ParsedLine<T>[];
  };

  type EncodedCommit = {
    readonly marker: string;
    readonly sidecars: ReadonlyMap<string, string>;
  };
}

export type { formatTypes as default };
