import * as cdk from "aws-cdk-lib";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export interface GatewayServiceStackProps extends cdk.StackProps {
  project: string;
  envName: string;
  gatewayImageTag: string;
  gatewayDesiredCount: number;
  gatewayUseNatGateway: boolean;
  gatewayRedisNodeType: string;
  gatewayAcmCertificateArn?: string;
  gatewayDomainName?: string;
  gatewayCorsAllowedOrigins?: string;
  gatewayJwtSecretArn?: string;
  gatewayTenantStatusCheckEnabled: boolean;
  authImageTag: string;
  authDesiredCount: number;
  authCorsAllowedOrigins?: string;
  authJwtAlgorithm: "HS256" | "RS256";
  authDatabaseUrlSecretArn?: string;
  authJwtSecretArn?: string;
  authJwtPrivateKeySecretArn?: string;
  authJwtPublicKeySecretArn?: string;
  authInternalAuthSecretArn?: string;
  tenantImageTag: string;
  tenantDesiredCount: number;
  tenantCorsAllowedOrigins?: string;
  tenantDatabaseUrlSecretArn?: string;
  tenantInternalAuthSecretArn?: string;
  adminBffImageTag: string;
  adminBffDesiredCount: number;
  adminBffCorsAllowedOrigins?: string;
  adminBffAuthInternalAuthSecretArn?: string;
  adminBffTenantInternalAuthSecretArn?: string;
  adminBffAuditInternalAuthSecretArn?: string;
  auditLogServiceUrl?: string;
  authIamServiceUrl?: string;
  adminBffServiceUrl?: string;
  userBffServiceUrl?: string;
  tenantServiceUrl?: string;
}

export class GatewayServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GatewayServiceStackProps) {
    super(scope, id, props);

    const namePrefix = `${props.project}-${props.envName}`;
    const serviceName = "gateway-service";
    const authServiceName = "auth-iam-service";
    const tenantServiceName = "tenant-service";
    const adminBffServiceName = "admin-bff-service";
    const cloudMapNamespaceName = `${props.envName}.${props.project}.local`;
    const isHttpsEnabled = props.gatewayAcmCertificateArn !== undefined && props.gatewayAcmCertificateArn.length > 0;
    const isJwtSecretConfigured = props.gatewayJwtSecretArn !== undefined && props.gatewayJwtSecretArn.length > 0;
    const corsAllowedOrigins =
      props.gatewayCorsAllowedOrigins ??
      (props.envName === "prod" ? "https://app.example.com,https://admin.example.com" : "https://dev.example.com");
    const authCorsAllowedOrigins =
      props.authCorsAllowedOrigins ??
      (props.envName === "prod" ? "https://app.example.com,https://admin.example.com" : "https://dev.example.com");
    const tenantCorsAllowedOrigins =
      props.tenantCorsAllowedOrigins ??
      (props.envName === "prod" ? "https://app.example.com,https://admin.example.com" : "https://dev.example.com");
    const adminBffCorsAllowedOrigins =
      props.adminBffCorsAllowedOrigins ??
      (props.envName === "prod" ? "https://admin.example.com" : "https://dev.example.com");
    const jwtSecret = isJwtSecretConfigured
      ? secretsmanager.Secret.fromSecretCompleteArn(this, "GatewayJwtSecret", props.gatewayJwtSecretArn as string)
      : undefined;
    const authDatabaseUrlSecret = props.authDatabaseUrlSecretArn
      ? secretsmanager.Secret.fromSecretCompleteArn(this, "AuthDatabaseUrlSecret", props.authDatabaseUrlSecretArn)
      : undefined;
    const authJwtSecret = props.authJwtSecretArn
      ? secretsmanager.Secret.fromSecretCompleteArn(this, "AuthJwtSecret", props.authJwtSecretArn)
      : undefined;
    const authJwtPrivateKeySecret = props.authJwtPrivateKeySecretArn
      ? secretsmanager.Secret.fromSecretCompleteArn(this, "AuthJwtPrivateKeySecret", props.authJwtPrivateKeySecretArn)
      : undefined;
    const authJwtPublicKeySecret = props.authJwtPublicKeySecretArn
      ? secretsmanager.Secret.fromSecretCompleteArn(this, "AuthJwtPublicKeySecret", props.authJwtPublicKeySecretArn)
      : undefined;
    const authInternalAuthSecret = props.authInternalAuthSecretArn
      ? secretsmanager.Secret.fromSecretCompleteArn(this, "AuthInternalAuthSecret", props.authInternalAuthSecretArn)
      : undefined;
    const tenantDatabaseUrlSecret = props.tenantDatabaseUrlSecretArn
      ? secretsmanager.Secret.fromSecretCompleteArn(this, "TenantDatabaseUrlSecret", props.tenantDatabaseUrlSecretArn)
      : undefined;
    const tenantInternalAuthSecret = props.tenantInternalAuthSecretArn
      ? secretsmanager.Secret.fromSecretCompleteArn(this, "TenantInternalAuthSecret", props.tenantInternalAuthSecretArn)
      : undefined;
    const adminBffAuthInternalAuthSecret = props.adminBffAuthInternalAuthSecretArn
      ? secretsmanager.Secret.fromSecretCompleteArn(
          this,
          "AdminBffAuthInternalAuthSecret",
          props.adminBffAuthInternalAuthSecretArn
        )
      : undefined;
    const adminBffTenantInternalAuthSecret = props.adminBffTenantInternalAuthSecretArn
      ? secretsmanager.Secret.fromSecretCompleteArn(
          this,
          "AdminBffTenantInternalAuthSecret",
          props.adminBffTenantInternalAuthSecretArn
        )
      : undefined;
    const adminBffAuditInternalAuthSecret = props.adminBffAuditInternalAuthSecretArn
      ? secretsmanager.Secret.fromSecretCompleteArn(
          this,
          "AdminBffAuditInternalAuthSecret",
          props.adminBffAuditInternalAuthSecretArn
        )
      : undefined;

