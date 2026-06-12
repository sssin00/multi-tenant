import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";

import { HealthService } from "./health.service.js";

@Controller()
export class HealthController {
  constructor(
    @Inject(HealthService)
    private readonly healthService: HealthService
  ) {}

  @Get("health")
  health() {
    return {
      status: "ok",
      service: "admin-bff-service",
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
