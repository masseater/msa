import runCalls from "./run-calls.ts";
import runDocs from "./run-docs.ts";
import RunJournal from "./run-journal.ts";
import runPersist from "./run-persist.ts";
import runStart from "./run-start.ts";

const runKit = {
  RunJournal,
  runCalls,
  runDocs,
  runPersist,
  runStart,
};

export default runKit;
