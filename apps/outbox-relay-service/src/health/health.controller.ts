import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";

import { getAppConfig } from "../config/app.config.js";
import { HealthService } from "./health.service.js";

@Controller()
export class HealthController {
  private readonly config = getAppConfig();

  constructor(
    @Inject(HealthService)
    private readonly healthService: HealthService
  ) {}

  @Get("health")
  health() {
    return {
      status: "ok",
      service: this.config.serviceName,
      timestamp: new Date().toISOString()
    };
  }

  @Get("ready")
  ready() {
    const readiness = this.healthService.getReadiness();
    if (readiness.status === "not_ready") {
      throw new ServiceUnavailableException(readiness);
    }

    return readiness;
  }
}
