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
    const isHttpsEnabled = props.gatewayAcmCertificateArn !== undefined && props.gatewayAcmCertificateArn.length > 0;
    const isJwtSecretConfigured = props.gatewayJwtSecretArn !== undefined && props.gatewayJwtSecretArn.length > 0;
    const corsAllowedOrigins =
      props.gatewayCorsAllowedOrigins ??
      (props.envName === "prod" ? "https://app.example.com,https://admin.example.com" : "https://dev.example.com");
    const jwtSecret = isJwtSecretConfigured
      ? secretsmanager.Secret.fromSecretCompleteArn(this, "GatewayJwtSecret", props.gatewayJwtSecretArn as string)
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

    const taskDefinition = new ecs.FargateTaskDefinition(this, "GatewayTaskDefinition", {
      family: `${namePrefix}-${serviceName}`,
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.X86_64
      }
    });

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
        TENANT_SERVICE_URL: props.tenantServiceUrl ?? "http://tenant-service:3000",
        GATEWAY_TENANT_STATUS_CHECK_ENABLED: "false",
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
        AUTH_IAM_SERVICE_URL: props.authIamServiceUrl ?? "http://auth-iam-service:3000",
        ADMIN_BFF_SERVICE_URL: props.adminBffServiceUrl ?? "http://admin-bff-service:3000",
        USER_BFF_SERVICE_URL: props.userBffServiceUrl ?? "http://user-bff-service:3000"
      },
      secrets: jwtSecret
        ? {
            JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret)
          }
        : undefined,
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

    cdk.Tags.of(this).add("Project", props.project);
    cdk.Tags.of(this).add("Environment", props.envName);
    cdk.Tags.of(this).add("Service", serviceName);
    cdk.Tags.of(this).add("ManagedBy", "cdk");

    new cdk.CfnOutput(this, "GatewayServiceRepositoryUri", {
      value: repository.repositoryUri,
      description: "ECR repository URI for gateway-service"
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
