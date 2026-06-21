import { Controller, Get } from "@nestjs/common";
import { HealthService, HealthStatus, ReadinessStatus } from "./health.service.js";

@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get("health")
  getHealth(): HealthStatus {
    return this.healthService.getHealth();
  }

  @Get("ready")
  getReadiness(): ReadinessStatus {
    return this.healthService.getReadiness();
  }
}
