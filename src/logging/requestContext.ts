import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export interface RequestContext {
  readonly requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

const REQUEST_ID_HEADER = "x-request-id";
const VALID_REQUEST_ID = /^[A-Za-z0-9_.-]{1,128}$/;

export function requestIdMiddleware() {
  return (request: Request, response: Response, next: NextFunction): void => {
    const inbound = request.header(REQUEST_ID_HEADER);
    const requestId = inbound !== undefined && VALID_REQUEST_ID.test(inbound)
      ? inbound
      : randomUUID();
    response.setHeader("X-Request-Id", requestId);
    storage.run({ requestId }, () => next());
  };
}
