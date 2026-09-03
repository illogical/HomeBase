import { io, type Socket } from "socket.io-client";
import type { OutputChunk, RunState } from "./models";

let sharedSocket: Socket | undefined;

function getSocket(): Socket {
  if (sharedSocket === undefined) {
    sharedSocket = io("/homebase/scripts", { path: "/homebase/socket.io" });
  }
  return sharedSocket;
}

interface OutputEventPayload extends OutputChunk {
  readonly runId: string;
}

export function subscribeToRunOutput(
  runId: string,
  onOutput: (chunk: OutputChunk) => void,
  onStatus: (run: RunState) => void,
): () => void {
  const socket = getSocket();

  const handleOutput = (payload: OutputEventPayload): void => {
    if (payload.runId !== runId) return;
    const { seq, stream, data, timestamp } = payload;
    onOutput({ seq, stream, data, timestamp });
  };
  const handleStatus = (run: RunState): void => {
    if (run.runId !== runId) return;
    onStatus(run);
  };

  socket.emit("join-run", runId);
  socket.on("output", handleOutput);
  socket.on("status", handleStatus);

  return () => {
    socket.off("output", handleOutput);
    socket.off("status", handleStatus);
    socket.emit("leave-run", runId);
  };
}
