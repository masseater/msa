import { Buffer } from "node:buffer";

import { Array as Arr, Predicate } from "effect";

import type { HostShape } from "./host.ts";
import { median } from "./stats-format.ts";

type EditMode = "multi" | "single";

interface Replacement {
  readonly oldBytes: number;
  readonly newBytes: number;
  readonly totalEditBytes: number;
  readonly sharedPrefixBytes: number;
  readonly sharedSuffixBytes: number;
  readonly sharedContextBytes: number;
  readonly coreOldBytes: number;
  readonly coreNewBytes: number;
  readonly coreBytes: number;
  readonly wrapperPayloadBytes: number;
  readonly inflationRatio: number | null;
  readonly noCoreChange: boolean;
}

interface EditAnalysis {
  readonly path: string;
  readonly extension: string;
  readonly mode: EditMode;
  readonly argStyle: string;
  readonly editsCount: number;
  readonly oldBytes: number;
  readonly newBytes: number;
  readonly totalEditBytes: number;
  readonly sharedPrefixBytes: number;
  readonly sharedSuffixBytes: number;
  readonly sharedContextBytes: number;
  readonly coreOldBytes: number;
  readonly coreNewBytes: number;
  readonly coreBytes: number;
  readonly wrapperPayloadBytes: number;
  readonly noCoreChange?: boolean;
  readonly noCoreChangeCount?: number;
  readonly inflationRatio: number | null;
  readonly medianEditInflationRatio: number | null;
  readonly maxEditInflationRatio: number | null;
  readonly perEdit: ReadonlyArray<Replacement>;
}

const utf8Bytes = (value: string): number => Buffer.byteLength(value, "utf8");

const commonPrefixLength = (left: string, right: string): number => {
  const max = Math.min(left.length, right.length);
  let index = 0;
  while (index < max && left[index] === right[index]) index += 1;
  return index;
};

const commonSuffixLength = (left: string, right: string): number => {
  const max = Math.min(left.length, right.length);
  let index = 0;
  while (index < max && left[left.length - 1 - index] === right[right.length - 1 - index]) {
    index += 1;
  }
  return index;
};

const analyzeReplacement = (oldText: string, newText: string): Replacement => {
  const prefixChars = commonPrefixLength(oldText, newText);
  const oldRemainder = oldText.slice(prefixChars);
  const newRemainder = newText.slice(prefixChars);
  const suffixChars = commonSuffixLength(oldRemainder, newRemainder);
  const oldCore = oldRemainder.slice(0, oldRemainder.length - suffixChars);
  const newCore = newRemainder.slice(0, newRemainder.length - suffixChars);
  const sharedPrefixBytes = utf8Bytes(oldText.slice(0, prefixChars));
  const sharedSuffixBytes = utf8Bytes(oldRemainder.slice(oldRemainder.length - suffixChars));
  const oldBytes = utf8Bytes(oldText);
  const newBytes = utf8Bytes(newText);
  const coreOldBytes = utf8Bytes(oldCore);
  const coreNewBytes = utf8Bytes(newCore);
  const coreBytes = coreOldBytes + coreNewBytes;
  const totalEditBytes = oldBytes + newBytes;
  return {
    oldBytes,
    newBytes,
    totalEditBytes,
    sharedPrefixBytes,
    sharedSuffixBytes,
    sharedContextBytes: sharedPrefixBytes + sharedSuffixBytes,
    coreOldBytes,
    coreNewBytes,
    coreBytes,
    wrapperPayloadBytes: totalEditBytes - coreBytes,
    inflationRatio: coreBytes === 0 ? null : totalEditBytes / coreBytes,
    noCoreChange: coreBytes === 0,
  };
};

const dotfileExtension = (base: string): string =>
  base.startsWith(".") && !base.slice(1).includes(".") ? base.toLowerCase() : "[no_ext]";

const pathExtension = (host: HostShape, filePath: string): string => {
  if (filePath.length === 0) return "[unknown]";
  const extension = host.extname(filePath).toLowerCase();
  return extension === "" ? dotfileExtension(host.basename(filePath)) : extension;
};

const stringField = (args: unknown, key: string): string | undefined => {
  if (!Predicate.hasProperty(key)(args)) return undefined;
  const value = args[key];
  return Predicate.isString(value) ? value : undefined;
};

const arrayField = (args: unknown, key: string): ReadonlyArray<unknown> | undefined => {
  if (!Predicate.hasProperty(key)(args)) return undefined;
  const value = args[key];
  return Arr.isArray(value) ? value : undefined;
};

