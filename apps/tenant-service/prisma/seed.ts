import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/tenant";

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: databaseUrl
  })
});

const tenantId = process.env.LOCAL_SEED_TENANT_ID ?? "11111111-1111-4111-8111-111111111111";
const tenantName = "Demo Manufacturing";
const tenantDomain = "demo.localhost";
const tenantCode = createTenantCode({
  domain: tenantDomain,
  name: tenantName,
  sequence: 1
});

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: {
      id: tenantId
    },
    update: {
      code: tenantCode,
      name: tenantName,
      dbStrategy: "shared"
    },
    create: {
      id: tenantId,
      code: tenantCode,
      name: tenantName,
      dbStrategy: "shared"
    }
  });

  await prisma.tenantDomain.upsert({
    where: {
      domain: tenantDomain
    },
    update: {
      tenantId: tenant.id,
      status: "active"
    },
    create: {
      tenantId: tenant.id,
      domain: tenantDomain,
      status: "active"
    }
  });

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
    domain: tenantDomain,
    apiSeededFields: "status, modules"
  });
}

function createTenantCode(input: { domain?: string; name: string; sequence: number }): string {
  const base = input.domain ? codeBaseFromDomain(input.domain) : codeBaseFromText(input.name);
  return `${base}${input.sequence.toString().padStart(4, "0")}`;
}

function codeBaseFromDomain(domain: string): string {
  const labels = domain.split(".").filter((label) => label.length > 0);
  const suffixCount = labels.slice(-2).join(".") === "co.kr" ? 2 : 1;
  const registrableLabelIndex = labels.length - suffixCount - 1;
  return codeBaseFromText(labels[registrableLabelIndex] ?? labels[0] ?? domain);
}

function codeBaseFromText(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .toUpperCase();

  return `${normalized}XXXX`.slice(0, 4);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
