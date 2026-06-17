#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const config = {
  region: process.env.AWS_REGION ?? "ap-northeast-2",
  queueName: process.env.LOCAL_OUTBOX_SQS_QUEUE_NAME ?? "multi-tenant-local-audit-events-queue",
  localstackEndpoint: process.env.LOCALSTACK_ENDPOINT ?? "http://localhost:4566",
  auditPort: process.env.LOCAL_AUDIT_PORT ?? "3106",
  outboxPort: process.env.LOCAL_OUTBOX_PORT ?? "3107",
  tenantId: process.env.LOCAL_VERIFY_TENANT_ID ?? "11111111-1111-4111-8111-111111111111",
  postgresContainer: process.env.LOCAL_POSTGRES_CONTAINER ?? "multi-tenant-postgres",
  authDatabase: process.env.LOCAL_AUTH_DATABASE ?? "auth_iam",
  auditDatabase: process.env.LOCAL_AUDIT_DATABASE ?? "audit_log",
  auditDatabaseUrl: process.env.LOCAL_AUDIT_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:55432/audit_log",
  authOutboxDatabaseUrl: process.env.LOCAL_AUTH_OUTBOX_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:55432/auth_iam",
  auditInternalSecret: process.env.LOCAL_AUDIT_INTERNAL_SECRET ?? "local-audit-internal-secret-32chars"
};

const children = [];

async function main() {
  ensureRequiredCommands();
  await ensureDockerDependencies();
  await ensureAuditSchema();
  const queueUrl = await createQueue();
  await purgeQueue(queueUrl);

  const auditProcess = startProcess("audit-log-service", {
    AUDIT_PORT: config.auditPort,
    NODE_ENV: "development",
    APP_ENV: "local",
    LOG_LEVEL: "debug",
    AWS_REGION: config.region,
    AWS_ACCESS_KEY_ID: "test",
    AWS_SECRET_ACCESS_KEY: "test",
    DATABASE_URL: config.auditDatabaseUrl,
    AUDIT_INTERNAL_AUTH_SECRET: config.auditInternalSecret,
    AUDIT_EVENT_CONSUMER_ENABLED: "true",
    AUDIT_EVENT_QUEUE_URL: queueUrl,
    AUDIT_EVENT_SQS_ENDPOINT: config.localstackEndpoint,
    AUDIT_EVENT_POLL_INTERVAL_MS: "1000",
    AUDIT_EVENT_WAIT_TIME_SECONDS: "1",
    AUDIT_EVENT_BATCH_SIZE: "10"
  });

  const outboxProcess = startProcess("outbox-relay-service", {
    OUTBOX_PORT: config.outboxPort,
    NODE_ENV: "development",
    APP_ENV: "local",
    LOG_LEVEL: "debug",
    AWS_REGION: config.region,
    AWS_ACCESS_KEY_ID: "test",
    AWS_SECRET_ACCESS_KEY: "test",
    OUTBOX_WORKER_ENABLED: "true",
    OUTBOX_SOURCES: "auth-iam",
    OUTBOX_PUBLISHER_TYPE: "sqs",
    OUTBOX_POLL_INTERVAL_MS: "1000",
    OUTBOX_BATCH_SIZE: "10",
    OUTBOX_MAX_RETRY_COUNT: "3",
    OUTBOX_LOCK_TIMEOUT_SECONDS: "30",
    OUTBOX_EVENT_SOURCE_PREFIX: "multi-tenant.local",
    OUTBOX_SQS_QUEUE_URL: queueUrl,
    OUTBOX_SQS_ENDPOINT: config.localstackEndpoint,
    OUTBOX_SQS_MESSAGE_GROUP_STRATEGY: "aggregateId",
    AUTH_IAM_OUTBOX_DATABASE_URL: config.authOutboxDatabaseUrl
  });

  await waitForReady(`http://127.0.0.1:${config.auditPort}/ready`, "audit-log-service");
  await waitForReady(`http://127.0.0.1:${config.outboxPort}/ready`, "outbox-relay-service");

  const event = await insertOutboxEvent();
  const outboxRow = await waitForOutboxPublished(event.eventId);
  const auditRow = await waitForAuditLog(event.eventId);
  const queueAttributes = await getQueueAttributes(queueUrl);

  console.log("\nLocal outbox SQS verification passed");
  console.table({
    eventId: event.eventId,
    requestId: event.requestId,
    outboxStatus: outboxRow.status,
    publishedTarget: outboxRow.published_target,
    auditId: auditRow.audit_id,
    auditAction: auditRow.action,
    queueVisibleMessages: queueAttributes.ApproximateNumberOfMessages ?? "0",
    queueInFlightMessages: queueAttributes.ApproximateNumberOfMessagesNotVisible ?? "0"
  });

  auditProcess.kill();
  outboxProcess.kill();
}

function ensureRequiredCommands() {
  for (const command of ["aws", "docker", "pnpm"]) {
    const result = spawnSync(command, ["--version"]);
    if (result.status !== 0) {
      throw new Error(`${command} is required for local outbox SQS verification`);
    }
  }
}

async function ensureDockerDependencies() {
  const services = ["multi-tenant-postgres", "multi-tenant-localstack"];
  for (const service of services) {
    const result = await run("docker", ["inspect", "-f", "{{.State.Running}}", service]);
    if (result.trim() !== "true") {
      throw new Error(`${service} must be running. Start local compose first.`);
    }
  }
}

async function ensureAuditSchema() {
  await run("pnpm", ["--filter", "audit-log-service", "exec", "prisma", "db", "push", "--schema", "prisma/schema.prisma", "--accept-data-loss"], {
    DATABASE_URL: config.auditDatabaseUrl
  });
}

