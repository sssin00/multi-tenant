import type { NextFunction, Response } from "express";
import { Injectable, Logger, NestMiddleware } from "@nestjs/common";
import type { RequestWithContext } from "../context/request-context.js";

@Injectable()
export class AccessLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AccessLogMiddleware.name);

  use(req: RequestWithContext, res: Response, next: NextFunction): void {
    const startedAt = Date.now();

    res.on("finish", () => {
      const durationMs = Date.now() - startedAt;
      this.logger.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          service: "user-bff-service",
          requestId: req.context?.requestId,
          tenantId: req.context?.tenantId,
          userId: req.context?.userId,
          method: req.method,
          path: req.originalUrl ?? req.url,
          statusCode: res.statusCode,
          durationMs,
          message: "request completed"
        })
      );
    });

    next();
  }
}
