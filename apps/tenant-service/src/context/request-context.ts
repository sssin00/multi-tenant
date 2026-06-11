import { AsyncLocalStorage } from "node:async_hooks";

import type { Request } from "express";

export interface TenantRequestContext {
  requestId: string;
  tenantId?: string;
  userId?: string;
}

export interface TenantRequest extends Request {
  context: TenantRequestContext;
}

export const requestContextStorage = new AsyncLocalStorage<TenantRequestContext>();

export function getRequestContext(): TenantRequestContext | undefined {
  return requestContextStorage.getStore();
}
