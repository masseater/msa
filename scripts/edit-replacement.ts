import { Buffer } from "node:buffer";

import { Array as Arr, Predicate } from "effect";

import type editReplacementTypes from "./edit-replacement.types.ts";
import type hostTypes from "./host.types.ts";
import statsFormat from "./stats-format.ts";

const { median } = statsFormat;

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

const analyzeReplacement = (oldText: string, newText: string): editReplacementTypes.Replacement => {
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
    coreBytes,
    coreNewBytes,
    coreOldBytes,
    inflationRatio: coreBytes === 0 ? null : totalEditBytes / coreBytes,
    newBytes,
    noCoreChange: coreBytes === 0,
    oldBytes,
    sharedContextBytes: sharedPrefixBytes + sharedSuffixBytes,
    sharedPrefixBytes,
    sharedSuffixBytes,
    totalEditBytes,
    wrapperPayloadBytes: totalEditBytes - coreBytes,
  };
};

const dotfileExtension = (base: string): string =>
  base.startsWith(".") && !base.slice(1).includes(".") ? base.toLowerCase() : "[no_ext]";

const pathExtension = (host: hostTypes.HostShape, filePath: string): string => {
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

const sumReplacements = (perEdit: ReadonlyArray<editReplacementTypes.Replacement>) =>
  perEdit.reduce(
    (totals, edit) => ({
      coreBytes: totals.coreBytes + edit.coreBytes,
      coreNewBytes: totals.coreNewBytes + edit.coreNewBytes,
      coreOldBytes: totals.coreOldBytes + edit.coreOldBytes,
      newBytes: totals.newBytes + edit.newBytes,
      noCoreChangeCount: totals.noCoreChangeCount + (edit.noCoreChange ? 1 : 0),
      oldBytes: totals.oldBytes + edit.oldBytes,
      sharedContextBytes: totals.sharedContextBytes + edit.sharedContextBytes,
      sharedPrefixBytes: totals.sharedPrefixBytes + edit.sharedPrefixBytes,
      sharedSuffixBytes: totals.sharedSuffixBytes + edit.sharedSuffixBytes,
      totalEditBytes: totals.totalEditBytes + edit.totalEditBytes,
      wrapperPayloadBytes: totals.wrapperPayloadBytes + edit.wrapperPayloadBytes,
    }),
    {
      coreBytes: 0,
      coreNewBytes: 0,
      coreOldBytes: 0,
      newBytes: 0,
      noCoreChangeCount: 0,
      oldBytes: 0,
      sharedContextBytes: 0,
      sharedPrefixBytes: 0,
      sharedSuffixBytes: 0,
      totalEditBytes: 0,
      wrapperPayloadBytes: 0,
    },
  );

const multiAnalysis = (options: {
  readonly argStyle: string;
  readonly edits: ReadonlyArray<unknown>;
  readonly extension: string;
  readonly path: string;
}): editReplacementTypes.EditAnalysis => {
  const perEdit = options.edits.map((edit) =>
    analyzeReplacement(stringField(edit, "oldText") ?? "", stringField(edit, "newText") ?? ""),
  );
  const inflations = perEdit.flatMap((edit) =>
    edit.inflationRatio === null ? [] : [edit.inflationRatio],
  );
  const totals = sumReplacements(perEdit);
  return {
    argStyle: options.argStyle,
    editsCount: options.edits.length,
    extension: options.extension,
    mode: "multi",
    path: options.path,
    ...totals,
    inflationRatio: totals.coreBytes === 0 ? null : totals.totalEditBytes / totals.coreBytes,
    maxEditInflationRatio: inflations.length > 0 ? Math.max(...inflations) : null,
    medianEditInflationRatio: median(inflations),
    perEdit,
  };
};

const analyzeEditArguments = (options: {
  readonly args: unknown;
  readonly host: hostTypes.HostShape;
}): editReplacementTypes.EditAnalysis => {
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
    argStyle,
    editsCount: 1,
    extension,
    mode: "single",
    path,
    ...replacement,
    maxEditInflationRatio: replacement.inflationRatio,
    medianEditInflationRatio: replacement.inflationRatio,
    perEdit: [replacement],
  };
};

const editReplacement = {
  analyzeEditArguments,
};

export default editReplacement;
