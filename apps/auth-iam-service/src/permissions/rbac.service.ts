import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../database/prisma.service.js";
import { UserStatus, UserType } from "../generated/prisma/enums.js";
import { OutboxEventService } from "../outbox/outbox-event.service.js";
import {
  asRecord,
  CommandContext,
  readCode,
  readOptionalString,
  readOptionalUuid,
  readPage,
  readPermissionCode,
  readSize,
  requireTenant,
  requireUuid,
  validationFailed
} from "./rbac-utils.js";

export interface RoleResponse {
  id: string;
  tenantId: string | null;
  code: string;
  name: string;
  description: string | null;
  permissions?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UserRoleResponse {
  id: string;
  userId: string;
  roleId: string;
  roleCode: string;
  warehouseId: string | null;
  createdAt: string;
}

const BOOTSTRAP_SYSTEM_ADMIN_USER_ID =
  process.env.AUTH_BOOTSTRAP_SYSTEM_ADMIN_USER_ID
  ?? process.env.LOCAL_SEED_SYSTEM_ADMIN_USER_ID
  ?? "99999999-9999-4999-8999-999999999999";

type AdminActorLevel = "super_admin" | "system_admin" | "tenant_admin" | "tenant_user";

@Injectable()
export class RbacService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(OutboxEventService)
    private readonly outboxEventService: OutboxEventService
  ) {}

  async createRole(context: CommandContext, body: unknown): Promise<RoleResponse> {
    const tenantId = requireTenant(context.tenantId);
    const input = this.validateRoleBody(body, true);
    this.assertTenantRoleCode(input.code as string);
    const existing = await this.prismaService.role.findUnique({
      where: {
        tenantId_code: {
          tenantId,
          code: input.code as string
        }
      },
      select: {
        id: true
      }
    });

    if (existing) {
      throw new ConflictException({
        code: "AUTH_ROLE_CODE_CONFLICT",
        message: "Role code already exists"
      });
    }

    const role = await this.prismaService.$transaction(async (tx) => {
      const createdRole = await tx.role.create({
        data: {
          tenantId,
          code: input.code as string,
          name: input.name as string,
          description: input.description
        },
        include: {
          rolePermissions: {
            include: {
              permission: true
            }
          }
        }
      });
      await this.outboxEventService.record(tx, {
        context: {
          tenantId,
          userId: context.userId,
          requestId: context.requestId
        },
        eventType: "auth.role.created",
        aggregateType: "role",
        aggregateId: createdRole.id,
        data: {
          roleId: createdRole.id,
          code: createdRole.code
        }
      });

      return createdRole;
    });
    return this.toRoleResponse(role);
  }

  async listRoles(context: CommandContext, query: Record<string, unknown>) {
    const systemAdmin = await this.findSystemAdmin(context.userId);
    const tenantId = systemAdmin && !context.tenantId ? undefined : requireTenant(context.tenantId);
    const page = readPage(query.page);
    const size = readSize(query.size);
    const code = readOptionalString(query.code)?.toLowerCase();
    const where = {
      ...(tenantId ? { tenantId } : {}),
      ...(code ? { code: { contains: code } } : {})
    };
    const [items, total] = await Promise.all([
      this.prismaService.role.findMany({
        where,
        include: {
          rolePermissions: {
            include: {
              permission: true
            }
          }
        },
        orderBy: {
          code: "asc"
        },
        skip: (page - 1) * size,
        take: size
      }),
      this.prismaService.role.count({
        where
      })
    ]);

    return {
      items: items.map((role) => this.toRoleResponse(role)),
      page,
      size,
      total
    };
  }

  async getRole(context: CommandContext, roleIdParam: string): Promise<RoleResponse> {
    const tenantId = requireTenant(context.tenantId);
    const roleId = requireUuid(roleIdParam, "roleId");
    const role = await this.prismaService.role.findFirst({
      where: {
        id: roleId,
        tenantId
      },
      include: {
        rolePermissions: {
          include: {
            permission: true
          }
        }
      }
    });

    if (!role) {
      throw this.roleNotFound();
    }

    return this.toRoleResponse(role);
  }

  async updateRole(context: CommandContext, roleIdParam: string, body: unknown): Promise<RoleResponse> {
    const tenantId = requireTenant(context.tenantId);
    const roleId = requireUuid(roleIdParam, "roleId");
    const input = this.validateRoleBody(body, false);
    await this.ensureRole(tenantId, roleId);

    if (input.code) {
      this.assertTenantRoleCode(input.code);
      const existing = await this.prismaService.role.findUnique({
        where: {
          tenantId_code: {
            tenantId,
            code: input.code
          }
        },
        select: {
          id: true
        }
      });

      if (existing && existing.id !== roleId) {
        throw new ConflictException({
          code: "AUTH_ROLE_CODE_CONFLICT",
          message: "Role code already exists"
        });
      }
    }

    const changedFields = Object.keys(input);
    const role = await this.prismaService.$transaction(async (tx) => {
      const updatedRole = await tx.role.update({
        where: {
          id: roleId
        },
        data: input,
        include: {
          rolePermissions: {
            include: {
              permission: true
            }
          }
        }
      });
      await this.outboxEventService.record(tx, {
        context: {
          tenantId,
          userId: context.userId,
          requestId: context.requestId
        },
        eventType: "auth.role.updated",
        aggregateType: "role",
        aggregateId: updatedRole.id,
        data: {
          roleId: updatedRole.id,
          changedFields
        }
      });

      return updatedRole;
    });
    return this.toRoleResponse(role);
  }

  async replaceRolePermissions(context: CommandContext, roleIdParam: string, body: unknown): Promise<RoleResponse> {
    const tenantId = requireTenant(context.tenantId);
    const roleId = requireUuid(roleIdParam, "roleId");
    const permissionCodes = this.readPermissionCodes(body);
    this.assertTenantPermissionCodes(permissionCodes);

    const role = await this.prismaService.$transaction(async (tx) => {
      const existingRole = await tx.role.findFirst({
        where: {
          id: roleId,
          tenantId
        }
      });
      if (!existingRole) {
        throw this.roleNotFound();
      }

      const permissions = await tx.permission.findMany({
        where: {
          code: {
            in: permissionCodes
          }
        }
      });
      const foundCodes = new Set(permissions.map((permission) => permission.code));
      const missing = permissionCodes.filter((code) => !foundCodes.has(code));
      if (missing.length > 0) {
        throw validationFailed({
          permissionCodes: `unknown permission codes: ${missing.join(", ")}`
        });
      }

      await tx.rolePermission.deleteMany({
        where: {
          roleId
        }
      });
      if (permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: permissions.map((permission) => ({
            roleId,
            permissionId: permission.id
          }))
        });
      }

      const updatedRole = await tx.role.findUniqueOrThrow({
        where: {
          id: roleId
        },
        include: {
          rolePermissions: {
            include: {
              permission: true
            }
          }
        }
      });
      await this.outboxEventService.record(tx, {
        context: {
          tenantId,
          userId: context.userId,
          requestId: context.requestId
        },
        eventType: "auth.role.permissionsReplaced",
        aggregateType: "role",
        aggregateId: updatedRole.id,
        data: {
          roleId: updatedRole.id,
          permissionCodes
        }
      });

      return updatedRole;
    });
    return this.toRoleResponse(role);
  }

  async assignUserRole(context: CommandContext, userIdParam: string, body: unknown): Promise<UserRoleResponse> {
    const tenantId = requireTenant(context.tenantId);
    const userId = requireUuid(userIdParam, "userId");
    const input = asRecord(body);
    const roleId = requireUuid(readOptionalString(input.roleId) ?? "", "roleId");
    const warehouseId = readOptionalUuid(input.warehouseId, "warehouseId");

    const assignment = await this.prismaService.$transaction(async (tx) => {
      const user = await tx.authUser.findFirst({
        where: {
          id: userId,
          tenantId
        }
      });
      if (!user) {
        throw new NotFoundException({
          code: "AUTH_USER_NOT_FOUND",
          message: "User not found"
        });
      }

      const role = await tx.role.findFirst({
        where: {
          id: roleId,
          tenantId
        }
      });
      if (!role) {
        throw this.roleNotFound();
      }
      this.assertTenantAdminAssignmentScope(role.code, warehouseId);
      await this.assertCanAssignRole(context, tenantId, role.code);

      const existing = await tx.userRole.findFirst({
        where: {
          userId,
          roleId,
          warehouseId: warehouseId ?? null
        }
      });
      if (existing) {
        throw new ConflictException({
          code: "AUTH_USER_ROLE_CONFLICT",
          message: "User role assignment already exists"
        });
      }

      const createdAssignment = await tx.userRole.create({
        data: {
          userId,
          roleId,
          warehouseId
        },
        include: {
          role: true
        }
      });
      await this.outboxEventService.record(tx, {
        context: {
          tenantId,
          userId: context.userId,
          requestId: context.requestId
        },
        eventType: "auth.userRole.assigned",
        aggregateType: "user_role",
        aggregateId: createdAssignment.id,
        data: {
          userRoleId: createdAssignment.id,
          targetUserId: userId,
          roleId,
          roleCode: createdAssignment.role.code,
          warehouseId: warehouseId ?? null
        }
      });

      return createdAssignment;
    });
    return this.toUserRoleResponse(assignment);
  }

  async listUserRoles(context: CommandContext, userIdParam: string): Promise<{ items: UserRoleResponse[] }> {
    const tenantId = requireTenant(context.tenantId);
    const userId = requireUuid(userIdParam, "userId");
    await this.ensureUser(tenantId, userId);
    const assignments = await this.prismaService.userRole.findMany({
      where: {
        userId,
        role: {
          tenantId
        }
      },
      include: {
        role: true
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    return {
      items: assignments.map((assignment) => this.toUserRoleResponse(assignment))
    };
  }

  async removeUserRole(context: CommandContext, userRoleIdParam: string): Promise<{ removed: boolean }> {
    const tenantId = requireTenant(context.tenantId);
    const userRoleId = requireUuid(userRoleIdParam, "userRoleId");
    await this.prismaService.$transaction(async (tx) => {
      const assignment = await tx.userRole.findFirst({
        where: {
          id: userRoleId,
          role: {
            tenantId
          }
        },
        include: {
          role: true
        }
      });
      if (!assignment) {
        throw new NotFoundException({
          code: "AUTH_USER_ROLE_NOT_FOUND",
          message: "User role assignment not found"
        });
      }

      await tx.userRole.delete({
        where: {
          id: userRoleId
        }
      });
      await this.outboxEventService.record(tx, {
        context: {
          tenantId,
          userId: context.userId,
          requestId: context.requestId
        },
        eventType: "auth.userRole.removed",
        aggregateType: "user_role",
        aggregateId: userRoleId,
        data: {
          userRoleId,
          targetUserId: assignment.userId,
          roleId: assignment.roleId,
          roleCode: assignment.role.code,
          warehouseId: assignment.warehouseId
        }
      });
    });
    return { removed: true };
  }

  async summary(context: CommandContext, query: Record<string, unknown>) {
    const userId = requireUuid(readOptionalString(query.userId) ?? context.userId ?? "", "userId");
    const systemAdmin = await this.findSystemAdmin(userId);
    if (systemAdmin) {
      const permissions = await this.listAllPermissionCodes();
      return {
        userId,
        tenantId: context.tenantId ?? null,
        roles: [{ roleId: "system_admin", roleCode: "system_admin", warehouseId: null }],
        permissions
      };
    }

    const tenantId = requireTenant(context.tenantId);
    const assignments = await this.getActiveUserAssignments(tenantId, userId);
    const permissionCodes = this.collectPermissionCodes(assignments);

    return {
      userId,
      tenantId,
      roles: assignments.map((assignment) => ({
        roleId: assignment.role.id,
        roleCode: assignment.role.code,
        warehouseId: assignment.warehouseId
      })),
      permissions: [...permissionCodes].sort()
    };
  }

  async check(context: CommandContext, body: unknown) {
    const input = asRecord(body);
    const userId = requireUuid(readOptionalString(input.userId) ?? context.userId ?? "", "userId");
    const permissionCode = readPermissionCode(input.permission ?? input.permissionCode, "permission");
    const systemAdmin = await this.findSystemAdmin(userId);
    if (systemAdmin) {
      const scope = asRecord(input.scope);
      const warehouseId = readOptionalUuid(scope.warehouseId, "scope.warehouseId");
      return {
        allowed: true,
        userId,
        tenantId: context.tenantId ?? null,
        permission: permissionCode,
        scope: {
          warehouseId: warehouseId ?? null
        }
      };
    }

    const tenantId = requireTenant(context.tenantId);
    this.assertTenantPermissionCodes([permissionCode]);
    const scope = asRecord(input.scope);
    const warehouseId = readOptionalUuid(scope.warehouseId, "scope.warehouseId");
    const assignments = await this.getActiveUserAssignments(tenantId, userId);
    const allowed = assignments.some((assignment) => {
      if (assignment.warehouseId && warehouseId && assignment.warehouseId !== warehouseId) {
        return false;
      }

      if (assignment.warehouseId && !warehouseId) {
        return false;
      }

      return assignment.role.rolePermissions.some((rolePermission) => rolePermission.permission.code === permissionCode);
    });

    return {
      allowed,
      userId,
      tenantId,
      permission: permissionCode,
      scope: {
        warehouseId: warehouseId ?? null
      }
    };
  }

  private async ensureRole(tenantId: string, roleId: string) {
    const count = await this.prismaService.role.count({
      where: {
        id: roleId,
        tenantId
      }
    });
    if (count === 0) {
      throw this.roleNotFound();
    }
  }

  private async ensureUser(tenantId: string, userId: string) {
    const count = await this.prismaService.authUser.count({
      where: {
        id: userId,
        tenantId
      }
    });
    if (count === 0) {
      throw new NotFoundException({
        code: "AUTH_USER_NOT_FOUND",
        message: "User not found"
      });
    }
  }

  private async getActiveUserAssignments(tenantId: string, userId: string) {
    const user = await this.prismaService.authUser.findFirst({
      where: {
        id: userId,
        tenantId
      },
      select: {
        id: true,
        status: true
      }
    });
    if (!user) {
      throw new NotFoundException({
        code: "AUTH_USER_NOT_FOUND",
        message: "User not found"
      });
    }
    if (user.status !== UserStatus.active) {
      throw new ForbiddenException({
        code: "AUTH_ACCOUNT_LOCKED",
        message: "Account is not active"
      });
    }

    return this.prismaService.userRole.findMany({
      where: {
        userId,
        role: {
          tenantId
        }
      },
      include: {
        role: {
          include: {
            rolePermissions: {
              include: {
                permission: true
              }
            }
          }
        }
      }
    });
  }

  private collectPermissionCodes(assignments: Awaited<ReturnType<RbacService["getActiveUserAssignments"]>>): Set<string> {
    const permissionCodes = new Set<string>();
    for (const assignment of assignments) {
      for (const rolePermission of assignment.role.rolePermissions) {
        permissionCodes.add(rolePermission.permission.code);
      }
    }

    return permissionCodes;
  }

  private validateRoleBody(body: unknown, requireAll: boolean): { code?: string; name?: string; description?: string | null } {
    const input = asRecord(body);
    const data: { code?: string; name?: string; description?: string | null } = {};
    const fields: Record<string, string> = {};

    if (requireAll || input.code !== undefined) {
      data.code = readCode(input.code, "code");
    }

    if (requireAll || input.name !== undefined) {
      const name = readOptionalString(input.name);
      if (!name) {
        fields.name = "name is required";
      } else {
        data.name = name;
      }
    }

    if (input.description !== undefined) {
      const description = readOptionalString(input.description);
      data.description = description ?? null;
    }

    if (Object.keys(fields).length > 0) {
      throw validationFailed(fields);
    }

    if (!requireAll && Object.keys(data).length === 0) {
      throw validationFailed({
        body: "code, name, or description is required"
      });
    }

    return data;
  }

  private readPermissionCodes(body: unknown): string[] {
    const input = asRecord(body);
    const values = Array.isArray(input.permissionCodes) ? input.permissionCodes : [];
    const codes = values.map((value) => readPermissionCode(value, "permissionCodes"));
    return [...new Set(codes)];
  }

  private toRoleResponse(role: {
    id: string;
    tenantId: string | null;
    code: string;
    name: string;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
    rolePermissions?: Array<{ permission: { code: string } }>;
  }): RoleResponse {
    return {
      id: role.id,
      tenantId: role.tenantId,
      code: role.code,
      name: role.name,
      description: role.description,
      permissions: role.rolePermissions?.map((rolePermission) => rolePermission.permission.code).sort(),
      createdAt: role.createdAt.toISOString(),
      updatedAt: role.updatedAt.toISOString()
    };
  }

  private toUserRoleResponse(assignment: {
    id: string;
    userId: string;
    roleId: string;
    warehouseId: string | null;
    createdAt: Date;
    role: { code: string };
  }): UserRoleResponse {
    return {
      id: assignment.id,
      userId: assignment.userId,
      roleId: assignment.roleId,
      roleCode: assignment.role.code,
      warehouseId: assignment.warehouseId,
      createdAt: assignment.createdAt.toISOString()
    };
  }

  private roleNotFound(): NotFoundException {
    return new NotFoundException({
      code: "AUTH_ROLE_NOT_FOUND",
      message: "Role not found"
    });
  }

  private assertTenantRoleCode(roleCode: string) {
    if (roleCode === "system_admin") {
      throw this.adminScopeMismatch("system_admin cannot be created as a tenant-scoped role");
    }
  }

  private async findSystemAdmin(userId: string | undefined): Promise<boolean> {
    if (!userId) {
      return false;
    }

    const user = await this.prismaService.authUser.findUnique({
      where: {
        id: userId
      },
      select: {
        tenantId: true,
        userType: true,
        status: true
      }
    });

    return user?.userType === UserType.system_admin && user.tenantId === null && user.status === UserStatus.active;
  }

  private async findActorLevel(context: CommandContext, tenantId: string): Promise<AdminActorLevel> {
    if (!context.userId) {
      return "tenant_user";
    }

    if (context.userId === BOOTSTRAP_SYSTEM_ADMIN_USER_ID && await this.findSystemAdmin(context.userId)) {
      return "super_admin";
    }

    if (await this.findSystemAdmin(context.userId)) {
      return "system_admin";
    }

    const tenantAdminAssignment = await this.prismaService.userRole.findFirst({
      where: {
        userId: context.userId,
        role: {
          tenantId,
          code: "tenant_admin"
        },
        user: {
          tenantId,
          status: UserStatus.active,
          userType: UserType.general_user
        }
      },
      select: {
        id: true
      }
    });

    return tenantAdminAssignment ? "tenant_admin" : "tenant_user";
  }

  private async assertCanAssignRole(context: CommandContext, tenantId: string, roleCode: string): Promise<void> {
    if (roleCode !== "tenant_admin") {
      return;
    }

    const actorLevel = await this.findActorLevel(context, tenantId);
    if (actorLevel === "tenant_admin" || actorLevel === "tenant_user") {
      throw this.adminScopeMismatch("Tenant administrators cannot assign tenant administrator roles");
    }
  }

  private async listAllPermissionCodes(): Promise<string[]> {
    const permissions = await this.prismaService.permission.findMany({
      select: {
        code: true
      },
      orderBy: {
        code: "asc"
      }
    });

    return permissions.map((permission) => permission.code);
  }

  private assertTenantPermissionCodes(permissionCodes: string[]) {
    const systemPermissions = permissionCodes.filter((code) => code.startsWith("system."));
    if (systemPermissions.length > 0) {
      throw this.adminScopeMismatch(`system permissions are not allowed in tenant scope: ${systemPermissions.join(", ")}`);
    }
  }

  private assertTenantAdminAssignmentScope(roleCode: string, warehouseId: string | undefined) {
    if (roleCode === "tenant_admin" && warehouseId) {
      throw this.adminScopeMismatch("tenant_admin must be assigned at tenant scope without warehouseId");
    }
  }

  private adminScopeMismatch(message: string): ForbiddenException {
    return new ForbiddenException({
      code: "AUTH_ADMIN_SCOPE_MISMATCH",
      message
    });
  }
}
