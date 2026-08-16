import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import {
  HOSTED_CONTRACT_VERSION,
  type CreateHostedApplication,
  type Disposer,
} from "../../../../src/contracts/hostedApplication.js";

export const effects: string[] = [];
export const counters = { connections: 0, upgradeEvents: 0 };

const createWebSocketFixture: CreateHostedApplication = (options) => {
  const upgradePath = `${options.basePath}socket`;
  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (socket) => {
    effects.push("connection");
    counters.connections += 1;
    socket.on("close", () => {
      counters.connections -= 1;
    });
  });

  return {
    contractVersion: HOSTED_CONTRACT_VERSION,
    async attachRealtime(server) {
      const handleUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
        counters.upgradeEvents += 1;
        const url = request.url ?? "";
        if (!url.startsWith(upgradePath)) return;
        effects.push("handle-upgrade");
        wss.handleUpgrade(request, socket, head, (client) => {
          wss.emit("connection", client, request);
        });
      };
      server.on("upgrade", handleUpgrade);

      const disposer: Disposer = () => {
        server.off("upgrade", handleUpgrade);
        for (const client of wss.clients) client.terminate();
        wss.close();
      };
      return disposer;
    },
    async getStatus() {
      effects.push("getStatus");
      return {
        state: "ready",
        summary: "WebSocket fixture ready.",
        since: new Date().toISOString(),
      };
    },
  };
};

export default createWebSocketFixture;
