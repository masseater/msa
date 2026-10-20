import setup from "./cli/setup.ts";
import mainModule from "./main.ts";

const { setupCli } = setup;
const { main } = mainModule;

setupCli();
main(process.argv.slice(2));
