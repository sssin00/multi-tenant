import type { NextFunction, Request, Response } from "express";
import { Injectable, NestMiddleware } from "@nestjs/common";
import { loadAppConfig } from "../config/app.config.js";

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  private readonly config = loadAppConfig();

  use(_req: Request, res: Response, next: NextFunction): void {
    if (this.config.securityHeadersEnabled) {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    }

    next();
  }
}
