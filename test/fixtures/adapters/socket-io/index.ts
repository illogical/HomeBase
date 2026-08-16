import { Server as SocketIoServer } from "socket.io";
import {
  HOSTED_CONTRACT_VERSION,
  type CreateHostedApplication,
  type Disposer,
} from "../../../../src/contracts/hostedApplication.js";

export const effects: string[] = [];
export const counters = { connections: 0 };

const createSocketIoFixture: CreateHostedApplication = (options) => {
  const ioPath = `${options.basePath}socket.io`;
  const io = new SocketIoServer({ path: ioPath });
  io.on("connection", (socket) => {
    effects.push("connection");
    counters.connections += 1;
    socket.on("disconnect", () => {
      counters.connections -= 1;
    });
  });

  return {
    contractVersion: HOSTED_CONTRACT_VERSION,
    async attachRealtime(server) {
      io.attach(server);
      effects.push("attach");

      const disposer: Disposer = async () => {
        io.disconnectSockets(true);
        await new Promise<void>((resolve) => {
          io.close(() => resolve());
        });
      };
      return disposer;
    },
    async getStatus() {
      effects.push("getStatus");
      return {
        state: "ready",
        summary: "Socket.IO fixture ready.",
        since: new Date().toISOString(),
      };
    },
  };
};

export default createSocketIoFixture;
