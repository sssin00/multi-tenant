import { createHash } from "node:crypto";
import { domainToASCII } from "node:url";

import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../database/prisma.service.js";
import { TenantStatus } from "../generated/prisma/enums.js";
import { OutboxEventService } from "../outbox/outbox-event.service.js";

const TENANT_CODE_BASE_LENGTH = 4;
const TENANT_CODE_SEQUENCE_DIGITS = 4;
const TENANT_CODE_SEQUENCE_MAX = 9999;
const HANGUL_SYLLABLE_START = 0xac00;
const HANGUL_SYLLABLE_END = 0xd7a3;
const HANGUL_INITIAL_ROMANIZATION = [
  "G",
  "KK",
  "N",
  "D",
  "TT",
  "R",
  "M",
  "B",
  "PP",
  "S",
  "SS",
  "",
  "J",
  "JJ",
  "CH",
  "K",
  "T",
  "P",
  "H"
];
const HANGUL_MEDIAL_ROMANIZATION = [
  "A",
  "AE",
  "YA",
  "YAE",
  "EO",
  "E",
  "YEO",
  "YE",
  "O",
  "WA",
  "WAE",
  "OE",
  "YO",
  "U",
  "WO",
  "WE",
  "WI",
  "YU",
  "EU",
  "UI",
  "I"
];
const HANGUL_FINAL_ROMANIZATION = [
  "",
  "K",
  "K",
  "K",
  "N",
  "N",
  "N",
  "T",
  "L",
  "K",
  "M",
  "P",
  "L",
  "L",
  "P",
  "L",
  "M",
  "P",
  "P",
  "T",
  "T",
  "NG",
  "T",
  "T",
  "K",
  "T",
  "P",
  "T"
];
const MULTI_LABEL_PUBLIC_SUFFIXES = new Set([
  "ac.kr",
  "co.jp",
  "co.kr",
  "co.uk",
  "com.au",
  "go.kr",
  "ne.kr",
  "or.kr",
  "pe.kr",
  "re.kr"
]);

export interface TenantLookupCommand {
  tenantId: string;
  requestId?: string;
  callerTenantId?: string;
  callerUserId?: string;
}

export interface CreateTenantCommand {
  body: unknown;
  requestId?: string;
  callerTenantId?: string;
  callerUserId?: string;
}

export interface TenantStatusResponse {
  tenantId: string;
  code: string;
  name: string;
  status: TenantStatus;
}

export interface TenantModulesResponse {
  tenantId: string;
  status: TenantStatus;
  enabledModules: string[];
}

