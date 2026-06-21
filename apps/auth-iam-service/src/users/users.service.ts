import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";

import { PrismaService } from "../database/prisma.service.js";
import { UserStatus, UserType } from "../generated/prisma/enums.js";
import { OutboxEventService } from "../outbox/outbox-event.service.js";
import { PasswordHasher } from "../auth/password-hasher.js";

export interface UserCommandContext {
  tenantId?: string;
  userId?: string;
  requestId?: string;
}

export interface CreateUserCommand extends UserCommandContext {
  body: unknown;
}

export interface ListUsersQuery extends UserCommandContext {
  page?: unknown;
  size?: unknown;
  status?: unknown;
  email?: unknown;
}

export interface UserIdCommand extends UserCommandContext {
  userIdParam: string;
}

export interface UpdateUserCommand extends UserIdCommand {
  body: unknown;
}

export interface UpdateUserStatusCommand extends UserIdCommand {
  body: unknown;
}

export interface UserResponse {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  userType: UserType;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

export interface UserListResponse {
  items: UserResponse[];
  page: number;
  size: number;
  total: number;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(PasswordHasher)
    private readonly passwordHasher: PasswordHasher,
    @Inject(OutboxEventService)
    private readonly outboxEventService: OutboxEventService
  ) {}

  async create(command: CreateUserCommand): Promise<UserResponse> {
    const tenantId = this.requireTenant(command.tenantId);
    const input = this.validateCreateBody(command.body);
    const existing = await this.prismaService.authUser.findUnique({
      where: {
        tenantId_email: {
          tenantId,
          email: input.email
        }
      },
      select: {
        id: true
      }
    });

    if (existing) {
      throw new ConflictException({
        code: "AUTH_USER_EMAIL_CONFLICT",
        message: "User email already exists"
      });
    }

    const passwordHash = await this.passwordHasher.hash(input.password);
    const user = await this.prismaService.$transaction(async (tx) => {
      const createdUser = await tx.authUser.create({
        data: {
          tenantId,
          email: input.email,
          displayName: input.displayName,
          passwordHash,
          userType: input.userType,
          status: input.status
        }
      });
      await this.outboxEventService.record(tx, {
        context: {
          tenantId,
          userId: command.userId,
          requestId: command.requestId
        },
        eventType: "auth.user.created",
        aggregateType: "auth_user",
        aggregateId: createdUser.id,
        data: {
          userId: createdUser.id,
          userType: createdUser.userType,
          status: createdUser.status
        }
      });

      return createdUser;
    });
    return this.toResponse(user);
  }

  async list(query: ListUsersQuery): Promise<UserListResponse> {
    const tenantId = this.requireTenant(query.tenantId);
    const page = this.readPage(query.page);
    const size = this.readSize(query.size);
    const where = {
      tenantId,
      ...(this.readOptionalStatus(query.status) ? { status: this.readOptionalStatus(query.status) } : {}),
      ...(this.readOptionalEmail(query.email) ? { email: { contains: this.readOptionalEmail(query.email) } } : {})
    };

    const [items, total] = await Promise.all([
      this.prismaService.authUser.findMany({
        where,
        orderBy: {
          createdAt: "desc"
        },
        skip: (page - 1) * size,
        take: size
      }),
      this.prismaService.authUser.count({
        where
      })
    ]);

    return {
      items: items.map((user) => this.toResponse(user)),
      page,
      size,
      total
    };
  }

  async get(command: UserIdCommand): Promise<UserResponse> {
    const tenantId = this.requireTenant(command.tenantId);
    const userId = this.requireUuid(command.userIdParam, "userId");
    const user = await this.prismaService.authUser.findFirst({
      where: {
        id: userId,
        tenantId
      }
    });

    if (!user) {
      throw this.notFound();
    }

    return this.toResponse(user);
  }

  async update(command: UpdateUserCommand): Promise<UserResponse> {
    const tenantId = this.requireTenant(command.tenantId);
    const userId = this.requireUuid(command.userIdParam, "userId");
    const input = this.validateUpdateBody(command.body);
    await this.ensureUserExists(tenantId, userId);

    if (input.email) {
      const existing = await this.prismaService.authUser.findUnique({
        where: {
          tenantId_email: {
            tenantId,
            email: input.email
          }
        },
        select: {
          id: true
        }
      });

      if (existing && existing.id !== userId) {
        throw new ConflictException({
          code: "AUTH_USER_EMAIL_CONFLICT",
          message: "User email already exists"
        });
      }
    }

    const changedFields = Object.keys(input);
    const user = await this.prismaService.$transaction(async (tx) => {
      const updatedUser = await tx.authUser.update({
        where: {
          id: userId
        },
        data: input
      });
      await this.outboxEventService.record(tx, {
        context: {
          tenantId,
          userId: command.userId,
          requestId: command.requestId
        },
        eventType: "auth.user.updated",
        aggregateType: "auth_user",
        aggregateId: updatedUser.id,
        data: {
          userId: updatedUser.id,
          changedFields
        }
      });

      return updatedUser;
    });
    return this.toResponse(user);
  }

  async updateStatus(command: UpdateUserStatusCommand): Promise<UserResponse> {
    const tenantId = this.requireTenant(command.tenantId);
    const userId = this.requireUuid(command.userIdParam, "userId");
    const status = this.validateStatusBody(command.body);
    const now = new Date();

    const user = await this.prismaService.$transaction(async (tx) => {
      const existing = await tx.authUser.findFirst({
        where: {
          id: userId,
          tenantId
        }
      });

      if (!existing) {
        throw this.notFound();
      }

      const updatedUser = await tx.authUser.update({
        where: {
          id: userId
        },
        data: {
          status
        }
      });

      if (status !== UserStatus.active) {
        await tx.refreshToken.updateMany({
          where: {
            tenantId,
            userId,
            revokedAt: null
          },
          data: {
            revokedAt: now
          }
        });
      }

      await this.outboxEventService.record(tx, {
        context: {
          tenantId,
          userId: command.userId,
          requestId: command.requestId
        },
        eventType: "auth.user.statusChanged",
        aggregateType: "auth_user",
        aggregateId: updatedUser.id,
        data: {
          userId: updatedUser.id,
          status
        }
      });

      return updatedUser;
    });
    return this.toResponse(user);
  }

