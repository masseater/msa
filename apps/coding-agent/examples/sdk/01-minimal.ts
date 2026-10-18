import { createAgentSession } from "@msa/coding-agent";
import { Console, Effect } from "effect";

const { session } = await createAgentSession();

try {
  session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });

  await session.prompt("What files are in the current directory?");
  session.state.messages.forEach((msg) => {
    Effect.runSync(Console.log(msg));
  });
  Effect.runSync(Console.log());
} finally {
  session.dispose();
}
