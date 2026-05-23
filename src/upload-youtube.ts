import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { dbClient } from "./db.js";

// Removed __dirname for ESM compatibility

// Helper to parse arguments
function getArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index !== -1 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return null;
}

function generateBookSlug(id: number, title?: string | null): string {
  if (!title) return "novel";
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
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

export async function uploadBookVideo(bookId: number, privacyStatus: string): Promise<string> {
  interface YoutubeCreds {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    index: number;
  }

  const credsList: YoutubeCreds[] = [];

  // Set 1 (Default)
  if (process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_REFRESH_TOKEN) {
    credsList.push({
      clientId: process.env.YOUTUBE_CLIENT_ID,
      clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
      refreshToken: process.env.YOUTUBE_REFRESH_TOKEN,
      index: 1,
    });
  }

  // Set 2
  if (process.env.YOUTUBE_CLIENT_ID_2 && process.env.YOUTUBE_CLIENT_SECRET_2 && process.env.YOUTUBE_REFRESH_TOKEN_2) {
    credsList.push({
      clientId: process.env.YOUTUBE_CLIENT_ID_2,
      clientSecret: process.env.YOUTUBE_CLIENT_SECRET_2,
      refreshToken: process.env.YOUTUBE_REFRESH_TOKEN_2,
      index: 2,
    });
  }

  // Set 3
  if (process.env.YOUTUBE_CLIENT_ID_3 && process.env.YOUTUBE_CLIENT_SECRET_3 && process.env.YOUTUBE_REFRESH_TOKEN_3) {
    credsList.push({
      clientId: process.env.YOUTUBE_CLIENT_ID_3,
      clientSecret: process.env.YOUTUBE_CLIENT_SECRET_3,
      refreshToken: process.env.YOUTUBE_REFRESH_TOKEN_3,
      index: 3,
    });
  }

  if (credsList.length === 0) {
    throw new Error("YouTube API credentials are missing from your environment variables.");
  }

  // Verify that the video file exists
  const outputVideoPath = path.resolve(process.cwd(), "output", `${bookId}-preview.mp4`);
  if (!fs.existsSync(outputVideoPath)) {
    throw new Error(`Compiled video file not found at: ${outputVideoPath}`);
  }

  console.log(`\n🔍 Fetching book metadata for ID: ${bookId} from Turso...`);
  const queryResult = await dbClient.execute({
    sql: "SELECT title, author, description FROM books WHERE id = ?",
    args: [bookId],
  });

  if (queryResult.rows.length === 0) {
    throw new Error(`No book found in the database with ID ${bookId}`);
  }

  const book = queryResult.rows[0];
  const title = (book.title as string) || "Unknown Novel";
  const author = (book.author as string) || "Unknown Author";
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
              categoryId: "22", // People & Blogs
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
      console.log(`🔋 Updating Turso database with YouTube Video ID: "${videoId}"...`);
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
        console.log(`🛑 Quota exceeded for credentials set #${creds.index}. Trying next set if available...`);
        continue;
      }
      
      // If it's a non-quota error, throw it immediately (e.g. video compilation error or invalid file)
      throw error;
    }
  }

  // If all credentials failed
  throw lastError || new Error("All configured YouTube API credentials failed.");
}

async function main() {
  const bookIdStr = getArg("--book") || getArg("-b");
  const privacyStatus = getArg("--privacy") || getArg("-p") || "public";

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
