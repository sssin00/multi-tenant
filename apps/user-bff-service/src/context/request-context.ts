export interface RequestContext {
  requestId: string;
  tenantId?: string;
  userId?: string;
  authorization?: string;
}

export interface RequestWithContext {
  method: string;
  originalUrl?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  context?: RequestContext;
}
