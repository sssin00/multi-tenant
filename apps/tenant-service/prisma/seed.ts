import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/tenant";

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: databaseUrl
  })
});

const tenantId = "11111111-1111-4111-8111-111111111111";

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: {
      id: tenantId
    },
    update: {
      code: "demo",
      name: "Demo Manufacturing",
      status: "active",
      dbStrategy: "shared"
    },
    create: {
      id: tenantId,
      code: "demo",
      name: "Demo Manufacturing",
      status: "active",
      dbStrategy: "shared"
    }
  });

  await prisma.tenantDomain.upsert({
    where: {
      domain: "demo.localhost"
    },
    update: {
      tenantId: tenant.id,
      status: "active"
    },
    create: {
      tenantId: tenant.id,
      domain: "demo.localhost",
      status: "active"
    }
  });

  for (const moduleCode of ["auth", "tenant", "wms"]) {
    await prisma.tenantModule.upsert({
      where: {
        tenantId_moduleCode: {
          tenantId: tenant.id,
          moduleCode
        }
      },
      update: {
        enabled: true
      },
      create: {
        tenantId: tenant.id,
        moduleCode,
        enabled: true
      }
    });
  }

  await prisma.tenantSetting.upsert({
    where: {
      tenantId_key: {
        tenantId: tenant.id,
        key: "locale"
      }
    },
    update: {
      value: {
        language: "ko-KR",
        timezone: "Asia/Seoul",
        currency: "KRW"
      }
    },
    create: {
      tenantId: tenant.id,
      key: "locale",
      value: {
        language: "ko-KR",
        timezone: "Asia/Seoul",
        currency: "KRW"
      }
    }
  });

  console.log("Seeded tenant-service API test data");
  console.table({
    tenantId: tenant.id,
    code: tenant.code,
    name: tenant.name,
    status: tenant.status,
    domain: "demo.localhost",
    modules: "auth, tenant, wms"
  });
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
