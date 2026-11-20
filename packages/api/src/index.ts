import path from "path";
import { fileURLToPath } from "url";
import { config as loadEnv } from "dotenv";
import { createApp } from "./app.js";
import { initializeColCache } from "./cost-of-living/cost-of-living.service.js";
import { initializeHpiCache } from "./housing/housing.service.js";
import { initializeAqiCache } from "./air-quality/air-quality.service.js";
import { initializePoliticalLeanCache } from "./political-lean/political-lean.service.js";
import { initializeRegionalJobsCache } from "./income/regional-jobs.service.js";

// Load .env from repo root (monorepo) or cwd
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");
loadEnv({ path: path.join(root, ".env.development") });
loadEnv({ path: path.join(root, ".env") });
loadEnv(); // cwd .env overrides

const app = createApp();
const port = process.env.PORT ?? 3000;

// Initialize FHFA data cache at startup
initializeHpiCache();
initializeAqiCache();
initializePoliticalLeanCache();
initializeColCache();
initializeRegionalJobsCache();

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
