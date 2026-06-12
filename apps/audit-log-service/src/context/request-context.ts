import { AsyncLocalStorage } from "node:async_hooks";

import type { Request } from "express";

export interface AuditRequestContext {
  requestId: string;
  tenantId?: string;
  userId?: string;
}

export interface AuditRequest extends Request {
  context: AuditRequestContext;
}

export const requestContextStorage = new AsyncLocalStorage<AuditRequestContext>();

export function getRequestContext(): AuditRequestContext | undefined {
  return requestContextStorage.getStore();
}
