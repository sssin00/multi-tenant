import { AsyncLocalStorage } from "node:async_hooks";

import type { Request } from "express";

export interface AdminBffRequestContext {
  requestId: string;
  tenantId?: string;
  userId?: string;
}

export interface AdminBffRequest extends Request {
  context: AdminBffRequestContext;
}

export const requestContextStorage = new AsyncLocalStorage<AdminBffRequestContext>();

export function getRequestContext(): AdminBffRequestContext | undefined {
  return requestContextStorage.getStore();
}
