#!/usr/bin/env node
import { createHash, createHmac, randomUUID } from "node:crypto";

const config = {
  tenantBaseUrl: process.env.TENANT_SERVICE_URL ?? "http://127.0.0.1:3002",
  tenantInternalSecret:
    process.env.TENANT_INTERNAL_AUTH_SECRET ?? "replace-with-local-tenant-internal-secret-32chars",
  internalServiceId: process.env.LOCAL_SEED_INTERNAL_SERVICE_ID ?? "admin-bff-service",
  tenantId: process.env.LOCAL_SEED_TENANT_ID ?? "11111111-1111-4111-8111-111111111111",
  email: process.env.LOCAL_SEED_ADMIN_EMAIL ?? "admin@demo.local",
  password: process.env.LOCAL_SEED_ADMIN_PASSWORD ?? "Test1234!",
  displayName: process.env.LOCAL_SEED_ADMIN_DISPLAY_NAME ?? "Demo Tenant Admin"
};

const tenantModules = ["auth", "tenant", "wms"];

async function main() {
  await waitForReady(`${config.tenantBaseUrl}/ready`, "tenant-service");

  await seedTenantApiData();

  console.log("Seeded local API data");
  console.table({
    tenantId: config.tenantId,
    modules: tenantModules.join(", ")
  });
}

async function seedTenantApiData() {
  await tenantRequest("PATCH", `/internal/admin/tenants/${config.tenantId}/status`, {
    status: "active",
    reason: "local API seed"
  });
  await tenantRequest("PUT", `/internal/admin/tenants/${config.tenantId}/modules`, {
    enabledModules: tenantModules
  });
}

async function waitForReady(url, serviceName) {
  const deadline = Date.now() + 120_000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`${serviceName} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(2_000);
  }

  throw new Error(`Timed out waiting for ${serviceName}: ${lastError?.message ?? "unknown error"}`);
}

async function tenantRequest(method, path, body) {
  const requestId = randomUUID();
  const bodyText = body === undefined ? "" : JSON.stringify(body);
  const timestamp = new Date().toISOString();
  const signature = signInternalRequest(method, path, timestamp, requestId, bodyText);
  const headers = {
    "content-type": "application/json",
    "x-request-id": requestId,
    "x-tenant-id": config.tenantId,
    "x-internal-service-id": config.internalServiceId,
    "x-internal-timestamp": timestamp,
    "x-internal-signature": signature
  };

  return request(`${config.tenantBaseUrl}${path}`, {
    method,
    headers,
    body: bodyText || undefined
  });
}

async function request(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok || payload.success === false) {
    const code = payload.error?.code ?? response.status;
    const message = payload.error?.message ?? response.statusText;
    throw new Error(`${init.method} ${url} failed: ${code} ${message}`);
  }

  return payload;
}

function signInternalRequest(method, path, timestamp, requestId, bodyText) {
  const bodyHash = createHash("sha256").update(bodyText).digest("hex");
  const payload = [method.toUpperCase(), path, timestamp, requestId, bodyHash].join("\n");

  return createHmac("sha256", config.tenantInternalSecret).update(payload).digest("hex");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
