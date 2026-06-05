import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { dbClient } from "./db.js";
import { getArg, generateBookSlug, isQuotaError } from "./utils.js";

export async function uploadBookVideo(bookId: number, privacyStatus: string): Promise<string> {
  interface YoutubeCreds {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    index: number;
  }

  const credsList: YoutubeCreds[] = [];

  // 1. Load from YOUTUBE_CREDS_JSON if defined
  if (process.env.YOUTUBE_CREDS_JSON) {
    try {
      const parsed = JSON.parse(process.env.YOUTUBE_CREDS_JSON);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of list) {
        if (item.clientId && item.clientSecret && item.refreshToken) {
          credsList.push({
            clientId: item.clientId.trim(),
            clientSecret: item.clientSecret.trim(),
            refreshToken: item.refreshToken.trim(),
            index: credsList.length + 1,
          });
        }
      }
      console.log(`📡 Loaded ${credsList.length} YouTube credential sets from YOUTUBE_CREDS_JSON.`);
    } catch (err: any) {
      console.warn("⚠️ Failed to parse YOUTUBE_CREDS_JSON environment variable:", err.message);
    }
  }

  // 2. Load primary credentials (if not already loaded via JSON)
  const primaryId = process.env.YOUTUBE_CLIENT_ID;
  const primarySecret = process.env.YOUTUBE_CLIENT_SECRET;
  const primaryRefresh = process.env.YOUTUBE_REFRESH_TOKEN;
  
  if (primaryId && primarySecret && primaryRefresh) {
    const isDuplicate = credsList.some(c => c.clientId === primaryId.trim());
    if (!isDuplicate) {
      credsList.push({
        clientId: primaryId.trim(),
        clientSecret: primarySecret.trim(),
        refreshToken: primaryRefresh.trim(),
        index: credsList.length + 1,
      });
    }
  }

  // 3. Dynamically scan for individual env credentials YOUTUBE_CLIENT_ID_N (from N=2 to 30)
  for (let i = 2; i <= 30; i++) {
    const cid = process.env[`YOUTUBE_CLIENT_ID_${i}`];
    const csec = process.env[`YOUTUBE_CLIENT_SECRET_${i}`];
    const cref = process.env[`YOUTUBE_REFRESH_TOKEN_${i}`];

    if (cid && csec && cref) {
      const isDuplicate = credsList.some(c => c.clientId === cid.trim());
      if (!isDuplicate) {
        credsList.push({
          clientId: cid.trim(),
          clientSecret: csec.trim(),
          refreshToken: cref.trim(),
          index: credsList.length + 1,
        });
      }
    }
  }

  if (credsList.length === 0) {
    throw new Error("YouTube API credentials are missing from your environment variables.");
  }

  // Verify that the video file exists
  const outputVideoPath = path.resolve(process.cwd(), "output", `${bookId}-preview.mp4`);
  if (!fs.existsSync(outputVideoPath)) {
    throw new Error(`Compiled video file not found at: ${outputVideoPath}`);
  }

  console.log(`\n🔍 Fetching book metadata for ID: ${bookId} from Cloudflare D1...`);
  const queryResult = await dbClient.execute({
    sql: "SELECT title, author, description FROM books WHERE id = ?",
    args: [bookId],
  });

  if (queryResult.rows.length === 0) {
    throw new Error(`No book found in the database with ID ${bookId}`);
  }

  const book = queryResult.rows[0];
  const title = ((book.title as string) || "Unknown Novel").replace(/[<>]/g, "");
  const author = ((book.author as string) || "Unknown Author").replace(/[<>]/g, "");
  let description = (book.description as string) || "";
  
  // Clean description: strip HTML tags and remove any leftover < or > characters which YouTube rejects
  description = description.replace(/<[^>]*>/g, "").replace(/[<>]/g, "");

  // Prepare video metadata
  let videoTitle = `${title} - Novel Preview Trailer`;
  if (videoTitle.length > 95) {
    videoTitle = videoTitle.slice(0, 92) + "...";
  }

  const bookSlug = generateBookSlug(bookId, title);
  const readUrl = `https://novels.ashenara.com/books/${bookId}/${bookSlug}`;
  let videoDescription = `${videoTitle}\n\nAuthor: ${author}\n\nRead the novel here: ${readUrl}\n\nDescription:\n${description}\n\nGenerated automatically by Ashenara Preview Generator.`;
  
  // Truncate to avoid exceeding YouTube's 5000 character limit
  if (videoDescription.length > 4900) {
    videoDescription = videoDescription.slice(0, 4890) + "...";
  }

  console.log(`\n📺 Video Title: "${videoTitle}"`);
  console.log(`🔒 Privacy Status: ${privacyStatus}`);
  console.log(`📤 Uploading file: ${outputVideoPath}`);
  
  const fileSize = fs.statSync(outputVideoPath).size;
  let lastError: any = null;
  let hasQuotaError = false;

  for (const creds of credsList) {
    console.log(`📡 Attempting upload using YouTube credentials set #${creds.index}...`);
    try {
      // Setup Google OAuth2 client
      const oauth2Client = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
      oauth2Client.setCredentials({ refresh_token: creds.refreshToken });

      const youtube = google.youtube({
        version: "v3",
        auth: oauth2Client,
      });

      console.log(`⚡ Starting upload stream to YouTube (using Credentials #${creds.index})...`);
      const response = await youtube.videos.insert(
        {
          part: ["snippet", "status"],
          requestBody: {
            snippet: {
              title: videoTitle,
              description: videoDescription,
              tags: ["light novel", "web novel", "ashenara", author.toLowerCase(), title.toLowerCase()],
              categoryId: "1", // Film & Animation
              defaultLanguage: "en",
            },
            status: {
              privacyStatus: privacyStatus,
              selfDeclaredMadeForKids: false,
            },
          },
          media: {
            body: fs.createReadStream(outputVideoPath),
          },
        },
        {
          onUploadProgress: (evt) => {
            const progress = ((evt.bytesRead / fileSize) * 100).toFixed(2);
            process.stdout.write(`   Uploading (Creds #${creds.index}): ${progress}% (${evt.bytesRead}/${fileSize} bytes)\r`);
          },
        }
      );

      const videoId = response.data.id;
      if (!videoId) {
        throw new Error("YouTube API returned empty video ID.");
      }

      console.log(`\n✅ YouTube upload complete! Video ID: ${videoId}`);
      console.log(`🔗 Watch URL: https://youtu.be/${videoId}`);

      // Update the database
      console.log(`🔋 Updating Cloudflare D1 database with YouTube Video ID: "${videoId}"...`);
      const updateResult = await dbClient.execute({
        sql: "UPDATE books SET youtubeVideoId = ? WHERE id = ?",
        args: [videoId, bookId],
      });

      if (updateResult.rowsAffected > 0) {
        console.log(`✅ Database successfully updated for "${title}" (ID: ${bookId}).`);
      } else {
        console.warn("⚠️ Warning: Query completed but no rows were updated.");
      }

      return videoId;
    } catch (error: any) {
      console.warn(`\n⚠️ YouTube upload failed with credentials set #${creds.index}: ${error.message || error}`);
      lastError = error;

      if (isQuotaError(error)) {
        hasQuotaError = true;
        console.log(`🛑 Quota exceeded for credentials set #${creds.index}.`);
      }
      
      console.log("📡 Attempting fallback to next credentials set...");
    }
  }

  // If all credentials failed
  const finalError = lastError || new Error("All configured YouTube API credentials failed.");

  if (hasQuotaError) {
    console.error("🛑 All attempted credentials failed, and at least one failure was due to YouTube API Quota limit.");
    try {
      console.log("🔋 Recording YouTube quota exhaustion state in Cloudflare D1 database site_settings...");
      const nowEpoch = Math.floor(Date.now() / 1000);
      
      // Upsert into site_settings (D1 supports INSERT OR REPLACE)
      await dbClient.execute({
        sql: "INSERT OR REPLACE INTO site_settings (key, value, updatedAt) VALUES ('youtube_quota_exceeded', ?, ?)",
        args: ["true", nowEpoch],
      });
      console.log("✅ Quota state successfully recorded in database.");
    } catch (dbErr: any) {
      console.warn(`⚠️ Failed to record quota state in DB: ${dbErr.message || dbErr}`);
    }
  }

  throw finalError;
}

