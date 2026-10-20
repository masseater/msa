import { Data } from "effect";

export default class WadDownloadError extends Data.TaggedError("WadDownloadError")<{
  readonly message: string;
}> {}
