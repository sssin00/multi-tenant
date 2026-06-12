import { SetMetadata } from "@nestjs/common";

export const INTERNAL_SERVICE_AUTH = "internalServiceAuth";

export interface InternalServiceAuthOptions {
  allowedServices?: string[];
}

export const InternalService = (options: InternalServiceAuthOptions = {}) =>
  SetMetadata(INTERNAL_SERVICE_AUTH, options);
