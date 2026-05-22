import { dbClient } from "./db.js";

function getArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index !== -1 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return null;
}

async function main() {
  const bookIdStr = getArg("--book") || getArg("-b");
  const youtubeId = getArg("--youtube") || getArg("-y");

  if (!bookIdStr || !youtubeId) {
    console.error("❌ Error: Missing arguments. Usage: pnpm run update-db --book <book_id> --youtube <youtube_video_id>");
    console.error("Example: pnpm run update-db --book 12 --youtube dQw4w9WgXcQ");
    process.exit(1);
  }

  const bookId = parseInt(bookIdStr, 10);
  if (isNaN(bookId)) {
    console.error(`❌ Error: Invalid Book ID "${bookIdStr}". Must be a number.`);
    process.exit(1);
  }

  console.log(`\n🔋 Connecting to database to update Book ID: ${bookId} with YouTube ID: "${youtubeId}"...`);

  // Check if book exists first
  const checkResult = await dbClient.execute({
    sql: "SELECT title FROM books WHERE id = ?",
    args: [bookId],
  });

  if (checkResult.rows.length === 0) {
    console.error(`❌ Error: No book found in the database with ID ${bookId}`);
    dbClient.close();
    process.exit(1);
  }

  const bookTitle = checkResult.rows[0].title;

  // Perform the update
  const updateResult = await dbClient.execute({
    sql: "UPDATE books SET youtubeVideoId = ? WHERE id = ?",
    args: [youtubeId, bookId],
  });

  if (updateResult.rowsAffected > 0) {
    console.log(`✅ Success! Book "${bookTitle}" (ID: ${bookId}) has been updated with youtubeVideoId = "${youtubeId}".`);
  } else {
    console.warn(`⚠️ Warning: Query succeeded but no rows were affected.`);
  }

  dbClient.close();
}

main().catch((err) => {
  console.error("Fatal Error during DB update:", err);
  dbClient.close();
  process.exit(1);
});
