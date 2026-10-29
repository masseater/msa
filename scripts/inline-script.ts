import { Effect } from "effect";

import hostModule from "./host.ts";

const { Host } = hostModule;

const inlineScript = (file: `${string}.js`) =>
  Effect.gen(function* () {
    const host = yield* Host;
    const source = yield* host.readText(file);
    return `<script>\n${source.replaceAll("</script", String.raw`<\/script`)}\n</script>`;
  });

const inlineScriptModule = { inlineScript };

export default inlineScriptModule;
