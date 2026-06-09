import { createHmac, createSign } from "node:crypto";

import { Injectable, ServiceUnavailableException } from "@nestjs/common";

import { getAppConfig } from "../config/app.config.js";

export interface AccessTokenClaims {
  sub: string;
  tenantId: string;
  type: "access";
  iat: number;
  exp: number;
  iss?: string;
  aud?: string;
}

@Injectable()
export class JwtSigner {
  private readonly config = getAppConfig();

  signAccessToken(userId: string, tenantId: string): { accessToken: string; expiresIn: number } {
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresIn = this.config.auth.accessTokenTtlSeconds;
    const claims: AccessTokenClaims = {
      sub: userId,
      tenantId,
      type: "access",
      iat: issuedAt,
      exp: issuedAt + expiresIn,
      iss: this.config.jwt.issuer,
      aud: this.config.jwt.audience
    };

    return {
      accessToken: this.sign(claims),
      expiresIn
    };
  }

  private sign(payload: AccessTokenClaims): string {
    const header = {
      alg: this.config.jwt.algorithm,
      typ: "JWT"
    };
    const encodedHeader = this.encodeJson(header);
    const encodedPayload = this.encodeJson(payload);
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    if (this.config.jwt.algorithm === "HS256") {
      if (!this.config.jwt.secret) {
        throw new ServiceUnavailableException({
          code: "AUTH_SIGNING_KEY_NOT_CONFIGURED",
          message: "JWT secret is not configured"
        });
      }

      const signature = createHmac("sha256", this.config.jwt.secret).update(signingInput).digest("base64url");
      return `${signingInput}.${signature}`;
    }

    if (!this.config.jwt.privateKey) {
      throw new ServiceUnavailableException({
        code: "AUTH_SIGNING_KEY_NOT_CONFIGURED",
        message: "JWT private key is not configured"
      });
    }

    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();

    return `${signingInput}.${signer.sign(this.config.jwt.privateKey, "base64url")}`;
  }

  private encodeJson(value: unknown): string {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
  }
}
