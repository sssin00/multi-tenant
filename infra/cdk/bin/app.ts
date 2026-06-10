import "source-map-support/register.js";

import * as cdk from "aws-cdk-lib";

import { GatewayServiceStack } from "../lib/gateway-service-stack.js";

const app = new cdk.App();

const readOptionalContextString = (name: string): string | undefined => {
  const value = app.node.tryGetContext(name);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const project = app.node.tryGetContext("project") ?? "multi-tenant";
const envName = app.node.tryGetContext("envName") ?? "dev";
const defaultRegion = app.node.tryGetContext("defaultRegion") ?? "ap-northeast-2";
const gatewayImageTag = app.node.tryGetContext("gatewayImageTag") ?? "latest";
const gatewayDesiredCount = Number(app.node.tryGetContext("gatewayDesiredCount") ?? 0);
const gatewayUseNatGateway = app.node.tryGetContext("gatewayUseNatGateway") !== "false";
const gatewayRedisNodeType = app.node.tryGetContext("gatewayRedisNodeType") ?? "cache.t4g.micro";
const gatewayAcmCertificateArn = readOptionalContextString("gatewayAcmCertificateArn");
const gatewayDomainName = readOptionalContextString("gatewayDomainName");
const gatewayCorsAllowedOrigins = readOptionalContextString("gatewayCorsAllowedOrigins");
const gatewayJwtSecretArn = readOptionalContextString("gatewayJwtSecretArn");
const authImageTag = app.node.tryGetContext("authImageTag") ?? "latest";
const authDesiredCount = Number(app.node.tryGetContext("authDesiredCount") ?? 0);
const authCorsAllowedOrigins = readOptionalContextString("authCorsAllowedOrigins");
const authJwtAlgorithm = app.node.tryGetContext("authJwtAlgorithm") === "RS256" ? "RS256" : "HS256";
const authDatabaseUrlSecretArn = readOptionalContextString("authDatabaseUrlSecretArn");
const authJwtSecretArn = readOptionalContextString("authJwtSecretArn");
const authJwtPrivateKeySecretArn = readOptionalContextString("authJwtPrivateKeySecretArn");
const authJwtPublicKeySecretArn = readOptionalContextString("authJwtPublicKeySecretArn");
const authInternalAuthSecretArn = readOptionalContextString("authInternalAuthSecretArn");
const authIamServiceUrl = readOptionalContextString("authIamServiceUrl");
const adminBffServiceUrl = readOptionalContextString("adminBffServiceUrl");
const userBffServiceUrl = readOptionalContextString("userBffServiceUrl");
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
  authIamServiceUrl,
  adminBffServiceUrl,
  userBffServiceUrl,
  tenantServiceUrl
});
