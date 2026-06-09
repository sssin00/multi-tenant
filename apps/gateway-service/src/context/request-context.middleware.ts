import { randomUUID } from "node:crypto";

import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Response } from "express";

import { getAppConfig } from "../config/app.config.js";
import type { GatewayRequest, GatewayRequestContext } from "./request-context.js";
import { requestContextStorage } from "./request-context.js";

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly config = getAppConfig();

  use(req: GatewayRequest, res: Response, next: NextFunction) {
    const requestId = this.readHeader(req, this.config.requestIdHeader) ?? randomUUID();
    const tenantId = this.readHeader(req, this.config.tenantHeader);
    const context: GatewayRequestContext = {
      requestId,
      tenantId
    };

    req.context = context;
    res.setHeader(this.config.requestIdHeader, requestId);
    if (tenantId) {
      res.setHeader(this.config.tenantHeader, tenantId);
    }

    requestContextStorage.run(context, next);
  }

  private readHeader(req: GatewayRequest, headerName: string): string | undefined {
    const headerValue = req.headers[headerName.toLowerCase()];
    if (Array.isArray(headerValue)) {
      return headerValue[0];
    }

    return headerValue;
  }
}
