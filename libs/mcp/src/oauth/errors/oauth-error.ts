import { Data } from "effect";

export default class OAuthError extends Data.TaggedError("OAuthError")<{
  readonly code: string;
  readonly message: string;
  readonly errorUri: string | undefined;
}> {
  constructor(code: string, message: string, errorUri?: string) {
    super({ code, errorUri, message: message.length > 0 ? message : code });
  }
}
