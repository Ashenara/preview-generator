import { dbClient } from "../src/db.ts";

async function run() {
  const r = await dbClient.execute("SELECT * FROM books WHERE id = 24");
  console.log(JSON.stringify(r.rows, null, 2));
  dbClient.close();
}

run().catch(console.error);