async function createQueue() {
  const payload = await aws(["sqs", "create-queue", "--queue-name", config.queueName]);
  return JSON.parse(payload).QueueUrl;
}

async function purgeQueue(queueUrl) {
  try {
    await aws(["sqs", "purge-queue", "--queue-url", queueUrl]);
  } catch (error) {
    if (!String(error.message).includes("PurgeQueueInProgress")) {
      throw error;
    }
  }
}

function startProcess(serviceName, env) {
  const child = spawn("pnpm", ["--filter", serviceName, "dev"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  children.push(child);
  child.stdout.on("data", (chunk) => process.stdout.write(prefixLines(serviceName, chunk)));
  child.stderr.on("data", (chunk) => process.stderr.write(prefixLines(serviceName, chunk)));
  child.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`${serviceName} exited with code ${code}`);
    }
    if (signal) {
      console.error(`${serviceName} exited with signal ${signal}`);
    }
  });

  return child;
}

async function waitForReady(url, serviceName) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const payload = await response.json();
        if (payload.status === "ready") {
          return;
        }
        lastError = new Error(`${serviceName} status is ${payload.status}`);
      } else {
        lastError = new Error(`${serviceName} returned ${response.status}`);
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for ${serviceName}: ${lastError?.message ?? "unknown error"}`);
}

async function insertOutboxEvent() {
  const eventId = randomUUID();
  const outboxId = randomUUID();
  const requestId = `req-local-sqs-audit-${Date.now()}`;
  const occurredAt = new Date().toISOString();
  const aggregateId = randomUUID();
  const eventType = "auth.local.sqsAudit.verified";
  const payload = {
    eventId,
    eventType,
    schemaVersion: 1,
    tenantId: config.tenantId,
    requestId,
    occurredAt,
    source: "auth-iam-service",
    aggregateType: "verification",
    aggregateId,
    actor: {
      type: "system",
      userId: null
    },
    data: {
      purpose: "local-sqs-audit-verification"
    }
  };

  const sql = `
INSERT INTO outbox_events (
  outbox_id,
  event_id,
  event_type,
  schema_version,
  tenant_id,
  request_id,
  source,
  aggregate_type,
  aggregate_id,
  payload,
  status,
  retry_count,
  created_at
) VALUES (
  '${outboxId}',
  '${eventId}',
  '${eventType}',
  1,
  '${config.tenantId}',
  '${requestId}',
  'auth-iam-service',
  'verification',
  '${aggregateId}',
  '${JSON.stringify(payload).replaceAll("'", "''")}'::jsonb,
  'pending',
  0,
  now()
);
`;

  await psql(config.authDatabase, sql);
  return {
    eventId,
    outboxId,
    requestId
  };
}

async function waitForOutboxPublished(eventId) {
  return waitForRow(
    () => queryJson(
      config.authDatabase,
      `SELECT event_id, event_type, status, published_target, retry_count, last_error FROM outbox_events WHERE event_id='${eventId}'`
    ),
    (row) => {
      if (row.status === "failed") {
        throw new Error(`Outbox event failed: ${row.last_error ?? "unknown"}`);
      }
      return row.status === "published";
    },
    "outbox published"
  );
}

async function waitForAuditLog(eventId) {
  return waitForRow(
    () => queryJson(
      config.auditDatabase,
      `SELECT audit_id, event_id, request_id, action, resource_type, result FROM audit_logs WHERE event_id='${eventId}'`
    ),
    (row) => row.result === "success",
    "audit log stored"
  );
}

async function waitForRow(query, predicate, label) {
  const deadline = Date.now() + 60_000;
  let lastRow;
  while (Date.now() < deadline) {
    const rows = await query();
    const row = rows[0];
    if (row) {
      lastRow = row;
      if (predicate(row)) {
        return row;
      }
    }
    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for ${label}. Last row: ${JSON.stringify(lastRow ?? null)}`);
}

async function queryJson(database, sql) {
  const output = await run("docker", [
    "exec",
    config.postgresContainer,
    "psql",
    "-U",
    "postgres",
    "-d",
    database,
    "-t",
    "-A",
    "-F",
    "",
    "-c",
    `SELECT COALESCE(json_agg(row_to_json(rows)), '[]'::json) FROM (${sql}) rows;`
  ]);

  return JSON.parse(output.trim() || "[]");
}

async function psql(database, sql) {
  await run("docker", ["exec", "-i", config.postgresContainer, "psql", "-U", "postgres", "-d", database], {}, sql);
}

async function getQueueAttributes(queueUrl) {
  const payload = await aws([
    "sqs",
    "get-queue-attributes",
    "--queue-url",
    queueUrl,
    "--attribute-names",
    "ApproximateNumberOfMessages",
    "ApproximateNumberOfMessagesNotVisible",
    "ApproximateNumberOfMessagesDelayed"
  ]);
  return JSON.parse(payload).Attributes ?? {};
}

async function aws(args) {
  return run("aws", ["--endpoint-url", config.localstackEndpoint, ...args], {
    AWS_ACCESS_KEY_ID: "test",
    AWS_SECRET_ACCESS_KEY: "test",
    AWS_DEFAULT_REGION: config.region
  });
}

async function run(command, args, extraEnv = {}, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...extraEnv
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with code ${code}: ${stderr || stdout}`));
    });

    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

function prefixLines(prefix, chunk) {
  return String(chunk)
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => `[${prefix}] ${line}\n`)
    .join("");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

try {
  await main();
} finally {
  cleanup();
}

function cleanup() {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
}
