import { SetMetadata } from "@nestjs/common";

export const ADMIN_PERMISSION = "adminPermission";

export interface AdminPermissionOptions {
  permission: string | string[];
  warehouseIdParam?: string;
}

export const AdminPermission = (permission: string | string[], options: Omit<AdminPermissionOptions, "permission"> = {}) =>
  SetMetadata(ADMIN_PERMISSION, {
    permission,
    ...options
  } satisfies AdminPermissionOptions);