  async remove(command: UserIdCommand): Promise<UserResponse> {
    const user = await this.updateStatus({
      ...command,
      body: {
        status: UserStatus.inactive
      }
    });

    return user;
  }

  private async ensureUserExists(tenantId: string, userId: string) {
    const count = await this.prismaService.authUser.count({
      where: {
        id: userId,
        tenantId
      }
    });

    if (count === 0) {
      throw this.notFound();
    }
  }

  private validateCreateBody(body: unknown): {
    email: string;
    displayName: string;
    password: string;
    userType: UserType;
    status: UserStatus;
  } {
    const input = this.asRecord(body);
    const email = this.readEmail(input.email);
    const displayName = this.readString(input.displayName);
    const password = typeof input.password === "string" ? input.password : "";
    const userType = this.readUserType(input.userType);
    const status = this.readStatus(input.status, UserStatus.active);
    const fields: Record<string, string> = {};

    if (!email) {
      fields.email = "email is required";
    }

    if (!displayName) {
      fields.displayName = "displayName is required";
    }

    if (!password) {
      fields.password = "password is required";
    } else if (password.length < 8) {
      fields.password = "password must be at least 8 characters";
    }

    if (userType !== UserType.general_user) {
      fields.userType = "tenant-scoped user API only supports general_user";
    }

    if (Object.keys(fields).length > 0) {
      throw this.validationFailed(fields);
    }

    return {
      email,
      displayName,
      password,
      userType,
      status
    };
  }

  private validateUpdateBody(body: unknown): { email?: string; displayName?: string } {
    const input = this.asRecord(body);
    const email = input.email === undefined ? undefined : this.readEmail(input.email);
    const displayName = input.displayName === undefined ? undefined : this.readString(input.displayName);
    const fields: Record<string, string> = {};
    const data: { email?: string; displayName?: string } = {};

    if (input.email !== undefined) {
      if (!email) {
        fields.email = "email must be a valid email";
      } else {
        data.email = email;
      }
    }

    if (input.displayName !== undefined) {
      if (!displayName) {
        fields.displayName = "displayName must not be empty";
      } else {
        data.displayName = displayName;
      }
    }

    if (Object.keys(fields).length > 0) {
      throw this.validationFailed(fields);
    }

    if (Object.keys(data).length === 0) {
      throw this.validationFailed({
        body: "email or displayName is required"
      });
    }

    return data;
  }

  private validateStatusBody(body: unknown): UserStatus {
    const input = this.asRecord(body);
    return this.readStatus(input.status);
  }

  private readPage(value: unknown): number {
    const page = Number(value ?? 1);
    if (!Number.isInteger(page) || page < 1) {
      throw this.validationFailed({
        page: "page must be an integer greater than or equal to 1"
      });
    }

    return page;
  }

  private readSize(value: unknown): number {
    const size = Number(value ?? 20);
    if (!Number.isInteger(size) || size < 1 || size > 100) {
      throw this.validationFailed({
        size: "size must be an integer between 1 and 100"
      });
    }

    return size;
  }

  private readOptionalEmail(value: unknown): string | undefined {
    const email = this.readString(value);
    return email ? email.toLowerCase() : undefined;
  }

  private readEmail(value: unknown): string {
    const email = this.readString(value).toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return "";
    }

    return email;
  }

  private readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  private readOptionalStatus(value: unknown): UserStatus | undefined {
    if (value === undefined || value === "") {
      return undefined;
    }

    return this.readStatus(value);
  }

  private readStatus(value: unknown, defaultStatus?: UserStatus): UserStatus {
    if (value === undefined && defaultStatus) {
      return defaultStatus;
    }

    if (value === UserStatus.active || value === UserStatus.inactive || value === UserStatus.locked) {
      return value;
    }

    throw this.validationFailed({
      status: "status must be active, inactive, or locked"
    });
  }

  private readUserType(value: unknown): UserType {
    if (value === undefined || value === null || value === "") {
      return UserType.general_user;
    }

    if (value === UserType.general_user || value === UserType.system_admin) {
      return value;
    }

    throw this.validationFailed({
      userType: "userType must be system_admin or general_user"
    });
  }

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        code: "TENANT_REQUIRED",
        message: "Tenant is required",
        details: {
          fields: {
            tenantId: "X-Tenant-Id is required"
          }
        }
      });
    }

    return this.requireUuid(tenantId, "tenantId");
  }

  private requireUuid(value: string, fieldName: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw this.validationFailed({
        [fieldName]: `${fieldName} must be a UUID`
      });
    }

    return value;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  }

  private toResponse(user: {
    id: string;
    tenantId: string;
    email: string;
    displayName: string;
    userType: UserType;
    status: UserStatus;
    createdAt: Date;
    updatedAt: Date;
  }): UserResponse {
    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      displayName: user.displayName,
      userType: user.userType,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString()
    };
  }

  private validationFailed(fields: Record<string, string>): BadRequestException {
    return new BadRequestException({
      code: "VALIDATION_FAILED",
      message: "Validation failed",
      details: {
        fields
      }
    });
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: "AUTH_USER_NOT_FOUND",
      message: "User not found"
    });
  }
}
