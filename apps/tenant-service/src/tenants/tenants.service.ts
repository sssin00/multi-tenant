import { createHash } from "node:crypto";
import { domainToASCII } from "node:url";

import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { TenantDomainStatus, TenantStatus } from "../generated/prisma/enums.js";
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

export interface ListTenantsCommand {
  query: Record<string, unknown>;
  requestId?: string;
  callerTenantId?: string;
  callerUserId?: string;
}

export interface UpdateTenantStatusCommand {
  tenantId: string;
  body: unknown;
  requestId?: string;
  callerTenantId?: string;
  callerUserId?: string;
}

export interface UpdateTenantCommand {
  tenantId: string;
  body: unknown;
  requestId?: string;
  callerTenantId?: string;
  callerUserId?: string;
}

export interface ReplaceTenantModulesCommand {
  tenantId: string;
  body: unknown;
  requestId?: string;
  callerTenantId?: string;
  callerUserId?: string;
}

export interface TenantDomainCommand {
  tenantId: string;
  requestId?: string;
  callerTenantId?: string;
  callerUserId?: string;
}

export interface AddTenantDomainCommand extends TenantDomainCommand {
  body: unknown;
}

export interface DeleteTenantDomainCommand extends TenantDomainCommand {
  domainId: string;
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

export interface TenantListResponse {
  items: TenantListItemResponse[];
  page: number;
  size: number;
  total: number;
}

export interface TenantListItemResponse extends TenantResponse {
  domains: string[];
  enabledModules: string[];
}

export interface TenantDomainResponse {
  domainId: string;
  tenantId: string;
  domain: string;
  status: TenantDomainStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TenantDetailResponse extends TenantResponse {
  domains: TenantDomainResponse[];
  enabledModules: string[];
  settings: Record<string, unknown>;
}

export interface TenantDomainListResponse {
  items: TenantDomainResponse[];
}

export interface ReplaceTenantModulesResponse {
  tenantId: string;
  enabledModules: string[];
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

  async list(command: ListTenantsCommand): Promise<TenantListResponse> {
    const query = this.validateListQuery(command.query);
    const where = this.buildTenantListWhere(query);
    const [items, total] = await Promise.all([
      this.prismaService.tenant.findMany({
        where,
        orderBy: {
          createdAt: "desc"
        },
        skip: (query.page - 1) * query.size,
        take: query.size,
        include: {
          domains: {
            orderBy: {
              createdAt: "asc"
            },
            select: {
              domain: true
            }
          },
          modules: {
            where: {
              enabled: true
            },
            orderBy: {
              moduleCode: "asc"
            },
            select: {
              moduleCode: true
            }
          }
        }
      }),
      this.prismaService.tenant.count({
        where
      })
    ]);

    return {
      items: items.map((tenant) => this.toTenantListItemResponse(tenant)),
      page: query.page,
      size: query.size,
      total
    };
  }

  async get(command: TenantLookupCommand): Promise<TenantDetailResponse> {
    const tenantId = this.requireTenantId(command.tenantId);
    const tenant = await this.prismaService.tenant.findUnique({
      where: {
        id: tenantId
      },
      include: {
        domains: {
          orderBy: {
            createdAt: "asc"
          }
        },
        modules: {
          where: {
            enabled: true
          },
          orderBy: {
            moduleCode: "asc"
          }
        },
        settings: {
          orderBy: {
            key: "asc"
          }
        }
      }
    });

    if (!tenant) {
      throw this.notFound();
    }

    return this.toTenantDetailResponse(tenant);
  }

  async update(command: UpdateTenantCommand): Promise<TenantResponse> {
    const tenantId = this.requireTenantId(command.tenantId);
    const input = this.validateUpdateBody(command.body);
    const existingTenant = await this.prismaService.tenant.findUnique({
      where: {
        id: tenantId
      }
    });

    if (!existingTenant) {
      throw this.notFound();
    }

    if (existingTenant.name === input.name) {
      return this.toTenantResponse(existingTenant);
    }

    const updatedTenant = await this.prismaService.tenant.update({
      where: {
        id: tenantId
      },
      data: {
        name: input.name
      }
    });

    return this.toTenantResponse(updatedTenant);
  }

