import type typesModule from "../types.types.ts";

const OPENCODE_SESSION_HEADER = "x-opencode-session";

function hasHeader(headers: typesModule.ProviderHeaders | undefined, name: string): boolean {
  const expected = name.toLowerCase();
  return Object.keys(headers ?? {}).some((key) => key.toLowerCase() === expected);
}

function withSessionHeader<TOptions extends typesModule.StreamOptions>(
  options: TOptions | undefined,
): TOptions | undefined {
  if (
    options?.sessionId === undefined ||
    options?.sessionId === "" ||
    hasHeader(options.headers, OPENCODE_SESSION_HEADER)
  )
    return options;
  return {
    ...options,
    headers: { ...options.headers, [OPENCODE_SESSION_HEADER]: options.sessionId },
  };
}

function withOpenCodeSessionHeader(
  streams: typesModule.ProviderStreams,
): typesModule.ProviderStreams {
  return {
    ...streams,
    stream: (model, context, options) => streams.stream(model, context, withSessionHeader(options)),
    streamSimple: (model, context, options) =>
      streams.streamSimple(model, context, withSessionHeader(options)),
  };
}

const opencodeHeaders = {
  withOpenCodeSessionHeader,
};

export default opencodeHeaders;
