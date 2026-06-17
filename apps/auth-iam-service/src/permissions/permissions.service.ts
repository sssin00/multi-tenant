import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../database/prisma.service.js";
import { OutboxEventService } from "../outbox/outbox-event.service.js";
import {
  asRecord,
  CommandContext,
  readOptionalString,
  readPage,
  readPermissionCode,
  readSize,
  requireTenant,
  validationFailed
} from "./rbac-utils.js";

export interface PermissionResponse {
  id: string;
  code: string;
  description: string | null;
  createdAt: string;
}

export interface PermissionListResponse {
  items: PermissionResponse[];
  page: number;
  size: number;
  total: number;
}

@Injectable()
export class PermissionsService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(OutboxEventService)
    private readonly outboxEventService: OutboxEventService
  ) {}

  async create(context: CommandContext, body: unknown): Promise<PermissionResponse> {
    const tenantId = requireTenant(context.tenantId);
    const input = this.validateCreateBody(body);
    const existing = await this.prismaService.permission.findUnique({
      where: {
        code: input.code
      },
      select: {
        id: true
      }
    });

    if (existing) {
      throw new ConflictException({
        code: "AUTH_PERMISSION_CODE_CONFLICT",
        message: "Permission code already exists"
      });
    }

    const permission = await this.prismaService.$transaction(async (tx) => {
      const createdPermission = await tx.permission.create({
        data: input
      });
      await this.outboxEventService.record(tx, {
        context: {
          tenantId,
          userId: context.userId,
          requestId: context.requestId
        },
        eventType: "auth.permission.created",
        aggregateType: "permission",
        aggregateId: createdPermission.id,
        data: {
          permissionId: createdPermission.id,
          code: createdPermission.code
        }
      });

      return createdPermission;
    });
    return this.toResponse(permission);
  }

  async list(query: Record<string, unknown>): Promise<PermissionListResponse> {
    const page = readPage(query.page);
    const size = readSize(query.size);
    const code = readOptionalString(query.code)?.toLowerCase();
    const where = code ? { code: { contains: code } } : {};
    const [items, total] = await Promise.all([
      this.prismaService.permission.findMany({
        where,
        orderBy: {
          code: "asc"
        },
        skip: (page - 1) * size,
        take: size
      }),
      this.prismaService.permission.count({
        where
      })
    ]);

    return {
      items: items.map((permission) => this.toResponse(permission)),
      page,
      size,
      total
    };
  }

  async get(permissionId: string): Promise<PermissionResponse> {
    const permission = await this.prismaService.permission.findUnique({
      where: {
        id: permissionId
      }
    });

    if (!permission) {
      throw this.notFound();
    }

    return this.toResponse(permission);
  }

  private validateCreateBody(body: unknown): { code: string; description?: string } {
    const input = asRecord(body);
    const code = readPermissionCode(input.code, "code");
    const description = readOptionalString(input.description);

    if (description && description.length > 500) {
      throw validationFailed({
        description: "description must be 500 characters or less"
      });
    }

    return {
      code,
      ...(description ? { description } : {})
    };
  }

  private toResponse(permission: {
    id: string;
    code: string;
    description: string | null;
    createdAt: Date;
  }): PermissionResponse {
    return {
      id: permission.id,
      code: permission.code,
      description: permission.description,
      createdAt: permission.createdAt.toISOString()
    };
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: "AUTH_PERMISSION_NOT_FOUND",
      message: "Permission not found"
    });
  }
}
