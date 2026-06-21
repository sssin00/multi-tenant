import { SetMetadata } from "@nestjs/common";

export const APP_PERMISSION_METADATA = "appPermission";

export function AppPermission(permission: string): MethodDecorator {
  return SetMetadata(APP_PERMISSION_METADATA, permission);
}
