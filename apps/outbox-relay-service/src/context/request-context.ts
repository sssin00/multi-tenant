import { AsyncLocalStorage } from "node:async_hooks";

import type { Request } from "express";

export interface OutboxRequestContext {
  requestId: string;
  tenantId?: string;
  userId?: string;
}

export interface OutboxRequest extends Request {
  context: OutboxRequestContext;
}

export const requestContextStorage = new AsyncLocalStorage<OutboxRequestContext>();

export function getRequestContext(): OutboxRequestContext | undefined {
  return requestContextStorage.getStore();
}
