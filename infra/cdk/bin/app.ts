import "source-map-support/register.js";

import * as cdk from "aws-cdk-lib";

import { GatewayServiceStack } from "../lib/gateway-service-stack.js";

const app = new cdk.App();

const readOptionalContextString = (name: string): string | undefined => {
  const value = app.node.tryGetContext(name);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const readNonNegativeIntegerContext = (name: string, fallback: number): number => {
  const rawValue = app.node.tryGetContext(name) ?? fallback;
  const value = typeof rawValue === "number" ? rawValue : Number(String(rawValue).trim());

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer. Received: ${String(rawValue)}`);
  }

  return value;
};

const project = app.node.tryGetContext("project") ?? "multi-tenant";
const envName = app.node.tryGetContext("envName") ?? "dev";
const defaultRegion = app.node.tryGetContext("defaultRegion") ?? "ap-northeast-2";
const gatewayImageTag = app.node.tryGetContext("gatewayImageTag") ?? "latest";
const gatewayDesiredCount = readNonNegativeIntegerContext("gatewayDesiredCount", 0);
const gatewayUseNatGateway = app.node.tryGetContext("gatewayUseNatGateway") !== "false";
const gatewayRedisNodeType = app.node.tryGetContext("gatewayRedisNodeType") ?? "cache.t4g.micro";
const gatewayAcmCertificateArn = readOptionalContextString("gatewayAcmCertificateArn");
const gatewayDomainName = readOptionalContextString("gatewayDomainName");
const gatewayCorsAllowedOrigins = readOptionalContextString("gatewayCorsAllowedOrigins");
const gatewayJwtSecretArn = readOptionalContextString("gatewayJwtSecretArn");
const authImageTag = app.node.tryGetContext("authImageTag") ?? "latest";
const authDesiredCount = readNonNegativeIntegerContext("authDesiredCount", 0);
const authCorsAllowedOrigins = readOptionalContextString("authCorsAllowedOrigins");
const authJwtAlgorithm = app.node.tryGetContext("authJwtAlgorithm") === "RS256" ? "RS256" : "HS256";
const authDatabaseUrlSecretArn = readOptionalContextString("authDatabaseUrlSecretArn");
const authJwtSecretArn = readOptionalContextString("authJwtSecretArn");
const authJwtPrivateKeySecretArn = readOptionalContextString("authJwtPrivateKeySecretArn");
const authJwtPublicKeySecretArn = readOptionalContextString("authJwtPublicKeySecretArn");
const authInternalAuthSecretArn = readOptionalContextString("authInternalAuthSecretArn");
const tenantImageTag = app.node.tryGetContext("tenantImageTag") ?? "latest";
const tenantDesiredCount = readNonNegativeIntegerContext("tenantDesiredCount", 0);
const tenantCorsAllowedOrigins = readOptionalContextString("tenantCorsAllowedOrigins");
const tenantDatabaseUrlSecretArn = readOptionalContextString("tenantDatabaseUrlSecretArn");
const tenantInternalAuthSecretArn = readOptionalContextString("tenantInternalAuthSecretArn");
const adminBffImageTag = app.node.tryGetContext("adminBffImageTag") ?? "latest";
const adminBffDesiredCount = readNonNegativeIntegerContext("adminBffDesiredCount", 0);
const adminBffCorsAllowedOrigins = readOptionalContextString("adminBffCorsAllowedOrigins");
const adminBffAuthInternalAuthSecretArn = readOptionalContextString("adminBffAuthInternalAuthSecretArn");
const adminBffTenantInternalAuthSecretArn = readOptionalContextString("adminBffTenantInternalAuthSecretArn");
const adminBffAuditInternalAuthSecretArn = readOptionalContextString("adminBffAuditInternalAuthSecretArn");
const userBffImageTag = app.node.tryGetContext("userBffImageTag") ?? "latest";
const userBffDesiredCount = readNonNegativeIntegerContext("userBffDesiredCount", 0);
const userBffCorsAllowedOrigins = readOptionalContextString("userBffCorsAllowedOrigins");
const userBffAuthInternalAuthSecretArn = readOptionalContextString("userBffAuthInternalAuthSecretArn");
const userBffTenantInternalAuthSecretArn = readOptionalContextString("userBffTenantInternalAuthSecretArn");
const userBffWmsInternalAuthSecretArn = readOptionalContextString("userBffWmsInternalAuthSecretArn");
const userBffAuditInternalAuthSecretArn = readOptionalContextString("userBffAuditInternalAuthSecretArn");
const userBffAppAuditPublisherTypeRaw = app.node.tryGetContext("userBffAppAuditPublisherType");
const userBffAppAuditPublisherType =
  userBffAppAuditPublisherTypeRaw === "eventbridge" ||
  userBffAppAuditPublisherTypeRaw === "internal-api" ||
  userBffAppAuditPublisherTypeRaw === "disabled"
    ? userBffAppAuditPublisherTypeRaw
    : undefined;
const userBffAuditEventBridgeBusName = readOptionalContextString("userBffAuditEventBridgeBusName");
const wmsImageTag = app.node.tryGetContext("wmsImageTag") ?? "latest";
const wmsDesiredCount = readNonNegativeIntegerContext("wmsDesiredCount", 0);
const wmsCorsAllowedOrigins = readOptionalContextString("wmsCorsAllowedOrigins");
const wmsDatabaseUrlSecretArn = readOptionalContextString("wmsDatabaseUrlSecretArn");
const wmsInternalAuthSecretArn = readOptionalContextString("wmsInternalAuthSecretArn");
const wmsAuthInternalAuthSecretArn = readOptionalContextString("wmsAuthInternalAuthSecretArn");
const wmsTenantInternalAuthSecretArn = readOptionalContextString("wmsTenantInternalAuthSecretArn");
const auditImageTag = app.node.tryGetContext("auditImageTag") ?? "latest";
const auditDesiredCount = readNonNegativeIntegerContext("auditDesiredCount", 0);
const auditCorsAllowedOrigins = readOptionalContextString("auditCorsAllowedOrigins");
const auditDatabaseUrlSecretArn = readOptionalContextString("auditDatabaseUrlSecretArn");
const auditInternalAuthSecretArn = readOptionalContextString("auditInternalAuthSecretArn");
const auditEventConsumerEnabled = readOptionalContextString("auditEventConsumerEnabled");
const auditEventQueueUrl = readOptionalContextString("auditEventQueueUrl");
const outboxImageTag = app.node.tryGetContext("outboxImageTag") ?? "latest";
const outboxDesiredCount = readNonNegativeIntegerContext("outboxDesiredCount", 0);
const outboxCorsAllowedOrigins = readOptionalContextString("outboxCorsAllowedOrigins");
const outboxSources = readOptionalContextString("outboxSources");
const outboxWorkerEnabled = readOptionalContextString("outboxWorkerEnabled");
const outboxPublisherTypeRaw = app.node.tryGetContext("outboxPublisherType");
const outboxPublisherType =
  outboxPublisherTypeRaw === "eventbridge" || outboxPublisherTypeRaw === "sqs" ? outboxPublisherTypeRaw : "mock";
const outboxEventBridgeBusName = readOptionalContextString("outboxEventBridgeBusName");
const outboxSqsQueueUrl = readOptionalContextString("outboxSqsQueueUrl");
const authIamOutboxDatabaseUrlSecretArn = readOptionalContextString("authIamOutboxDatabaseUrlSecretArn");
const tenantOutboxDatabaseUrlSecretArn = readOptionalContextString("tenantOutboxDatabaseUrlSecretArn");
const wmsOutboxDatabaseUrlSecretArn = readOptionalContextString("wmsOutboxDatabaseUrlSecretArn");
const auditLogServiceUrl = readOptionalContextString("auditLogServiceUrl");
const authIamServiceUrl = readOptionalContextString("authIamServiceUrl");
const authIamApiServiceUrl = readOptionalContextString("authIamApiServiceUrl");
const adminBffServiceUrl = readOptionalContextString("adminBffServiceUrl");
const userBffServiceUrl = readOptionalContextString("userBffServiceUrl");
const tenantServiceUrl = readOptionalContextString("tenantServiceUrl");
const wmsServiceUrl = readOptionalContextString("wmsServiceUrl");

new GatewayServiceStack(app, `${project}-${envName}-gateway-service-stack`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: defaultRegion
  },
  project,
  envName,
  gatewayImageTag,
  gatewayDesiredCount,
  gatewayUseNatGateway,
  gatewayRedisNodeType,
  gatewayAcmCertificateArn,
  gatewayDomainName,
  gatewayCorsAllowedOrigins,
  gatewayJwtSecretArn,
  authImageTag,
  authDesiredCount,
  authCorsAllowedOrigins,
  authJwtAlgorithm,
  authDatabaseUrlSecretArn,
  authJwtSecretArn,
  authJwtPrivateKeySecretArn,
  authJwtPublicKeySecretArn,
  authInternalAuthSecretArn,
  tenantImageTag,
  tenantDesiredCount,
  tenantCorsAllowedOrigins,
  tenantDatabaseUrlSecretArn,
  tenantInternalAuthSecretArn,
  adminBffImageTag,
  adminBffDesiredCount,
  adminBffCorsAllowedOrigins,
  adminBffAuthInternalAuthSecretArn,
  adminBffTenantInternalAuthSecretArn,
  adminBffAuditInternalAuthSecretArn,
  userBffImageTag,
  userBffDesiredCount,
  userBffCorsAllowedOrigins,
  userBffAuthInternalAuthSecretArn,
  userBffTenantInternalAuthSecretArn,
  userBffWmsInternalAuthSecretArn,
  userBffAuditInternalAuthSecretArn,
  userBffAppAuditPublisherType,
  userBffAuditEventBridgeBusName,
  wmsImageTag,
  wmsDesiredCount,
  wmsCorsAllowedOrigins,
  wmsDatabaseUrlSecretArn,
  wmsInternalAuthSecretArn,
  wmsAuthInternalAuthSecretArn,
  wmsTenantInternalAuthSecretArn,
  auditImageTag,
  auditDesiredCount,
  auditCorsAllowedOrigins,
  auditDatabaseUrlSecretArn,
  auditInternalAuthSecretArn,
  auditEventConsumerEnabled,
  auditEventQueueUrl,
  outboxImageTag,
  outboxDesiredCount,
  outboxCorsAllowedOrigins,
  outboxSources,
  outboxWorkerEnabled,
  outboxPublisherType,
  outboxEventBridgeBusName,
  outboxSqsQueueUrl,
  authIamOutboxDatabaseUrlSecretArn,
  tenantOutboxDatabaseUrlSecretArn,
  wmsOutboxDatabaseUrlSecretArn,
  auditLogServiceUrl,
  authIamServiceUrl,
  authIamApiServiceUrl,
  adminBffServiceUrl,
  userBffServiceUrl,
  tenantServiceUrl,
  wmsServiceUrl
});