async function main() {
  const bookIdStr = getArg("--book", "-b");
  const privacyStatus = getArg("--privacy", "-p") || "public";

  if (!bookIdStr) {
    console.error("❌ Error: Missing Book ID. Usage: pnpm run upload-youtube --book <book_id> [--privacy public|unlisted|private]");
    process.exit(1);
  }

  const bookId = parseInt(bookIdStr, 10);
  if (isNaN(bookId)) {
    console.error(`❌ Error: Invalid Book ID "${bookIdStr}". Must be a number.`);
    process.exit(1);
  }

  try {
    const videoId = await uploadBookVideo(bookId, privacyStatus);
    console.log(`🎉 Success! Video uploaded and ID "${videoId}" saved to database.`);
  } catch (error: any) {
    console.error("\n❌ Upload failed:", error.message || error);
    if (error.response && error.response.data) {
      console.error("API response details:", JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  } finally {
    dbClient.close();
  }
}

const isMain = process.argv[1] && (
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
  process.argv[1].endsWith("upload-youtube.ts") ||
  process.argv[1].endsWith("upload-youtube.js") ||
  process.argv[1].endsWith("upload-youtube")
);

if (isMain) {
  main().catch((err) => {
    console.error("Fatal Error during upload:", err);
    dbClient.close();
    process.exit(1);
  });
}