export interface TenantResponse {
  tenantId: string;
  code: string;
  name: string;
  status: TenantStatus;
  dbStrategy: string;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class TenantsService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(OutboxEventService)
    private readonly outboxEventService: OutboxEventService
  ) {}

  async create(command: CreateTenantCommand): Promise<TenantResponse> {
    const input = this.validateCreateBody(command.body);
    if (input.domain) {
      await this.ensureDomainAvailable(input.domain);
    }

    const code = await this.generateUniqueTenantCode(input);
    const tenant = await this.prismaService.$transaction(async (tx) => {
      const createdTenant = await tx.tenant.create({
        data: {
          code,
          name: input.name
        }
      });
      if (input.domain) {
        await tx.tenantDomain.create({
          data: {
            tenantId: createdTenant.id,
            domain: input.domain
          }
        });
      }
      await this.outboxEventService.record(tx, {
        context: {
          tenantId: createdTenant.id,
          userId: command.callerUserId,
          requestId: command.requestId
        },
        eventType: "tenant.created",
        aggregateType: "tenant",
        aggregateId: createdTenant.id,
        data: {
          tenantId: createdTenant.id,
          code: createdTenant.code,
          name: createdTenant.name,
          domain: input.domain ?? null,
          status: createdTenant.status
        }
      });

      return createdTenant;
    });

    return this.toTenantResponse(tenant);
  }

  async getStatus(command: TenantLookupCommand): Promise<TenantStatusResponse> {
    const tenantId = this.requireTenantId(command.tenantId);
    const tenant = await this.prismaService.tenant.findUnique({
      where: {
        id: tenantId
      },
      select: {
        id: true,
        code: true,
        name: true,
        status: true
      }
    });

    if (!tenant) {
      throw this.notFound();
    }

    return {
      tenantId: tenant.id,
      code: tenant.code,
      name: tenant.name,
      status: tenant.status
    };
  }

  async getModules(command: TenantLookupCommand): Promise<TenantModulesResponse> {
    const tenantId = this.requireTenantId(command.tenantId);
    const tenant = await this.prismaService.tenant.findUnique({
      where: {
        id: tenantId
      },
      select: {
        id: true,
        status: true,
        modules: {
          where: {
            enabled: true
          },
          select: {
            moduleCode: true
          },
          orderBy: {
            moduleCode: "asc"
          }
        }
      }
    });

    if (!tenant) {
      throw this.notFound();
    }

    return {
      tenantId: tenant.id,
      status: tenant.status,
      enabledModules: tenant.modules.map((module) => module.moduleCode)
    };
  }

  private requireTenantId(value: string): string {
    if (!this.isUuid(value)) {
      throw new BadRequestException({
        code: "TENANT_INVALID_ID",
        message: "Tenant id must be a UUID"
      });
    }

    return value;
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  private notFound() {
    return new NotFoundException({
      code: "TENANT_NOT_FOUND",
      message: "Tenant not found"
    });
  }

  private validateCreateBody(body: unknown): { name: string; domain?: string } {
    if (!this.isRecord(body)) {
      throw this.validationFailed("body", "Request body must be an object");
    }

    const name = this.readRequiredString(body.name, "name", 100);
    const domain = this.readOptionalDomain(body.domain);

    return {
      name,
      domain
    };
  }

  private async generateUniqueTenantCode(input: { name: string; domain?: string }): Promise<string> {
    const codePrefix = input.domain ? this.toTenantCodeBaseFromDomain(input.domain) : this.toTenantCodeBaseFromName(input.name);
    const existingTenants = await this.prismaService.tenant.findMany({
      where: {
        code: {
          startsWith: codePrefix
        }
      },
      select: {
        code: true
      }
    });
    const existingCodes = new Set(existingTenants.map((tenant) => tenant.code));

    for (let sequence = 1; sequence <= TENANT_CODE_SEQUENCE_MAX; sequence += 1) {
      const candidate = `${codePrefix}${sequence.toString().padStart(TENANT_CODE_SEQUENCE_DIGITS, "0")}`;
      if (!existingCodes.has(candidate)) {
        return candidate;
      }
    }

    throw new BadRequestException({
      code: "TENANT_CODE_GENERATION_FAILED",
      message: "Tenant code could not be generated"
    });
  }

  private toTenantCodeBaseFromDomain(domain: string): string {
    const labels = domain.split(".").filter((label) => label.length > 0);
    const primaryLabel = this.selectRegistrableDomainLabel(labels) ?? domain;

    return this.toFixedCodeBase(primaryLabel, domain);
  }

  private selectRegistrableDomainLabel(labels: string[]): string | undefined {
    if (labels.length < 2) {
      return labels[0];
    }

    const suffixLabelCount = this.getPublicSuffixLabelCount(labels);
    const registrableLabelIndex = labels.length - suffixLabelCount - 1;

    return labels[registrableLabelIndex] ?? labels[0];
  }

  private getPublicSuffixLabelCount(labels: string[]): number {
    const lastTwoLabels = labels.slice(-2).join(".");

    return MULTI_LABEL_PUBLIC_SUFFIXES.has(lastTwoLabels) ? 2 : 1;
  }

  private toTenantCodeBaseFromName(name: string): string {
    return this.toFixedCodeBase(name, name);
  }

  private toFixedCodeBase(value: string, hashSource: string): string {
    const normalized = this.toCodeSlug(value).replace(/-/g, "");
    const hash = this.shortHash(hashSource);
    const romanizedHangul = this.romanizeFirstHangulSyllable(value);
    const baseSource = normalized.length > 0 ? normalized : romanizedHangul ?? this.sliceHashForCodeBase(hash);
    const paddedBaseSource = `${baseSource}${hash}`;

    return paddedBaseSource.slice(0, TENANT_CODE_BASE_LENGTH);
  }

  private romanizeFirstHangulSyllable(value: string): string | undefined {
    for (const character of value.trim()) {
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined || codePoint < HANGUL_SYLLABLE_START || codePoint > HANGUL_SYLLABLE_END) {
        continue;
      }

      const syllableIndex = codePoint - HANGUL_SYLLABLE_START;
      const initialIndex = Math.floor(syllableIndex / 588);
      const medialIndex = Math.floor((syllableIndex % 588) / 28);
      const finalIndex = syllableIndex % 28;

      return [
        HANGUL_INITIAL_ROMANIZATION[initialIndex] ?? "",
        HANGUL_MEDIAL_ROMANIZATION[medialIndex] ?? "",
        HANGUL_FINAL_ROMANIZATION[finalIndex] ?? ""
      ].join("");
    }

    return undefined;
  }

  private toCodeSlug(value: string): string {
    return value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-")
      .toUpperCase();
  }

  private normalizeDomain(value: string): string {
    const rawValue = value.trim().toLowerCase();
    const candidate = rawValue.includes("://") ? rawValue : `https://${rawValue}`;
    let hostname: string;

    try {
      hostname = new URL(candidate).hostname;
    } catch {
      throw this.validationFailed("domain", "domain must be a valid hostname");
    }

    const asciiDomain = domainToASCII(hostname.replace(/\.$/, ""));
    if (!asciiDomain || asciiDomain.length > 253) {
      throw this.validationFailed("domain", "domain must be a valid hostname");
    }

    const labels = asciiDomain.split(".");
    if (labels.length < 2 || labels.some((label) => !this.isValidDomainLabel(label))) {
      throw this.validationFailed("domain", "domain must be a valid hostname");
    }

    return asciiDomain;
  }

  private isValidDomainLabel(label: string): boolean {
    return label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label);
  }

  private readOptionalDomain(value: unknown): string | undefined {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    if (typeof value !== "string") {
      throw this.validationFailed("domain", "domain must be a string");
    }

    return this.normalizeDomain(value);
  }

  private async ensureDomainAvailable(domain: string): Promise<void> {
    const existingDomain = await this.prismaService.tenantDomain.findUnique({
      where: {
        domain
      },
      select: {
        id: true
      }
    });

    if (existingDomain) {
      throw new ConflictException({
        code: "TENANT_DOMAIN_CONFLICT",
        message: "Tenant domain already exists"
      });
    }
  }

  private shortHash(value: string): string {
    return createHash("sha256").update(value.trim()).digest("hex").toUpperCase();
  }

  private sliceHashForCodeBase(hash: string): string {
    const startIndex = Math.max(0, Math.floor((hash.length - TENANT_CODE_BASE_LENGTH) / 2));

    return hash.slice(startIndex, startIndex + TENANT_CODE_BASE_LENGTH);
  }

  private readRequiredString(value: unknown, field: string, maxLength: number): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw this.validationFailed(field, `${field} is required`);
    }

    const trimmed = value.trim();
    if (trimmed.length > maxLength) {
      throw this.validationFailed(field, `${field} must be ${maxLength} characters or less`);
    }

    return trimmed;
  }

  private validationFailed(field: string, message: string) {
    return new BadRequestException({
      code: "VALIDATION_FAILED",
      message: "Validation failed",
      details: {
        fields: [
          {
            field,
            message
          }
        ]
      }
    });
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private toTenantResponse(tenant: {
    id: string;
    code: string;
    name: string;
    status: TenantStatus;
    dbStrategy: string;
    createdAt: Date;
    updatedAt: Date;
  }): TenantResponse {
    return {
      tenantId: tenant.id,
      code: tenant.code,
      name: tenant.name,
      status: tenant.status,
      dbStrategy: tenant.dbStrategy,
      createdAt: tenant.createdAt.toISOString(),
      updatedAt: tenant.updatedAt.toISOString()
    };
  }
}
