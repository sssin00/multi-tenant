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
      service: "auth-iam-service",
      timestamp: new Date().toISOString()
    };
  }

  @Get("ready")
  async ready() {
    const readiness = await this.healthService.getReadiness();
    if (readiness.status === "not_ready") {
      throw new ServiceUnavailableException(readiness);
    }

    return readiness;
  }
}
