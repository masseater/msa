import InMemoryTransport from "./in-memory-transport.ts";

function createInMemoryTransportPair(): {
  client: InMemoryTransport;
  server: InMemoryTransport;
} {
  const client = new InMemoryTransport();
  const server = new InMemoryTransport();
  client.connectPeer(server);
  server.connectPeer(client);
  return { client, server };
}

const inMemory = {
  InMemoryTransport,
  createInMemoryTransportPair,
};

export default inMemory;
