import type { AdminBffRequest } from "../context/request-context.js";

export function authIamContext(req: AdminBffRequest, idempotencyKey?: string) {
  return {
    requestId: req.context.requestId,
    tenantId: req.context.tenantId,
    userId: req.context.userId ?? "",
    idempotencyKey
  };
}

export function success(req: AdminBffRequest, data: unknown) {
  return {
    success: true,
    requestId: req.context.requestId,
    timestamp: new Date().toISOString(),
    data
  };
}
