import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import memory from "@msa/durable/storage/memory";

const exampleSubagentForegroundKit = {
  durable,
  harnessModule,
  memory,
};

export default exampleSubagentForegroundKit;