    const repository = new ecr.Repository(this, "GatewayServiceRepository", {
      repositoryName: `${namePrefix}-${serviceName}`,
      imageScanOnPush: true,
      lifecycleRules: [
        {
          maxImageCount: 20,
          description: "Keep the latest 20 gateway-service images"
        }
      ],
      removalPolicy: props.envName === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      emptyOnDelete: props.envName !== "prod"
    });

    const authRepository = new ecr.Repository(this, "AuthIamServiceRepository", {
      repositoryName: `${namePrefix}-${authServiceName}`,
      imageScanOnPush: true,
      lifecycleRules: [
        {
          maxImageCount: 20,
          description: "Keep the latest 20 auth-iam-service images"
        }
      ],
      removalPolicy: props.envName === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      emptyOnDelete: props.envName !== "prod"
    });

    const tenantRepository = new ecr.Repository(this, "TenantServiceRepository", {
      repositoryName: `${namePrefix}-${tenantServiceName}`,
      imageScanOnPush: true,
      lifecycleRules: [
        {
          maxImageCount: 20,
          description: "Keep the latest 20 tenant-service images"
        }
      ],
      removalPolicy: props.envName === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      emptyOnDelete: props.envName !== "prod"
    });

    const adminBffRepository = new ecr.Repository(this, "AdminBffServiceRepository", {
      repositoryName: `${namePrefix}-${adminBffServiceName}`,
      imageScanOnPush: true,
      lifecycleRules: [
        {
          maxImageCount: 20,
          description: "Keep the latest 20 admin-bff-service images"
        }
      ],
      removalPolicy: props.envName === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      emptyOnDelete: props.envName !== "prod"
    });

    const vpc = new ec2.Vpc(this, "Vpc", {
      vpcName: `${namePrefix}-vpc`,
      maxAzs: 2,
      natGateways: props.gatewayUseNatGateway ? 1 : 0,
      subnetConfiguration: [
        {
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24
        },
        ...(props.gatewayUseNatGateway
          ? [
              {
                name: "private-app",
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                cidrMask: 24
              }
            ]
          : [])
      ]
    });

    const cluster = new ecs.Cluster(this, "Cluster", {
      clusterName: `${namePrefix}-ecs-cluster`,
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED
    });
    const cloudMapNamespace = cluster.addDefaultCloudMapNamespace({
      name: cloudMapNamespaceName
    });

