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
const auditLogServiceUrl = readOptionalContextString("auditLogServiceUrl");
const authIamServiceUrl = readOptionalContextString("authIamServiceUrl");
const adminBffServiceUrl = readOptionalContextString("adminBffServiceUrl");
const tenantServiceUrl = readOptionalContextString("tenantServiceUrl");

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
  auditLogServiceUrl,
  authIamServiceUrl,
  adminBffServiceUrl,
  tenantServiceUrl
});
