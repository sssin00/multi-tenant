import { AsyncLocalStorage } from "node:async_hooks";

import type { Request } from "express";

export interface WmsRequestContext {
  requestId: string;
  tenantId?: string;
  userId?: string;
}

export interface WmsRequest extends Request {
  context: WmsRequestContext;
}

export const requestContextStorage = new AsyncLocalStorage<WmsRequestContext>();

export function getRequestContext(): WmsRequestContext | undefined {
  return requestContextStorage.getStore();
}
