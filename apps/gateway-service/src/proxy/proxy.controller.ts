import { All, Controller, Inject, Req, Res } from "@nestjs/common";
import type { Response } from "express";

import { getAppConfig } from "../config/app.config.js";
import type { GatewayRequest } from "../context/request-context.js";
import { ProxyService } from "./proxy.service.js";

@Controller("api/v1")
export class ProxyController {
  private readonly routes = getAppConfig().routes;

  constructor(
    @Inject(ProxyService)
    private readonly proxyService: ProxyService
  ) {}

  @All(["auth", "auth/*"])
  auth(@Req() req: GatewayRequest, @Res() res: Response) {
    return this.proxyService.forward(req, res, this.routes.auth);
  }

  @All(["admin", "admin/*"])
  admin(@Req() req: GatewayRequest, @Res() res: Response) {
    return this.proxyService.forward(req, res, this.routes.admin);
  }

  @All(["app", "app/*"])
  app(@Req() req: GatewayRequest, @Res() res: Response) {
    return this.proxyService.forward(req, res, this.routes.app);
  }
}