const hasEitherString = (args: unknown, first: string, second: string): boolean =>
  stringField(args, first) !== undefined || stringField(args, second) !== undefined;

const REPLACEMENT_STYLES: ReadonlyMap<string, string> = new Map([
  ["true:true", "mixed"],
  ["true:false", "oldText/newText"],
  ["false:true", "old_string/new_string"],
  ["false:false", "unknown"],
]);

const replacementStyle = (hasOldText: boolean, hasOldString: boolean): string =>
  REPLACEMENT_STYLES.get(`${hasOldText}:${hasOldString}`) ?? "unknown";

const argStyleOf = (args: unknown): string =>
  arrayField(args, "edits") === undefined
    ? replacementStyle(
        hasEitherString(args, "oldText", "newText"),
        hasEitherString(args, "old_string", "new_string"),
      )
    : "edits";

const stringFieldOr = (args: unknown, primary: string, fallback: string): string =>
  stringField(args, primary) ?? stringField(args, fallback) ?? "";

const sumReplacements = (perEdit: ReadonlyArray<Replacement>) =>
  perEdit.reduce(
    (totals, edit) => ({
      oldBytes: totals.oldBytes + edit.oldBytes,
      newBytes: totals.newBytes + edit.newBytes,
      totalEditBytes: totals.totalEditBytes + edit.totalEditBytes,
      sharedPrefixBytes: totals.sharedPrefixBytes + edit.sharedPrefixBytes,
      sharedSuffixBytes: totals.sharedSuffixBytes + edit.sharedSuffixBytes,
      sharedContextBytes: totals.sharedContextBytes + edit.sharedContextBytes,
      coreOldBytes: totals.coreOldBytes + edit.coreOldBytes,
      coreNewBytes: totals.coreNewBytes + edit.coreNewBytes,
      coreBytes: totals.coreBytes + edit.coreBytes,
      wrapperPayloadBytes: totals.wrapperPayloadBytes + edit.wrapperPayloadBytes,
      noCoreChangeCount: totals.noCoreChangeCount + (edit.noCoreChange ? 1 : 0),
    }),
    {
      oldBytes: 0,
      newBytes: 0,
      totalEditBytes: 0,
      sharedPrefixBytes: 0,
      sharedSuffixBytes: 0,
      sharedContextBytes: 0,
      coreOldBytes: 0,
      coreNewBytes: 0,
      coreBytes: 0,
      wrapperPayloadBytes: 0,
      noCoreChangeCount: 0,
    },
  );

const multiAnalysis = (options: {
  readonly argStyle: string;
  readonly edits: ReadonlyArray<unknown>;
  readonly extension: string;
  readonly path: string;
}): EditAnalysis => {
  const perEdit = options.edits.map((edit) =>
    analyzeReplacement(stringField(edit, "oldText") ?? "", stringField(edit, "newText") ?? ""),
  );
  const inflations = perEdit.flatMap((edit) =>
    edit.inflationRatio === null ? [] : [edit.inflationRatio],
  );
  const totals = sumReplacements(perEdit);
  return {
    path: options.path,
    extension: options.extension,
    mode: "multi",
    argStyle: options.argStyle,
    editsCount: options.edits.length,
    ...totals,
    inflationRatio: totals.coreBytes === 0 ? null : totals.totalEditBytes / totals.coreBytes,
    medianEditInflationRatio: median(inflations),
    maxEditInflationRatio: inflations.length > 0 ? Math.max(...inflations) : null,
    perEdit,
  };
};

const analyzeEditArguments = (options: {
  readonly args: unknown;
  readonly host: HostShape;
}): EditAnalysis => {
  const { args } = options;
  const path = stringField(args, "path") ?? "";
  const extension = pathExtension(options.host, path);
  const argStyle = argStyleOf(args);
  const edits = arrayField(args, "edits");
  if (edits !== undefined) return multiAnalysis({ argStyle, edits, extension, path });
  const replacement = analyzeReplacement(
    stringFieldOr(args, "oldText", "old_string"),
    stringFieldOr(args, "newText", "new_string"),
  );
  return {
    path,
    extension,
    mode: "single",
    argStyle,
    editsCount: 1,
    ...replacement,
    medianEditInflationRatio: replacement.inflationRatio,
    maxEditInflationRatio: replacement.inflationRatio,
    perEdit: [replacement],
  };
};

export type { EditAnalysis, EditMode, Replacement };
export { analyzeEditArguments };
