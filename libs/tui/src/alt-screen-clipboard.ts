import { Effect } from "effect";
import { dual } from "effect/Function";

const COPY_ERROR_FLASH_DURATION_MS = 5000;

export interface ClipboardTarget {
  copySelection: ((text: string) => Promise<boolean | string>) | undefined;
  write(data: string): void;
  flash(message: string, durationMs?: number): void;
}

export const copyToClipboard: {
  (text: string, target: ClipboardTarget): Promise<boolean>;
  (target: ClipboardTarget): (text: string) => Promise<boolean>;
} = dual(2, (text: string, target: ClipboardTarget): Promise<boolean> => {
  const copySelection = target.copySelection;
  if (copySelection === undefined) {
    return Effect.runPromise(
      Effect.sync(() => {
        target.write(`\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`);
        target.flash("Copied!");
        return true;
      }),
    );
  }
  return Effect.runPromise(
    Effect.promise(() => copySelection(text)).pipe(
      Effect.map((result) => {
        const ok = result === true;
        target.flash(
          ok ? "Copied!" : typeof result === "string" ? result : "Copy failed",
          ok ? undefined : COPY_ERROR_FLASH_DURATION_MS,
        );
        return ok;
      }),
    ),
  );
});
