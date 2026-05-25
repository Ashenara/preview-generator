import { dbClient } from "../src/db.js";

async function main() {
  console.log("Querying first 5 books...");
  const result = await dbClient.execute("SELECT id, title FROM books LIMIT 5");
  console.log("Books found:");
  console.log(JSON.stringify(result.rows, null, 2));
}

main().catch(console.error).finally(() => dbClient.close());
