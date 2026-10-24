const child = new URL("./child.ts", import.meta.url);

const command = { args: [child.pathname], file: process.execPath };

export default command;
