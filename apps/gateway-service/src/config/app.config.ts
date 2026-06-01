export interface AppConfig {
  port: number;
}

const DEFAULT_GATEWAY_PORT = 3000;

export function getAppConfig(): AppConfig {
  return {
    port: readNumber("GATEWAY_PORT", DEFAULT_GATEWAY_PORT)
  };
}

function readNumber(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}
