import fs from "fs";
import path from "path";
import { dbClient } from "./db.js";
import { generateBookPreview } from "./index.js";
import { uploadBookVideo } from "./upload-youtube.js";

function getArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index !== -1 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return null;
}

function isQuotaError(error: any): boolean {
  const errMsg = (error.message || "").toLowerCase();
  if (errMsg.includes("quota") || errMsg.includes("limit") || errMsg.includes("rate limit")) {
    return true;
  }
  if (error.response && error.response.data && error.response.data.error) {
    const apiErr = error.response.data.error;
    const apiMsg = (apiErr.message || "").toLowerCase();
    if (apiMsg.includes("quota") || apiMsg.includes("limit") || apiMsg.includes("rate limit")) {
      return true;
    }
    if (apiErr.errors && Array.isArray(apiErr.errors)) {
      for (const ent of apiErr.errors) {
        const reason = (ent.reason || "").toLowerCase();
        const msg = (ent.message || "").toLowerCase();
        if (reason.includes("quota") || reason.includes("limit") || msg.includes("quota") || msg.includes("limit")) {
          return true;
        }
      }
    }
  }
  return false;
}

async function main() {
  const shardStr = getArg("--shard") || "0";
  const totalShardsStr = getArg("--total-shards") || "1";
  const limitStr = getArg("--limit") || "0";
  const privacyStatus = getArg("--privacy") || "public";
  const useFlux = process.argv.includes("--flux") || process.argv.includes("-f");

  const shard = parseInt(shardStr, 10);
  const totalShards = parseInt(totalShardsStr, 10);
  const limit = parseInt(limitStr, 10);

  console.log(`🤖 Starting Batch Generator...`);
  console.log(`🔹 Shard: ${shard} / Total Shards: ${totalShards}`);
  console.log(`🔹 Batch Limit: ${limit > 0 ? limit : "unlimited"}`);
  console.log(`🔹 Quality Model: ${useFlux ? "FLUX" : "TURBO"}`);
  console.log(`🔹 Upload Privacy: ${privacyStatus}`);

  console.log(`\n🔍 Querying database for novels missing YouTube trailers...`);
  const queryResult = await dbClient.execute({
    sql: "SELECT id, title FROM books WHERE youtubeVideoId IS NULL OR youtubeVideoId = '' ORDER BY id ASC",
    args: [],
  });

  const allPendingBooks = queryResult.rows;
  console.log(`📚 Found ${allPendingBooks.length} pending novels in total.`);

  // Filter books matching this shard: id % totalShards === shard
  const shardedBooks = allPendingBooks.filter((book) => {
    const bookId = book.id as number;
    return bookId % totalShards === shard;
  });

  console.log(`📊 Shard ${shard} has ${shardedBooks.length} novels to process.`);

  if (shardedBooks.length === 0) {
    console.log("✅ No novels left to process in this shard. Exiting.");
    dbClient.close();
    process.exit(0);
  }

  let processedCount = 0;

  for (const book of shardedBooks) {
    const bookId = book.id as number;
    const title = book.title as string;

    if (limit > 0 && processedCount >= limit) {
      console.log(`📍 Reached batch limit of ${limit} books. Stopping run.`);
      break;
    }

    console.log(`\n==================================================`);
    console.log(`🚀 [${processedCount + 1}/${shardedBooks.length}] Processing Book ID: ${bookId} - "${title}"`);
    console.log(`==================================================`);

    try {
      // 1. Generate the video
      const videoPath = await generateBookPreview(bookId, useFlux);
      console.log(`✅ Video compiled successfully: ${videoPath}`);

      // Staggered delay before YouTube upload to avoid concurrent upload rate limits
      const uploadDelaySeconds = shard * 120; // 2 minutes (120 seconds) per shard
      if (uploadDelaySeconds > 0) {
        console.log(`⏰ Staggering upload: waiting for ${uploadDelaySeconds} seconds (2 mins per shard)...`);
        await new Promise((resolve) => setTimeout(resolve, uploadDelaySeconds * 1000));
      }

      // 2. Upload the video
      const videoId = await uploadBookVideo(bookId, privacyStatus);
      console.log(`🎉 Video uploaded successfully! YouTube ID: ${videoId}`);

      // 3. Clean up temp folder for this book to save disk space on runner
      const tempDir = path.resolve(process.cwd(), "temp", bookId.toString());
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log(`🧹 Cleaned up temporary files in ${tempDir}`);
      }

      processedCount++;
    } catch (error: any) {
      console.error(`\n❌ Error processing Book ID ${bookId}:`, error.message || error);
      if (error.response && error.response.data) {
        console.error("API details:", JSON.stringify(error.response.data, null, 2));
      }

      // Check if this error is a YouTube Quota Limit or critical auth error
      if (isQuotaError(error)) {
        console.error(`\n🛑 YouTube API daily quota limit reached or invalid credentials. Halting execution!`);
        dbClient.close();
        process.exit(1); // Fail the job to stop the pipeline
      }

      // Check for Turso DB/Connection issues
      if (error.message && error.message.toLowerCase().includes("database")) {
        console.error(`🛑 Database connection issue. Halting execution!`);
        dbClient.close();
        process.exit(1);
      }

      console.warn(`⚠️ Skipping Book ID ${bookId} due to non-critical failure. Moving to next...`);
    }
  }

  console.log(`\n==================================================`);
  console.log(`✅ Batch run finished! Processed ${processedCount} books successfully.`);
  console.log(`==================================================\n`);

  dbClient.close();
}

main().catch((err) => {
  console.error("Fatal Error in batch main:", err);
  dbClient.close();
  process.exit(1);
});