  async updateStatus(command: UpdateTenantStatusCommand): Promise<TenantResponse> {
    const tenantId = this.requireTenantId(command.tenantId);
    const input = this.validateUpdateStatusBody(command.body);
    const existingTenant = await this.prismaService.tenant.findUnique({
      where: {
        id: tenantId
      }
    });

    if (!existingTenant) {
      throw this.notFound();
    }

    if (existingTenant.status === input.status) {
      return this.toTenantResponse(existingTenant);
    }

    const updatedTenant = await this.prismaService.$transaction(async (tx) => {
      const tenant = await tx.tenant.update({
        where: {
          id: tenantId
        },
        data: {
          status: input.status
        }
      });

      await this.outboxEventService.record(tx, {
        context: {
          tenantId,
          userId: command.callerUserId,
          requestId: command.requestId
        },
        eventType: "tenant.status.changed",
        aggregateType: "tenant",
        aggregateId: tenantId,
        data: {
          tenantId,
          previousStatus: existingTenant.status,
          status: tenant.status,
          reason: input.reason ?? null
        }
      });

      return tenant;
    });

    return this.toTenantResponse(updatedTenant);
  }

  async replaceModules(command: ReplaceTenantModulesCommand): Promise<ReplaceTenantModulesResponse> {
    const tenantId = this.requireTenantId(command.tenantId);
    const input = this.validateReplaceModulesBody(command.body);
    await this.ensureTenantExists(tenantId);

    const enabledModules = await this.prismaService.$transaction(async (tx) => {
      const existingModules = await tx.tenantModule.findMany({
        where: {
          tenantId
        },
        select: {
          moduleCode: true,
          enabled: true
        }
      });
      const existingEnabled = new Set(
        existingModules.filter((module) => module.enabled).map((module) => module.moduleCode)
      );
      const requestedEnabled = new Set(input.enabledModules);
      const modulesToEnable = input.enabledModules.filter((moduleCode) => !existingEnabled.has(moduleCode));
      const modulesToDisable = [...existingEnabled].filter((moduleCode) => !requestedEnabled.has(moduleCode));

      for (const moduleCode of input.enabledModules) {
        await tx.tenantModule.upsert({
          where: {
            tenantId_moduleCode: {
              tenantId,
              moduleCode
            }
          },
          update: {
            enabled: true
          },
          create: {
            tenantId,
            moduleCode,
            enabled: true
          }
        });
      }

      if (modulesToDisable.length > 0) {
        await tx.tenantModule.updateMany({
          where: {
            tenantId,
            moduleCode: {
              in: modulesToDisable
            }
          },
          data: {
            enabled: false
          }
        });
      }

      for (const moduleCode of modulesToEnable) {
        await this.outboxEventService.record(tx, {
          context: {
            tenantId,
            userId: command.callerUserId,
            requestId: command.requestId
          },
          eventType: "tenant.module.enabled",
          aggregateType: "tenant",
          aggregateId: tenantId,
          data: {
            tenantId,
            moduleCode
          }
        });
      }

      for (const moduleCode of modulesToDisable) {
        await this.outboxEventService.record(tx, {
          context: {
            tenantId,
            userId: command.callerUserId,
            requestId: command.requestId
          },
          eventType: "tenant.module.disabled",
          aggregateType: "tenant",
          aggregateId: tenantId,
          data: {
            tenantId,
            moduleCode
          }
        });
      }

      const currentModules = await tx.tenantModule.findMany({
        where: {
          tenantId,
          enabled: true
        },
        orderBy: {
          moduleCode: "asc"
        },
        select: {
          moduleCode: true
        }
      });

      return currentModules.map((module) => module.moduleCode);
    });

    return {
      tenantId,
      enabledModules
    };
  }

