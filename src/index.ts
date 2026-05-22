import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dbClient } from "./db.js";
import { extractEpubText } from "./parser.js";
import { generateScreenplay, Screenplay } from "./ai.js";
import { generateVoiceover } from "./voice.js";
import { generateAndDownloadImage } from "./images.js";
import { compileVideo, VideoSlideInput } from "./video.js";

// Removed __dirname for ESM compatibility and replaced with process.cwd() based paths

// Helper to parse arguments
function getArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index !== -1 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return null;
}

// Generate a deterministic integer seed from a string (book ID + title)
function stringToSeed(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash) % 1000000;
}

async function main() {
  const bookIdStr = getArg("--book") || getArg("-b");
  const useFlux = process.argv.includes("--flux") || process.argv.includes("-f");

  if (!bookIdStr) {
    console.error("❌ Error: Missing Book ID. Usage: pnpm run generate --book <book_id> [--flux]");
    console.error("Example: pnpm run generate --book 12");
    process.exit(1);
  }

  const bookId = parseInt(bookIdStr, 10);
  if (isNaN(bookId)) {
    console.error(`❌ Error: Invalid Book ID "${bookIdStr}". Must be a number.`);
    process.exit(1);
  }

  console.log(`\n🔍 Fetching book metadata for ID: ${bookId} from Turso...`);
  
  const queryResult = await dbClient.execute({
    sql: "SELECT id, title, author, description, fileUrl FROM books WHERE id = ?",
    args: [bookId],
  });

  if (queryResult.rows.length === 0) {
    console.error(`❌ Error: No book found in the database with ID ${bookId}`);
    process.exit(1);
  }

  const book = queryResult.rows[0];
  const title = (book.title as string) || "Unknown Title";
  const author = (book.author as string) || "Unknown Author";
  const description = (book.description as string) || "";
  const fileUrl = book.fileUrl as string;

  if (!fileUrl) {
    console.error(`❌ Error: Book "${title}" does not have an EPUB file associated with it (fileUrl is null).`);
    process.exit(1);
  }

  console.log(`📖 Title: "${title}" by ${author}`);
  console.log(`🔗 File source: ${fileUrl}`);

  // Create workspace folders for outputs
  const outputDir = path.resolve(process.cwd(), "output");
  const tempDir = path.resolve(process.cwd(), "temp", bookId.toString());
  
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  // Step 1: Parse EPUB text
  console.log("\n--- STEP 1: PARSING EPUB ---");
  let chaptersText = "";
  try {
    chaptersText = await extractEpubText(fileUrl);
    console.log(`✅ Text successfully extracted from EPUB. Length: ${chaptersText.length} characters.`);
  } catch (error: any) {
    console.error(`❌ Failed to parse EPUB: ${error.message}`);
    process.exit(1);
  }

  // Step 2: Call Gemini to write screenplay
  console.log("\n--- STEP 2: GENERATING STORYBOARD WITH GEMINI ---");
  const screenplayCachePath = path.join(tempDir, "screenplay.json");
  let screenplay: Screenplay;

  if (fs.existsSync(screenplayCachePath)) {
    console.log(`🔄 Found cached screenplay JSON. Reusing: ${screenplayCachePath}`);
    screenplay = JSON.parse(fs.readFileSync(screenplayCachePath, "utf-8"));
  } else {
    try {
      screenplay = await generateScreenplay(title, author, description, chaptersText);
      fs.writeFileSync(screenplayCachePath, JSON.stringify(screenplay, null, 2));
      console.log(`💾 Screenplay script saved to cache: ${screenplayCachePath}`);
    } catch (error: any) {
      console.error(`❌ Failed to generate screenplay: ${error.message}`);
      process.exit(1);
    }
  }

  // Generate a fixed seed based on book title to keep character looks consistent
  const bookSeed = stringToSeed(title + bookId);
  console.log(`🌱 Using fixed seed ${bookSeed} for character styling consistency.`);

  // Step 3 & 4: Download Audio & Images Sequentially
  console.log("\n--- STEP 3 & 4: GENERATING AUDIO AND IMAGES SEQUENTIALLY ---");
  console.log(`🎨 Image Generation Model: ${useFlux ? "FLUX (High-Quality)" : "TURBO (High-Speed)"}`);
  
  const resolvedSlides = [];
  for (const slide of screenplay.slides) {
    const imagePath = path.join(tempDir, `slide_${slide.slideNumber}.jpg`);
    const audioPath = path.join(tempDir, `slide_${slide.slideNumber}.mp3`);

    // Download audio if it doesn't exist
    if (!fs.existsSync(audioPath)) {
      try {
        await generateVoiceover(slide.narrationText, audioPath);
        console.log(`   🎤 Slide ${slide.slideNumber}: Audio generated.`);
      } catch (error: any) {
        console.error(`   ⚠️ Failed to generate voiceover for slide ${slide.slideNumber}: ${error.message}`);
        throw error;
      }
    } else {
      console.log(`   🔄 Slide ${slide.slideNumber}: Audio already exists, skipping download.`);
    }

    // Download image if it doesn't exist
    if (!fs.existsSync(imagePath)) {
      try {
        await generateAndDownloadImage(
          slide.visualDescription,
          screenplay.characterProfile,
          screenplay.stylePreset,
          bookSeed,
          imagePath,
          useFlux
        );
        console.log(`   🎨 Slide ${slide.slideNumber}: Image generated.`);
      } catch (error: any) {
        console.error(`   ⚠️ Failed to generate image for slide ${slide.slideNumber}: ${error.message}`);
        throw error;
      }
    } else {
      console.log(`   🔄 Slide ${slide.slideNumber}: Image already exists, skipping download.`);
    }

    // Add a short delay to prevent hitting API limits
    await new Promise((resolve) => setTimeout(resolve, 500));

    resolvedSlides.push({
      slideNumber: slide.slideNumber,
      imagePath,
      audioPath,
      subtitles: slide.narrationText,
    });
  }

  const compiledSlides: VideoSlideInput[] = resolvedSlides.map((s) => ({
    imagePath: s.imagePath,
    audioPath: s.audioPath,
    subtitles: s.subtitles,
  }));

  // Step 5: Render Video
  console.log("\n--- STEP 5: COMPILING PREVIEW VIDEO ---");
  const outputVideoPath = path.join(outputDir, `${bookId}-preview.mp4`);
  
  try {
    await compileVideo(compiledSlides, outputVideoPath, tempDir);
    
    console.log("\n==================================================");
    console.log("🎉 SUCCESS!");
    console.log("==================================================");
    console.log(`📹 Video file created at: ${outputVideoPath}`);
    console.log(`💡 Next Steps:`);
    console.log(`   1. Upload this video to YouTube (as a Short or standard video).`);
    console.log(`   2. Copy the video ID (e.g., dQw4w9WgXcQ).`);
    console.log(`   3. Update your database using:`);
    console.log(`      pnpm run update-db --book ${bookId} --youtube YOUR_YOUTUBE_ID`);
    console.log("==================================================\n");
  } catch (error: any) {
    console.error(`❌ Failed to compile video:`, error);
    process.exit(1);
  } finally {
    // Optionally clean up temp files
    // fs.rmSync(tempDir, { recursive: true, force: true });
  }

  // Close Turso db client before exiting
  dbClient.close();
}

main().catch((err) => {
  console.error("Fatal Error:", err);
  dbClient.close();
  process.exit(1);
});
