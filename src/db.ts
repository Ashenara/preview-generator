import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const databaseId = process.env.CLOUDFLARE_DATABASE_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;

if (!accountId || !databaseId || !apiToken) {
  console.error("❌ Error: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DATABASE_ID, or CLOUDFLARE_API_TOKEN is not defined in .env.local");
  process.exit(1);
}

class D1Client {
  private accountId: string;
  private databaseId: string;
  private apiToken: string;

  constructor(accountId: string, databaseId: string, apiToken: string) {
    this.accountId = accountId;
    this.databaseId = databaseId;
    this.apiToken = apiToken;
  }

  async execute(stmt: string | { sql: string; args?: any[] }) {
    let sql: string;
    let params: any[] = [];

    if (typeof stmt === "string") {
      sql = stmt;
    } else {
      sql = stmt.sql;
      params = stmt.args || [];
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${this.databaseId}/query`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sql,
        params,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`D1 API query failed with status ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as any;

    if (!data.success) {
      const errorMsg = data.errors?.map((e: any) => `${e.code}: ${e.message}`).join(", ") || "Unknown D1 error";
      throw new Error(`D1 Query failed: ${errorMsg}`);
    }

    const firstResult = data.result?.[0];
    if (!firstResult) {
      throw new Error("D1 Query returned no results or metadata.");
    }

    if (!firstResult.success) {
      throw new Error("D1 Statement execution failed.");
    }

    return {
      rows: firstResult.results || [],
      rowsAffected: firstResult.meta?.changes || 0,
      lastInsertRowid: firstResult.meta?.last_row_id,
    };
  }

  close() {
    // No-op for HTTP-based D1 client
  }
}

export const dbClient = new D1Client(accountId, databaseId, apiToken);

console.log("🔋 Connected to Cloudflare D1 database client successfully.");

