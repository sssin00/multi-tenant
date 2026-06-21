import { Injectable } from "@nestjs/common";
import { loadAppConfig } from "../config/app.config.js";

export interface HealthStatus {
  service: "user-bff-service";
  status: "ok";
  env: string;
  timestamp: string;
}

export interface ReadinessStatus extends HealthStatus {
  checks: {
    config: "ok";
    downstreamUrls: "ok";
    internalAuth: "ok";
  };
}

@Injectable()
export class HealthService {
  private readonly config = loadAppConfig();

  getHealth(): HealthStatus {
    return {
      service: this.config.serviceName,
      status: "ok",
      env: this.config.env,
      timestamp: new Date().toISOString()
    };
  }

  getReadiness(): ReadinessStatus {
    this.validateConfig();

    return {
      ...this.getHealth(),
      checks: {
        config: "ok",
        downstreamUrls: "ok",
        internalAuth: "ok"
      }
    };
  }

  private validateConfig(): void {
    const urls = [
      this.config.downstream.authIamServiceUrl,
      this.config.downstream.tenantServiceUrl,
      this.config.downstream.wmsServiceUrl
    ];
    if (this.config.downstream.auditLogServiceUrl) {
      urls.push(this.config.downstream.auditLogServiceUrl);
    }

    for (const value of urls) {
      new URL(value);
    }

    if (this.config.port <= 0 || this.config.port > 65535) {
      throw new Error("USER_BFF_PORT must be a valid TCP port");
    }

    if (this.config.downstream.timeoutMs <= 0) {
      throw new Error("USER_BFF_DOWNSTREAM_TIMEOUT_MS must be positive");
    }

    if (this.config.internalAuth.enabled) {
      const secrets = [
        this.config.internalAuth.authSecret,
        this.config.internalAuth.tenantSecret,
        this.config.internalAuth.wmsSecret
      ];
      if (this.config.audit.publisherType === "internal-api") {
        secrets.push(this.config.internalAuth.auditSecret);
      }

      for (const secret of secrets) {
        if (secret.length < 16) {
          throw new Error("Internal auth secrets must be at least 16 characters");
        }
      }
    }

    if (this.config.audit.publisherType === "eventbridge" && !this.config.audit.eventBridgeBusName) {
      throw new Error("USER_BFF_AUDIT_EVENTBRIDGE_BUS_NAME is required when app audit publisher is eventbridge");
    }
  }
}