    const albSecurityGroup = new ec2.SecurityGroup(this, "AlbSecurityGroup", {
      vpc,
      securityGroupName: `${namePrefix}-alb-sg`,
      description: "Allow public web traffic to the application load balancer",
      allowAllOutbound: true
    });
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "Allow HTTP from internet");
    if (isHttpsEnabled) {
      albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "Allow HTTPS from internet");
    }

    const serviceSecurityGroup = new ec2.SecurityGroup(this, "GatewayServiceSecurityGroup", {
      vpc,
      securityGroupName: `${namePrefix}-${serviceName}-sg`,
      description: "Allow ALB traffic to gateway-service",
      allowAllOutbound: true
    });
    serviceSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(3000), "Allow ALB to gateway-service");

    const authServiceSecurityGroup = new ec2.SecurityGroup(this, "AuthIamServiceSecurityGroup", {
      vpc,
      securityGroupName: `${namePrefix}-${authServiceName}-sg`,
      description: "Allow gateway-service traffic to auth-iam-service",
      allowAllOutbound: true
    });
    authServiceSecurityGroup.addIngressRule(
      serviceSecurityGroup,
      ec2.Port.tcp(3000),
      "Allow gateway-service to auth-iam-service"
    );

    const tenantServiceSecurityGroup = new ec2.SecurityGroup(this, "TenantServiceSecurityGroup", {
      vpc,
      securityGroupName: `${namePrefix}-${tenantServiceName}-sg`,
      description: "Allow gateway-service traffic to tenant-service",
      allowAllOutbound: true
    });
    tenantServiceSecurityGroup.addIngressRule(
      serviceSecurityGroup,
      ec2.Port.tcp(3000),
      "Allow gateway-service to tenant-service"
    );

    const adminBffServiceSecurityGroup = new ec2.SecurityGroup(this, "AdminBffServiceSecurityGroup", {
      vpc,
      securityGroupName: `${namePrefix}-${adminBffServiceName}-sg`,
      description: "Allow gateway-service traffic to admin-bff-service",
      allowAllOutbound: true
    });
    adminBffServiceSecurityGroup.addIngressRule(
      serviceSecurityGroup,
      ec2.Port.tcp(3000),
      "Allow gateway-service to admin-bff-service"
    );

    const redisSecurityGroup = new ec2.SecurityGroup(this, "GatewayRedisSecurityGroup", {
      vpc,
      securityGroupName: `${namePrefix}-${serviceName}-redis-sg`,
      description: "Allow gateway-service tasks to access ElastiCache Redis",
      allowAllOutbound: true
    });
    redisSecurityGroup.addIngressRule(
      serviceSecurityGroup,
      ec2.Port.tcp(6379),
      "Allow gateway-service to Redis"
    );
    redisSecurityGroup.addIngressRule(
      authServiceSecurityGroup,
      ec2.Port.tcp(6379),
      "Allow auth-iam-service to Redis"
    );
    redisSecurityGroup.addIngressRule(
      tenantServiceSecurityGroup,
      ec2.Port.tcp(6379),
      "Allow tenant-service to Redis"
    );

    const appSubnets = vpc.selectSubnets({
      subnetType: props.gatewayUseNatGateway ? ec2.SubnetType.PRIVATE_WITH_EGRESS : ec2.SubnetType.PUBLIC
    });

    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, "GatewayRedisSubnetGroup", {
      cacheSubnetGroupName: `${namePrefix}-${serviceName}-redis-subnets`,
      description: "Subnets for gateway-service Redis rate limit store",
      subnetIds: appSubnets.subnetIds
    });

    const redisCluster = new elasticache.CfnCacheCluster(this, "GatewayRedisCluster", {
      clusterName: `${namePrefix}-${serviceName}-redis`,
      engine: "redis",
      cacheNodeType: props.gatewayRedisNodeType,
      numCacheNodes: 1,
      port: 6379,
      cacheSubnetGroupName: redisSubnetGroup.cacheSubnetGroupName,
      vpcSecurityGroupIds: [redisSecurityGroup.securityGroupId],
      autoMinorVersionUpgrade: true
    });
    redisCluster.addDependency(redisSubnetGroup);
    redisCluster.applyRemovalPolicy(props.envName === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY);

    const redisUrl = cdk.Fn.join("", [
      "redis://",
      redisCluster.attrRedisEndpointAddress,
      ":",
      redisCluster.attrRedisEndpointPort
    ]);
    const authIamInternalUrl = `http://${authServiceName}.${cloudMapNamespaceName}:3000/api/auth`;
    const tenantInternalUrl = `http://${tenantServiceName}.${cloudMapNamespaceName}:3000`;
    const adminBffInternalUrl = `http://${adminBffServiceName}.${cloudMapNamespaceName}:3000/api/admin`;

    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, "ApplicationLoadBalancer", {
      vpc,
      loadBalancerName: `${namePrefix}-alb`,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC
      }
    });

    const httpListener = loadBalancer.addListener("HttpListener", {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: false
    });

    const httpsListener = isHttpsEnabled
      ? loadBalancer.addListener("HttpsListener", {
          port: 443,
          protocol: elbv2.ApplicationProtocol.HTTPS,
          open: false,
          certificates: [
            acm.Certificate.fromCertificateArn(
              this,
              "GatewayCertificate",
              props.gatewayAcmCertificateArn as string
            )
          ],
          sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS
        })
      : undefined;

    if (httpsListener) {
      httpListener.addAction("HttpToHttpsRedirect", {
        action: elbv2.ListenerAction.redirect({
          protocol: "HTTPS",
          port: "443",
          permanent: true
        })
      });
    }

    const logGroup = new logs.LogGroup(this, "GatewayServiceLogGroup", {
      logGroupName: `/${props.project}/${props.envName}/${serviceName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: props.envName === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY
    });

    const authLogGroup = new logs.LogGroup(this, "AuthIamServiceLogGroup", {
      logGroupName: `/${props.project}/${props.envName}/${authServiceName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: props.envName === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY
    });

    const tenantLogGroup = new logs.LogGroup(this, "TenantServiceLogGroup", {
      logGroupName: `/${props.project}/${props.envName}/${tenantServiceName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: props.envName === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY
    });

    const adminBffLogGroup = new logs.LogGroup(this, "AdminBffServiceLogGroup", {
      logGroupName: `/${props.project}/${props.envName}/${adminBffServiceName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: props.envName === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, "GatewayTaskDefinition", {
      family: `${namePrefix}-${serviceName}`,
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.X86_64
      }
    });

    const gatewayContainerSecrets: Record<string, ecs.Secret> = {};
    if (jwtSecret) {
      gatewayContainerSecrets.JWT_SECRET = ecs.Secret.fromSecretsManager(jwtSecret);
    }
    if (tenantInternalAuthSecret) {
      gatewayContainerSecrets.TENANT_INTERNAL_AUTH_SECRET = ecs.Secret.fromSecretsManager(tenantInternalAuthSecret);
    }

    const container = taskDefinition.addContainer("GatewayContainer", {
      containerName: serviceName,
      image: ecs.ContainerImage.fromEcrRepository(repository, props.gatewayImageTag),
      essential: true,
      environment: {
        NODE_ENV: "production",
        APP_ENV: props.envName,
        SERVICE_NAME: serviceName,
        GATEWAY_PORT: "3000",
        LOG_LEVEL: "info",
        AWS_REGION: cdk.Stack.of(this).region,
        REQUEST_ID_HEADER: "x-request-id",
        TENANT_HEADER: "x-tenant-id",
        TENANT_SERVICE_URL: props.tenantServiceUrl ?? tenantInternalUrl,
        GATEWAY_TENANT_STATUS_CHECK_ENABLED: String(props.gatewayTenantStatusCheckEnabled),
        GATEWAY_TENANT_STATUS_CACHE_TTL_SECONDS: "30",
        GATEWAY_TENANT_STATUS_TIMEOUT_MS: "1000",
        GATEWAY_SECURITY_HEADERS_ENABLED: "true",
        GATEWAY_CORS_ALLOWED_ORIGINS: corsAllowedOrigins,
        GATEWAY_CORS_ALLOWED_METHODS: "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        GATEWAY_CORS_ALLOWED_HEADERS: "Authorization,Content-Type,Accept,X-Request-Id,X-Tenant-Id,Idempotency-Key",
        GATEWAY_CORS_EXPOSED_HEADERS: "X-Request-Id,X-Tenant-Id,X-RateLimit-Limit,X-RateLimit-Remaining,X-RateLimit-Reset",
        GATEWAY_CORS_CREDENTIALS: "true",
        GATEWAY_CORS_MAX_AGE_SECONDS: "600",
        JWT_ISSUER: "multi-tenant-auth-iam-service",
        JWT_AUDIENCE: "multi-tenant-gateway-service",
        GATEWAY_AUTH_UPSTREAM_TIMEOUT_MS: "3000",
        GATEWAY_ADMIN_UPSTREAM_TIMEOUT_MS: "5000",
        GATEWAY_APP_UPSTREAM_TIMEOUT_MS: "5000",
        GATEWAY_SAFE_METHOD_RETRIES: "1",
        REDIS_URL: redisUrl,
        GATEWAY_RATE_LIMIT_ENABLED: "true",
        GATEWAY_RATE_LIMIT_WINDOW_SECONDS: "60",
        GATEWAY_RATE_LIMIT_AUTH_PER_WINDOW: "60",
        GATEWAY_RATE_LIMIT_ADMIN_PER_WINDOW: "300",
        GATEWAY_RATE_LIMIT_APP_PER_WINDOW: "600",
        AUTH_IAM_SERVICE_URL: props.authIamServiceUrl ?? authIamInternalUrl,
        ADMIN_BFF_SERVICE_URL: props.adminBffServiceUrl ?? adminBffInternalUrl,
        USER_BFF_SERVICE_URL: props.userBffServiceUrl ?? "http://user-bff-service:3000"
      },
      secrets: Object.keys(gatewayContainerSecrets).length > 0 ? gatewayContainerSecrets : undefined,
      logging: ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: serviceName
      }),
      healthCheck: {
        command: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3000/health >/dev/null 2>&1 || exit 1"],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(15)
      }
    });
    container.addPortMappings({
      containerPort: 3000,
      protocol: ecs.Protocol.TCP
    });

    const service = new ecs.FargateService(this, "GatewayFargateService", {
      serviceName: `${namePrefix}-${serviceName}`,
      cluster,
      taskDefinition,
      desiredCount: props.gatewayDesiredCount,
      circuitBreaker: {
        rollback: true
      },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      assignPublicIp: !props.gatewayUseNatGateway,
      securityGroups: [serviceSecurityGroup],
      vpcSubnets: {
        subnetType: props.gatewayUseNatGateway ? ec2.SubnetType.PRIVATE_WITH_EGRESS : ec2.SubnetType.PUBLIC
      },
      enableExecuteCommand: props.envName !== "prod"
    });

    const applicationListener = httpsListener ?? httpListener;

    applicationListener.addTargets("GatewayTarget", {
      targetGroupName: `${namePrefix}-gw-tg`,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: {
        enabled: true,
        path: "/health",
        healthyHttpCodes: "200",
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3
      }
    });

    const authTaskDefinition = new ecs.FargateTaskDefinition(this, "AuthIamTaskDefinition", {
      family: `${namePrefix}-${authServiceName}`,
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.X86_64
      }
    });

    const authContainerSecrets: Record<string, ecs.Secret> = {};
    if (authDatabaseUrlSecret) {
      authContainerSecrets.DATABASE_URL = ecs.Secret.fromSecretsManager(authDatabaseUrlSecret);
    }
    if (authJwtSecret) {
      authContainerSecrets.JWT_SECRET = ecs.Secret.fromSecretsManager(authJwtSecret);
    }
    if (authJwtPrivateKeySecret) {
      authContainerSecrets.JWT_PRIVATE_KEY = ecs.Secret.fromSecretsManager(authJwtPrivateKeySecret);
    }
    if (authJwtPublicKeySecret) {
      authContainerSecrets.JWT_PUBLIC_KEY = ecs.Secret.fromSecretsManager(authJwtPublicKeySecret);
    }
    if (authInternalAuthSecret) {
      authContainerSecrets.AUTH_INTERNAL_AUTH_SECRET = ecs.Secret.fromSecretsManager(authInternalAuthSecret);
    }

    const authContainer = authTaskDefinition.addContainer("AuthIamContainer", {
      containerName: authServiceName,
      image: ecs.ContainerImage.fromEcrRepository(authRepository, props.authImageTag),
      essential: true,
      environment: {
        NODE_ENV: "production",
        APP_ENV: props.envName,
        SERVICE_NAME: authServiceName,
        AUTH_PORT: "3000",
        LOG_LEVEL: "info",
        AWS_REGION: cdk.Stack.of(this).region,
        REQUEST_ID_HEADER: "x-request-id",
        TENANT_HEADER: "x-tenant-id",
        AUTH_SECURITY_HEADERS_ENABLED: "true",
        AUTH_CORS_ALLOWED_ORIGINS: authCorsAllowedOrigins,
        AUTH_CORS_ALLOWED_METHODS: "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        AUTH_CORS_ALLOWED_HEADERS:
          "Authorization,Content-Type,Accept,X-Request-Id,X-Tenant-Id,Idempotency-Key,X-Internal-Service-Id,X-Internal-Timestamp,X-Internal-Signature",
        AUTH_CORS_EXPOSED_HEADERS: "X-Request-Id,X-Tenant-Id",
        AUTH_CORS_CREDENTIALS: "true",
        AUTH_CORS_MAX_AGE_SECONDS: "600",
        AUTH_ACCESS_TOKEN_TTL_SECONDS: "1800",
        AUTH_REFRESH_TOKEN_TTL_SECONDS: "1209600",
        AUTH_INTERNAL_AUTH_ENABLED: "true",
        AUTH_INTERNAL_AUTH_ALLOWED_SERVICES: "gateway-service,admin-bff-service,user-bff-service,wms-service",
        AUTH_INTERNAL_AUTH_TIMESTAMP_SKEW_SECONDS: "300",
        JWT_ALGORITHM: props.authJwtAlgorithm,
        JWT_ISSUER: "multi-tenant-auth-iam-service",
        JWT_AUDIENCE: "multi-tenant-gateway-service",
        REDIS_URL: redisUrl,
        AUDIT_LOG_SERVICE_URL: ""
      },
      secrets: Object.keys(authContainerSecrets).length > 0 ? authContainerSecrets : undefined,
      logging: ecs.LogDrivers.awsLogs({
        logGroup: authLogGroup,
        streamPrefix: authServiceName
      }),
      healthCheck: {
        command: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3000/health >/dev/null 2>&1 || exit 1"],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(15)
      }
    });
    authContainer.addPortMappings({
      containerPort: 3000,
      protocol: ecs.Protocol.TCP
    });

    new ecs.FargateService(this, "AuthIamFargateService", {
      serviceName: `${namePrefix}-${authServiceName}`,
      cluster,
      taskDefinition: authTaskDefinition,
      desiredCount: props.authDesiredCount,
      circuitBreaker: {
        rollback: true
      },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      assignPublicIp: !props.gatewayUseNatGateway,
      securityGroups: [authServiceSecurityGroup],
      vpcSubnets: {
        subnetType: props.gatewayUseNatGateway ? ec2.SubnetType.PRIVATE_WITH_EGRESS : ec2.SubnetType.PUBLIC
      },
      cloudMapOptions: {
        cloudMapNamespace,
        name: authServiceName
      },
      enableExecuteCommand: props.envName !== "prod"
    });

    const tenantTaskDefinition = new ecs.FargateTaskDefinition(this, "TenantTaskDefinition", {
      family: `${namePrefix}-${tenantServiceName}`,
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.X86_64
      }
    });

    const tenantContainerSecrets: Record<string, ecs.Secret> = {};
    if (tenantDatabaseUrlSecret) {
      tenantContainerSecrets.DATABASE_URL = ecs.Secret.fromSecretsManager(tenantDatabaseUrlSecret);
    }
    if (tenantInternalAuthSecret) {
      tenantContainerSecrets.TENANT_INTERNAL_AUTH_SECRET = ecs.Secret.fromSecretsManager(tenantInternalAuthSecret);
    }

    const tenantContainer = tenantTaskDefinition.addContainer("TenantContainer", {
      containerName: tenantServiceName,
      image: ecs.ContainerImage.fromEcrRepository(tenantRepository, props.tenantImageTag),
      essential: true,
      environment: {
        NODE_ENV: "production",
        APP_ENV: props.envName,
        SERVICE_NAME: tenantServiceName,
        TENANT_PORT: "3000",
        LOG_LEVEL: "info",
        AWS_REGION: cdk.Stack.of(this).region,
        REQUEST_ID_HEADER: "x-request-id",
        TENANT_HEADER: "x-tenant-id",
        TENANT_SECURITY_HEADERS_ENABLED: "true",
        TENANT_CORS_ALLOWED_ORIGINS: tenantCorsAllowedOrigins,
        TENANT_CORS_ALLOWED_METHODS: "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        TENANT_CORS_ALLOWED_HEADERS:
          "Authorization,Content-Type,Accept,X-Request-Id,X-Tenant-Id,X-User-Id,Idempotency-Key,X-Internal-Service-Id,X-Internal-Timestamp,X-Internal-Signature",
        TENANT_CORS_EXPOSED_HEADERS: "X-Request-Id,X-Tenant-Id",
        TENANT_CORS_CREDENTIALS: "true",
        TENANT_CORS_MAX_AGE_SECONDS: "600",
        TENANT_INTERNAL_AUTH_ENABLED: "true",
        TENANT_INTERNAL_AUTH_ALLOWED_SERVICES: "gateway-service,admin-bff-service,user-bff-service,wms-service",
        TENANT_INTERNAL_AUTH_TIMESTAMP_SKEW_SECONDS: "300",
        REDIS_URL: redisUrl
      },
      secrets: Object.keys(tenantContainerSecrets).length > 0 ? tenantContainerSecrets : undefined,
      logging: ecs.LogDrivers.awsLogs({
        logGroup: tenantLogGroup,
        streamPrefix: tenantServiceName
      }),
      healthCheck: {
        command: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3000/health >/dev/null 2>&1 || exit 1"],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(15)
      }
    });
    tenantContainer.addPortMappings({
      containerPort: 3000,
      protocol: ecs.Protocol.TCP
    });

    new ecs.FargateService(this, "TenantFargateService", {
      serviceName: `${namePrefix}-${tenantServiceName}`,
      cluster,
      taskDefinition: tenantTaskDefinition,
      desiredCount: props.tenantDesiredCount,
      circuitBreaker: {
        rollback: true
      },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      assignPublicIp: !props.gatewayUseNatGateway,
      securityGroups: [tenantServiceSecurityGroup],
      vpcSubnets: {
        subnetType: props.gatewayUseNatGateway ? ec2.SubnetType.PRIVATE_WITH_EGRESS : ec2.SubnetType.PUBLIC
      },
      cloudMapOptions: {
        cloudMapNamespace,
        name: tenantServiceName
      },
      enableExecuteCommand: props.envName !== "prod"
    });

    const adminBffTaskDefinition = new ecs.FargateTaskDefinition(this, "AdminBffTaskDefinition", {
      family: `${namePrefix}-${adminBffServiceName}`,
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.X86_64
      }
    });

    const adminBffContainerSecrets: Record<string, ecs.Secret> = {};
    if (adminBffAuthInternalAuthSecret) {
      adminBffContainerSecrets.AUTH_INTERNAL_AUTH_SECRET = ecs.Secret.fromSecretsManager(adminBffAuthInternalAuthSecret);
    }
    if (adminBffTenantInternalAuthSecret) {
      adminBffContainerSecrets.TENANT_INTERNAL_AUTH_SECRET = ecs.Secret.fromSecretsManager(
        adminBffTenantInternalAuthSecret
      );
    }
    if (adminBffAuditInternalAuthSecret) {
      adminBffContainerSecrets.AUDIT_INTERNAL_AUTH_SECRET = ecs.Secret.fromSecretsManager(
        adminBffAuditInternalAuthSecret
      );
    }

    const adminBffContainer = adminBffTaskDefinition.addContainer("AdminBffContainer", {
      containerName: adminBffServiceName,
      image: ecs.ContainerImage.fromEcrRepository(adminBffRepository, props.adminBffImageTag),
      essential: true,
      environment: {
        NODE_ENV: "production",
        APP_ENV: props.envName,
        SERVICE_NAME: adminBffServiceName,
        ADMIN_BFF_PORT: "3000",
        LOG_LEVEL: "info",
        AWS_REGION: cdk.Stack.of(this).region,
        REQUEST_ID_HEADER: "x-request-id",
        TENANT_HEADER: "x-tenant-id",
        AUTH_IAM_SERVICE_URL: props.authIamServiceUrl ?? authIamInternalUrl,
        TENANT_SERVICE_URL: props.tenantServiceUrl ?? tenantInternalUrl,
        AUDIT_LOG_SERVICE_URL: props.auditLogServiceUrl ?? "",
        ADMIN_BFF_SECURITY_HEADERS_ENABLED: "true",
        ADMIN_BFF_CORS_ALLOWED_ORIGINS: adminBffCorsAllowedOrigins,
        ADMIN_BFF_CORS_ALLOWED_METHODS: "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        ADMIN_BFF_CORS_ALLOWED_HEADERS:
          "Authorization,Content-Type,Accept,X-Request-Id,X-Tenant-Id,X-User-Id,Idempotency-Key",
        ADMIN_BFF_CORS_EXPOSED_HEADERS: "X-Request-Id,X-Tenant-Id",
        ADMIN_BFF_CORS_CREDENTIALS: "true",
        ADMIN_BFF_CORS_MAX_AGE_SECONDS: "600",
        ADMIN_BFF_DOWNSTREAM_TIMEOUT_MS: "5000",
        ADMIN_BFF_SAFE_METHOD_RETRIES: "1",
        ADMIN_BFF_INTERNAL_AUTH_ENABLED: "true",
        ADMIN_BFF_INTERNAL_SERVICE_ID: adminBffServiceName,
        ADMIN_BFF_INTERNAL_AUTH_TIMESTAMP_SKEW_SECONDS: "300"
      },
      secrets: Object.keys(adminBffContainerSecrets).length > 0 ? adminBffContainerSecrets : undefined,
      logging: ecs.LogDrivers.awsLogs({
        logGroup: adminBffLogGroup,
        streamPrefix: adminBffServiceName
      }),
      healthCheck: {
        command: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3000/health >/dev/null 2>&1 || exit 1"],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(15)
      }
    });
    adminBffContainer.addPortMappings({
      containerPort: 3000,
      protocol: ecs.Protocol.TCP
    });

    new ecs.FargateService(this, "AdminBffFargateService", {
      serviceName: `${namePrefix}-${adminBffServiceName}`,
      cluster,
      taskDefinition: adminBffTaskDefinition,
      desiredCount: props.adminBffDesiredCount,
      circuitBreaker: {
        rollback: true
      },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      assignPublicIp: !props.gatewayUseNatGateway,
      securityGroups: [adminBffServiceSecurityGroup],
      vpcSubnets: {
        subnetType: props.gatewayUseNatGateway ? ec2.SubnetType.PRIVATE_WITH_EGRESS : ec2.SubnetType.PUBLIC
      },
      cloudMapOptions: {
        cloudMapNamespace,
        name: adminBffServiceName
      },
      enableExecuteCommand: props.envName !== "prod"
    });

    cdk.Tags.of(this).add("Project", props.project);
    cdk.Tags.of(this).add("Environment", props.envName);
    cdk.Tags.of(this).add("ManagedBy", "cdk");

    new cdk.CfnOutput(this, "GatewayServiceRepositoryUri", {
      value: repository.repositoryUri,
      description: "ECR repository URI for gateway-service"
    });

    new cdk.CfnOutput(this, "AuthIamServiceRepositoryUri", {
      value: authRepository.repositoryUri,
      description: "ECR repository URI for auth-iam-service"
    });

    new cdk.CfnOutput(this, "TenantServiceRepositoryUri", {
      value: tenantRepository.repositoryUri,
      description: "ECR repository URI for tenant-service"
    });

    new cdk.CfnOutput(this, "AdminBffServiceRepositoryUri", {
      value: adminBffRepository.repositoryUri,
      description: "ECR repository URI for admin-bff-service"
    });

    new cdk.CfnOutput(this, "AuthIamServiceImageTag", {
      value: props.authImageTag,
      description: "Image tag used by the auth-iam-service ECS task definition"
    });

    new cdk.CfnOutput(this, "TenantServiceImageTag", {
      value: props.tenantImageTag,
      description: "Image tag used by the tenant-service ECS task definition"
    });

    new cdk.CfnOutput(this, "AdminBffServiceImageTag", {
      value: props.adminBffImageTag,
      description: "Image tag used by the admin-bff-service ECS task definition"
    });

    new cdk.CfnOutput(this, "AuthIamServiceDesiredCount", {
      value: String(props.authDesiredCount),
      description: "Current desired count for auth-iam-service"
    });

    new cdk.CfnOutput(this, "TenantServiceDesiredCount", {
      value: String(props.tenantDesiredCount),
      description: "Current desired count for tenant-service"
    });

    new cdk.CfnOutput(this, "AdminBffServiceDesiredCount", {
      value: String(props.adminBffDesiredCount),
      description: "Current desired count for admin-bff-service"
    });

    new cdk.CfnOutput(this, "AuthIamServiceInternalUrl", {
      value: authIamInternalUrl,
      description: "Cloud Map internal URL used by gateway-service to reach auth-iam-service"
    });

    new cdk.CfnOutput(this, "TenantServiceInternalUrl", {
      value: tenantInternalUrl,
      description: "Cloud Map internal URL used by gateway-service to reach tenant-service"
    });

    new cdk.CfnOutput(this, "AdminBffServiceInternalUrl", {
      value: adminBffInternalUrl,
      description: "Cloud Map internal URL used by gateway-service to reach admin-bff-service"
    });

    new cdk.CfnOutput(this, "GatewayServiceImageTag", {
      value: props.gatewayImageTag,
      description: "Image tag used by the ECS task definition"
    });

    new cdk.CfnOutput(this, "GatewayServiceDesiredCount", {
      value: String(props.gatewayDesiredCount),
      description: "Current desired count for gateway-service"
    });

    new cdk.CfnOutput(this, "GatewayServiceUsesNatGateway", {
      value: String(props.gatewayUseNatGateway),
      description: "Whether gateway-service tasks are placed in private subnets behind a NAT Gateway"
    });

    new cdk.CfnOutput(this, "GatewayRedisEndpoint", {
      value: redisCluster.attrRedisEndpointAddress,
      description: "ElastiCache Redis endpoint used by gateway-service rate limit"
    });

    new cdk.CfnOutput(this, "GatewayLoadBalancerDns", {
      value: loadBalancer.loadBalancerDnsName,
      description: "Public ALB DNS name"
    });

    new cdk.CfnOutput(this, "GatewayHttpsEnabled", {
      value: String(isHttpsEnabled),
      description: "Whether the ALB has an HTTPS listener using ACM"
    });

    if (props.gatewayDomainName) {
      new cdk.CfnOutput(this, "GatewayDomainName", {
        value: props.gatewayDomainName,
        description: "Expected public domain name for gateway-service"
      });

      new cdk.CfnOutput(this, "GatewayDnsTarget", {
        value: loadBalancer.loadBalancerDnsName,
        description: "Create a DNS record for GatewayDomainName pointing to this ALB DNS name"
      });
    }
  }
}