  async listDomains(command: TenantDomainCommand): Promise<TenantDomainListResponse> {
    const tenantId = this.requireTenantId(command.tenantId);
    await this.ensureTenantExists(tenantId);
    const domains = await this.prismaService.tenantDomain.findMany({
      where: {
        tenantId
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    return {
      items: domains.map((domain) => this.toTenantDomainResponse(domain))
    };
  }

  async addDomain(command: AddTenantDomainCommand): Promise<TenantDomainResponse> {
    const tenantId = this.requireTenantId(command.tenantId);
    const input = this.validateAddDomainBody(command.body);
    await this.ensureTenantExists(tenantId);
    await this.ensureDomainAvailable(input.domain);

    const domain = await this.prismaService.tenantDomain.create({
      data: {
        tenantId,
        domain: input.domain
      }
    });

    return this.toTenantDomainResponse(domain);
  }

  async deleteDomain(command: DeleteTenantDomainCommand): Promise<TenantDomainResponse> {
    const tenantId = this.requireTenantId(command.tenantId);
    const domainId = this.requireDomainId(command.domainId);
    await this.ensureTenantExists(tenantId);
    const existingDomain = await this.prismaService.tenantDomain.findFirst({
      where: {
        id: domainId,
        tenantId
      }
    });

    if (!existingDomain) {
      throw new NotFoundException({
        code: "TENANT_DOMAIN_NOT_FOUND",
        message: "Tenant domain not found"
      });
    }

    if (existingDomain.status === TenantDomainStatus.disabled) {
      return this.toTenantDomainResponse(existingDomain);
    }

    const domain = await this.prismaService.tenantDomain.update({
      where: {
        id: domainId
      },
      data: {
        status: TenantDomainStatus.disabled
      }
    });

    return this.toTenantDomainResponse(domain);
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

  private async ensureTenantExists(tenantId: string): Promise<void> {
    const tenant = await this.prismaService.tenant.findUnique({
      where: {
        id: tenantId
      },
      select: {
        id: true
      }
    });

    if (!tenant) {
      throw this.notFound();
    }
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

  private requireDomainId(value: string): string {
    if (!this.isUuid(value)) {
      throw new BadRequestException({
        code: "TENANT_DOMAIN_INVALID_ID",
        message: "Tenant domain id must be a UUID"
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

  private validateListQuery(query: Record<string, unknown>): {
    page: number;
    size: number;
    status?: TenantStatus;
    code?: string;
    name?: string;
    domain?: string;
  } {
    return {
      page: this.readPageNumber(query.page),
      size: this.readPageSize(query.size),
      status: query.status === undefined ? undefined : this.readTenantStatus(query.status, "status"),
      code: this.readOptionalSearchString(query.code, "code", 50),
      name: this.readOptionalSearchString(query.name, "name", 100),
      domain: this.readOptionalSearchString(query.domain, "domain", 253)
    };
  }

  private buildTenantListWhere(query: {
    status?: TenantStatus;
    code?: string;
    name?: string;
    domain?: string;
  }): Prisma.TenantWhereInput {
    const where: Prisma.TenantWhereInput = {};
    if (query.status) {
      where.status = query.status;
    }
    if (query.code) {
      where.code = {
        contains: query.code,
        mode: "insensitive"
      };
    }
    if (query.name) {
      where.name = {
        contains: query.name,
        mode: "insensitive"
      };
    }
    if (query.domain) {
      where.domains = {
        some: {
          domain: {
            contains: query.domain,
            mode: "insensitive"
          }
        }
      };
    }

    return where;
  }

  private validateUpdateStatusBody(body: unknown): { status: TenantStatus; reason?: string } {
    if (!this.isRecord(body)) {
      throw this.validationFailed("body", "Request body must be an object");
    }

    return {
      status: this.readTenantStatus(body.status, "status"),
      reason: this.readOptionalSearchString(body.reason, "reason", 500)
    };
  }

  private validateUpdateBody(body: unknown): { name: string } {
    if (!this.isRecord(body)) {
      throw this.validationFailed("body", "Request body must be an object");
    }

    if (body.name === undefined) {
      throw this.validationFailed("name", "name is required");
    }

    return {
      name: this.readRequiredString(body.name, "name", 100)
    };
  }

  private validateReplaceModulesBody(body: unknown): { enabledModules: string[] } {
    if (!this.isRecord(body)) {
      throw this.validationFailed("body", "Request body must be an object");
    }

    if (!Array.isArray(body.enabledModules)) {
      throw this.validationFailed("enabledModules", "enabledModules must be an array");
    }

    const enabledModules = body.enabledModules.map((value, index) => this.readModuleCode(value, `enabledModules.${index}`));

    return {
      enabledModules: [...new Set(enabledModules)].sort()
    };
  }

  private validateAddDomainBody(body: unknown): { domain: string } {
    if (!this.isRecord(body)) {
      throw this.validationFailed("body", "Request body must be an object");
    }

    const domain = this.readRequiredDomain(body.domain);

    return {
      domain
    };
  }

  private readTenantStatus(value: unknown, field: string): TenantStatus {
    if (typeof value !== "string") {
      throw this.validationFailed(field, `${field} must be a valid tenant status`);
    }

    if (
      value !== TenantStatus.provisioning &&
      value !== TenantStatus.active &&
      value !== TenantStatus.suspended &&
      value !== TenantStatus.deleted
    ) {
      throw this.validationFailed(field, `${field} must be one of provisioning, active, suspended, deleted`);
    }

    return value;
  }

  private readPageNumber(value: unknown): number {
    const page = this.readPositiveInteger(value, 1);
    return Math.max(1, page);
  }

  private readPageSize(value: unknown): number {
    const size = this.readPositiveInteger(value, 20);
    return Math.min(Math.max(1, size), 100);
  }

  private readPositiveInteger(value: unknown, fallback: number): number {
    if (value === undefined || value === null || value === "") {
      return fallback;
    }

    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw this.validationFailed("page", "page and size must be positive integers");
    }

    return parsed;
  }

  private readOptionalSearchString(value: unknown, field: string, maxLength: number): string | undefined {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    if (typeof value !== "string") {
      throw this.validationFailed(field, `${field} must be a string`);
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }

    if (trimmed.length > maxLength) {
      throw this.validationFailed(field, `${field} must be ${maxLength} characters or less`);
    }

    return trimmed;
  }

  private readModuleCode(value: unknown, field: string): string {
    if (typeof value !== "string") {
      throw this.validationFailed(field, `${field} must be a string`);
    }

    const moduleCode = value.trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{1,49}$/.test(moduleCode)) {
      throw this.validationFailed(field, `${field} must be a lowercase module code`);
    }

    return moduleCode;
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

  private readRequiredDomain(value: unknown): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw this.validationFailed("domain", "domain is required");
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

  private toTenantListItemResponse(tenant: {
    id: string;
    code: string;
    name: string;
    status: TenantStatus;
    dbStrategy: string;
    createdAt: Date;
    updatedAt: Date;
    domains: Array<{ domain: string }>;
    modules: Array<{ moduleCode: string }>;
  }): TenantListItemResponse {
    return {
      ...this.toTenantResponse(tenant),
      domains: tenant.domains.map((domain) => domain.domain),
      enabledModules: tenant.modules.map((module) => module.moduleCode)
    };
  }

  private toTenantDetailResponse(tenant: {
    id: string;
    code: string;
    name: string;
    status: TenantStatus;
    dbStrategy: string;
    createdAt: Date;
    updatedAt: Date;
    domains: Array<{
      id: string;
      tenantId: string;
      domain: string;
      status: TenantDomainStatus;
      createdAt: Date;
      updatedAt: Date;
    }>;
    modules: Array<{ moduleCode: string }>;
    settings: Array<{ key: string; value: Prisma.JsonValue }>;
  }): TenantDetailResponse {
    return {
      ...this.toTenantResponse(tenant),
      domains: tenant.domains.map((domain) => this.toTenantDomainResponse(domain)),
      enabledModules: tenant.modules.map((module) => module.moduleCode),
      settings: Object.fromEntries(tenant.settings.map((setting) => [setting.key, setting.value]))
    };
  }

  private toTenantDomainResponse(domain: {
    id: string;
    tenantId: string;
    domain: string;
    status: TenantDomainStatus;
    createdAt: Date;
    updatedAt: Date;
  }): TenantDomainResponse {
    return {
      domainId: domain.id,
      tenantId: domain.tenantId,
      domain: domain.domain,
      status: domain.status,
      createdAt: domain.createdAt.toISOString(),
      updatedAt: domain.updatedAt.toISOString()
    };
  }
}
