import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@libsql/client";

// Removed __dirname for ESM compatibility
dotenv.config({ path: path.resolve(process.cwd(), "../.env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const connectionUrl = process.env.TURSO_CONNECTION_URL?.replace(/^libsql:\/\//, "https://");
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!connectionUrl) {
  console.error("❌ Error: TURSO_CONNECTION_URL is not defined in the parent .env.local");
  process.exit(1);
}

export const dbClient = createClient({
  url: connectionUrl,
  authToken: authToken,
});

console.log("🔋 Connected to Turso database client successfully.");
