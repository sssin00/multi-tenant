import { AsyncLocalStorage } from "node:async_hooks";

import type { Request } from "express";

export interface GatewayRequestContext {
  requestId: string;
  tenantId?: string;
  userId?: string;
}

export interface GatewayRequest extends Request {
  context: GatewayRequestContext;
}

export const requestContextStorage = new AsyncLocalStorage<GatewayRequestContext>();

export function getRequestContext(): GatewayRequestContext | undefined {
  return requestContextStorage.getStore();
}
