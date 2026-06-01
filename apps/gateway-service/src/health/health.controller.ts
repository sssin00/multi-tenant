import { Controller, Get } from "@nestjs/common";

@Controller()
export class HealthController {
  @Get("health")
  health() {
    return {
      status: "ok",
      service: "gateway-service"
    };
  }

  @Get("ready")
  ready() {
    return {
      status: "ready",
      service: "gateway-service"
    };
  }
}
