import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client.js";

const scrypt = promisify(scryptCallback);
const keyLength = 64;

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/auth_iam";

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: databaseUrl
  })
});

const tenantId = process.env.LOCAL_SEED_TENANT_ID ?? "11111111-1111-4111-8111-111111111111";
const adminUserId = "22222222-2222-4222-8222-222222222222";
const tenantAdminRoleId = "33333333-3333-4333-8333-333333333333";

const permissions = [
  {
    code: "auth.users.read",
    description: "Read users in the tenant"
  },
  {
    code: "auth.users.create",
    description: "Create users in the tenant"
  },
  {
    code: "auth.users.update",
    description: "Update users in the tenant"
  },
  {
    code: "auth.users.updateStatus",
    description: "Update user status in the tenant"
  },
  {
    code: "auth.users.delete",
    description: "Delete users in the tenant"
  },
  {
    code: "auth.userRoles.manage",
    description: "Manage user role assignments in the tenant"
  },
  {
    code: "auth.permissions.read",
    description: "Read permission catalog in the tenant"
  },
  {
    code: "auth.permissions.create",
    description: "Create permission catalog entries in the tenant"
  },
  {
    code: "auth.roles.read",
    description: "Read roles and permissions in the tenant"
  },
  {
    code: "auth.roles.create",
    description: "Create roles in the tenant"
  },
  {
    code: "auth.roles.update",
    description: "Update roles and permissions in the tenant"
  },
  {
    code: "auth.rolePermissions.manage",
    description: "Manage role permission assignments in the tenant"
  },
  {
    code: "tenant.tenants.read",
    description: "Read tenant status and module settings"
  },
  {
    code: "tenant.tenants.create",
    description: "Create tenants"
  },
  {
    code: "tenant.tenants.update",
    description: "Update tenant settings"
  },
  {
    code: "tenant.tenants.updateStatus",
    description: "Update tenant status"
  },
  {
    code: "tenant.modules.manage",
    description: "Manage tenant module subscriptions"
  },
  {
    code: "tenant.domains.read",
    description: "Read tenant domains"
  },
  {
    code: "tenant.domains.manage",
    description: "Manage tenant domains"
  },
  {
    code: "audit.logs.read",
    description: "Read audit logs"
  },
  {
    code: "wms.inventory.read",
    description: "Read WMS inventory"
  },
  {
    code: "wms.inventory.adjust",
    description: "Adjust WMS inventory"
  }
];

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derivedKey = (await scrypt(password, salt, keyLength)) as Buffer;

  return `scrypt$${salt}$${derivedKey.toString("base64url")}`;
}

async function main() {
  const passwordHash = await hashPassword("Test1234!");

  const user = await prisma.authUser.upsert({
    where: {
      tenantId_email: {
        tenantId,
        email: "admin@demo.local"
      }
    },
    update: {
      id: adminUserId,
      displayName: "Demo Tenant Admin",
      passwordHash,
      status: "active"
    },
    create: {
      id: adminUserId,
      tenantId,
      email: "admin@demo.local",
      displayName: "Demo Tenant Admin",
      passwordHash,
      status: "active"
    }
  });

  const role = await prisma.role.upsert({
    where: {
      tenantId_code: {
        tenantId,
        code: "tenant_admin"
      }
    },
    update: {
      id: tenantAdminRoleId,
      name: "Tenant Admin",
      description: "Local API test tenant administrator"
    },
    create: {
      id: tenantAdminRoleId,
      tenantId,
      code: "tenant_admin",
      name: "Tenant Admin",
      description: "Local API test tenant administrator"
    }
  });

  const permissionRows = [];
  for (const permission of permissions) {
    permissionRows.push(
      await prisma.permission.upsert({
        where: {
          code: permission.code
        },
        update: {
          description: permission.description
        },
        create: permission
      })
    );
  }

  for (const permission of permissionRows) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: role.id,
          permissionId: permission.id
        }
      },
      update: {},
      create: {
        roleId: role.id,
        permissionId: permission.id
      }
    });
  }

  const existingUserRole = await prisma.userRole.findFirst({
    where: {
      userId: user.id,
      roleId: role.id,
      warehouseId: null
    }
  });

  if (!existingUserRole) {
    await prisma.userRole.create({
      data: {
        userId: user.id,
        roleId: role.id,
        warehouseId: null
      }
    });
  }

  console.log("Seeded auth-iam-service API test data");
  console.table({
    tenantId,
    userId: user.id,
    email: user.email,
    password: "Test1234!",
    role: role.code
  });
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
