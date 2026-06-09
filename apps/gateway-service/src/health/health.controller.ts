import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";

import { Public } from "../auth/public.decorator.js";
import { HealthService } from "./health.service.js";

@Controller()
export class HealthController {
  constructor(
    @Inject(HealthService)
    private readonly healthService: HealthService
  ) {}

  @Public()
  @Get("health")
  health() {
    return {
      status: "ok",
      service: "gateway-service",
      timestamp: new Date().toISOString()
    };
  }

  @Public()
  @Get("ready")
  ready() {
    const readiness = this.healthService.getReadiness();
    if (readiness.status === "not_ready") {
      throw new ServiceUnavailableException(readiness);
    }

    return readiness;
  }
}
