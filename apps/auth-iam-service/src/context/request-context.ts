import { AsyncLocalStorage } from "node:async_hooks";

import type { Request } from "express";

export interface AuthIamRequestContext {
  requestId: string;
  tenantId?: string;
  userId?: string;
}

export interface AuthIamRequest extends Request {
  context: AuthIamRequestContext;
}

export const requestContextStorage = new AsyncLocalStorage<AuthIamRequestContext>();

export function getRequestContext(): AuthIamRequestContext | undefined {
  return requestContextStorage.getStore();
}
