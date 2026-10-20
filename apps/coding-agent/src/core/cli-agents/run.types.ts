import type compatTypes from "@msa/ai/compat.types";

import type replyTypes from "./reply.types.ts";

declare namespace runTypes {
  interface CliCommand {
    bin: string;
    args: string[];
    stdin: string;
    env?: NodeJS.ProcessEnv;
  }

  type EventSink = Pick<
    replyTypes.ReplyBuilder,
    "setText" | "appendText" | "appendThinking" | "addUsage"
  > & {
    fail(message: string): void;
  };

  interface CliBackend<Event> {
    providerId: string;
    command(
      model: compatTypes.Model<string>,
      context: compatTypes.TranscriptContext,
      cwd: string,
    ): CliCommand;

    handleEvent(event: Event, sink: EventSink): void;

    shouldRetry(detail: string): boolean;
  }
}

export type { runTypes as default };
