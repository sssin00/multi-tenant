import type { RequestContext } from "../context/request-context.js";

export interface SuccessEnvelope<T> {
  success: true;
  requestId: string;
  timestamp: string;
  data: T;
}

export function successEnvelope<T>(context: RequestContext, data: T): SuccessEnvelope<T> {
  return {
    success: true,
    requestId: context.requestId,
    timestamp: new Date().toISOString(),
    data
  };
}
