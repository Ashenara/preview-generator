import { dbClient } from "./db.js";

async function main() {
  console.log("🚀 Starting manual migration run on Turso...");
  
  try {
    console.log("Adding youtubeVideoId column to books table...");
    await dbClient.execute("ALTER TABLE `books` ADD `youtubeVideoId` text;");
    console.log("✅ Successfully added youtubeVideoId to books table.");
  } catch (error: any) {
    if (error.message && error.message.includes("duplicate column name")) {
      console.log("ℹ️ youtubeVideoId column already exists.");
    } else {
      console.error("❌ Failed to add youtubeVideoId:", error.message || error);
    }
  }

  try {
    console.log("Adding bannerPosition column to users table...");
    await dbClient.execute("ALTER TABLE `users` ADD `bannerPosition` integer DEFAULT 50;");
    console.log("✅ Successfully added bannerPosition to users table.");
  } catch (error: any) {
    if (error.message && error.message.includes("duplicate column name")) {
      console.log("ℹ️ bannerPosition column already exists.");
    } else {
      console.error("❌ Failed to add bannerPosition:", error.message || error);
    }
  }

  console.log("🏁 Migration run finished.");
  dbClient.close();
}

main().catch((err) => {
  console.error("Fatal error during manual migration:", err);
  dbClient.close();
  process.exit(1);
});
