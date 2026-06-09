import { createHmac, createVerify, timingSafeEqual } from "node:crypto";

import { Injectable, UnauthorizedException } from "@nestjs/common";

import { getAppConfig } from "../config/app.config.js";

export interface GatewayJwtClaims {
  sub: string;
  tenantId: string;
  type?: string;
  exp?: number;
  iat?: number;
  iss?: string;
  aud?: string | string[];
}

interface JwtHeader {
  alg?: string;
  typ?: string;
}

@Injectable()
export class JwtVerifier {
  private readonly config = getAppConfig();

  verify(token: string): GatewayJwtClaims {
    const { header, payload } = this.decode(token);
    this.verifySignature(token, header);

    if (!payload.sub || !payload.tenantId) {
      throw new UnauthorizedException({
        code: "AUTH_INVALID_TOKEN",
        message: "JWT must include sub and tenantId"
      });
    }

    if (payload.exp && payload.exp * 1000 <= Date.now()) {
      throw new UnauthorizedException({
        code: "AUTH_TOKEN_EXPIRED",
        message: "Access token expired"
      });
    }

    this.verifyIssuer(payload);
    this.verifyAudience(payload);

    return {
      sub: payload.sub,
      tenantId: payload.tenantId,
      type: payload.type,
      exp: payload.exp,
      iat: payload.iat,
      iss: payload.iss,
      aud: payload.aud
    };
  }

  private decode(token: string): { header: JwtHeader; payload: Partial<GatewayJwtClaims> } {
    const [header, payload, signature] = token.split(".");
    if (!header || !payload || !signature) {
      throw new UnauthorizedException({
        code: "AUTH_INVALID_TOKEN",
        message: "Invalid bearer token"
      });
    }

    try {
      return {
        header: JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as JwtHeader,
        payload: JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<GatewayJwtClaims>
      };
    } catch {
      throw new UnauthorizedException({
        code: "AUTH_INVALID_TOKEN",
        message: "Invalid bearer token"
      });
    }
  }

  private verifyIssuer(payload: Partial<GatewayJwtClaims>) {
    const expectedIssuer = this.config.jwt.issuer;
    if (!expectedIssuer) {
      return;
    }

    if (payload.iss !== expectedIssuer) {
      throw new UnauthorizedException({
        code: "AUTH_INVALID_TOKEN",
        message: "Invalid JWT issuer"
      });
    }
  }

  private verifyAudience(payload: Partial<GatewayJwtClaims>) {
    const expectedAudience = this.config.jwt.audience;
    if (!expectedAudience) {
      return;
    }

    const audience = payload.aud;
    const audienceMatches = Array.isArray(audience)
      ? audience.includes(expectedAudience)
      : audience === expectedAudience;

    if (!audienceMatches) {
      throw new UnauthorizedException({
        code: "AUTH_INVALID_TOKEN",
        message: "Invalid JWT audience"
      });
    }
  }

  private verifySignature(token: string, header: JwtHeader) {
    if (header.alg !== this.config.jwt.algorithm) {
      throw new UnauthorizedException({
        code: "AUTH_INVALID_TOKEN",
        message: "Unsupported JWT algorithm"
      });
    }

    if (header.alg === "HS256") {
      this.verifyHs256(token);
      return;
    }

    if (header.alg === "RS256") {
      this.verifyRs256(token);
      return;
    }

    throw new UnauthorizedException({
      code: "AUTH_INVALID_TOKEN",
      message: "Unsupported JWT algorithm"
    });
  }

  private verifyHs256(token: string) {
    const [header, payload, signature] = token.split(".");
    const secret = this.config.jwt.secret;
    if (!secret) {
      throw new UnauthorizedException({
        code: "AUTH_INVALID_TOKEN",
        message: "JWT secret is not configured"
      });
    }

    const expectedSignature = createHmac("sha256", secret)
      .update(`${header}.${payload}`)
      .digest("base64url");

    if (!this.safeEquals(signature, expectedSignature)) {
      throw new UnauthorizedException({
        code: "AUTH_INVALID_TOKEN",
        message: "Invalid JWT signature"
      });
    }
  }

  private verifyRs256(token: string) {
    const [header, payload, signature] = token.split(".");
    const publicKey = this.config.jwt.publicKey;
    if (!publicKey) {
      throw new UnauthorizedException({
        code: "AUTH_INVALID_TOKEN",
        message: "JWT public key is not configured"
      });
    }

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${payload}`);
    verifier.end();

    const isValid = verifier.verify(publicKey, Buffer.from(signature, "base64url"));
    if (!isValid) {
      throw new UnauthorizedException({
        code: "AUTH_INVALID_TOKEN",
        message: "Invalid JWT signature"
      });
    }
  }

  private safeEquals(actual: string, expected: string): boolean {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(actualBuffer, expectedBuffer);
  }
}
