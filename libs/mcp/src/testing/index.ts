import inMemory from "../transports/in-memory.ts";

const testing = {
  InMemoryTransport: inMemory.InMemoryTransport,
  createInMemoryTransportPair: inMemory.createInMemoryTransportPair,
};

export default testing;
