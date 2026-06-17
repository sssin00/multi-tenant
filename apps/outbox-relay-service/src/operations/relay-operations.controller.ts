import { Controller, Get, Inject } from "@nestjs/common";

import type { OutboxRequestContext } from "../context/request-context.js";
import { getRequestContext } from "../context/request-context.js";
import { RelayStatusService } from "../relay/relay-status.service.js";
import { OutboxSourceRegistryService } from "../sources/outbox-source-registry.service.js";

@Controller("internal/operations/outbox-relay")
export class RelayOperationsController {
  constructor(
    @Inject(RelayStatusService)
    private readonly relayStatusService: RelayStatusService,
    @Inject(OutboxSourceRegistryService)
    private readonly sourceRegistry: OutboxSourceRegistryService
  ) {}

  @Get("status")
  getStatus() {
    return successResponse(getRequestContext(), this.relayStatusService.getStatus());
  }

  @Get("sources")
  async getSources() {
    const stats = await this.sourceRegistry.getStats();
    return successResponse(getRequestContext(), { items: stats });
  }
}

function successResponse(context: OutboxRequestContext | undefined, data: unknown) {
  return {
    success: true,
    requestId: context?.requestId,
    timestamp: new Date().toISOString(),
    data
  };
}
