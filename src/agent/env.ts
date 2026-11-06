import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

export function loadLocalEnv(filePath = ".env"): boolean {
  if (!existsSync(filePath)) return false;
  loadEnvFile(filePath);
  return true;
}
