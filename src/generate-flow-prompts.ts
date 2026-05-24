import fs from "fs";
import path from "path";
import { dbClient } from "./db.js";
import { extractEpubText } from "./parser.js";
import { generateScreenplay } from "./ai.js";

// Helper to parse arguments
function getArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index !== -1 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return null;
}

export async function generateFlowPrompts(bookId: number): Promise<string> {
  console.log(`\n🔍 Fetching book metadata for ID: ${bookId} from Turso...`);
  
  const queryResult = await dbClient.execute({
    sql: "SELECT id, title, author, description, fileUrl FROM books WHERE id = ?",
    args: [bookId],
  });

  if (queryResult.rows.length === 0) {
    throw new Error(`No book found in the database with ID ${bookId}`);
  }

  const book = queryResult.rows[0];
  const title = (book.title as string) || "Unknown Title";
  const author = (book.author as string) || "Unknown Author";
  const description = (book.description as string) || "";
  const fileUrl = book.fileUrl as string;

  if (!fileUrl) {
    throw new Error(`Book "${title}" does not have an EPUB file associated with it.`);
  }

  console.log(`📖 Title: "${title}" by ${author}`);
  
  // Create output folder if it doesn't exist
  const outputDir = path.resolve(process.cwd(), "output");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // Step 1: Parse EPUB text
  console.log("\n--- STEP 1: PARSING EPUB ---");
  const chaptersText = await extractEpubText(fileUrl);
  console.log(`✅ Text successfully extracted from EPUB. Length: ${chaptersText.length} characters.`);

  // Step 2: Call Gemini to write screenplay (Uses latest Flash model logic inside ai.ts)
  console.log("\n--- STEP 2: GENERATING STORYBOARD WITH GEMINI ---");
  const screenplay = await generateScreenplay(title, author, description, chaptersText);

  // Step 3: Format prompts for Google Labs Flow
  console.log("\n--- STEP 3: FORMATTING PROMPTS FOR GOOGLE LABS FLOW ---");
  
  let outputContent = `==================================================
GOOGLE LABS FLOW VIDEO GENERATION PROMPTS
==================================================
Book ID: ${bookId}
Title: "${title}"
Author: ${author}

STYLE PRESET:
${screenplay.stylePreset}

CHARACTER PROFILE:
${screenplay.characterProfile}

==================================================
COPY-PASTE SLIDE PROMPTS (10-12 SLIDES)
==================================================
`;

  screenplay.slides.forEach((slide) => {
    const fullPrompt = `${slide.visualDescription}, protagonist: ${screenplay.characterProfile}, style: ${screenplay.stylePreset}`;
    
    outputContent += `
--------------------------------------------------
SLIDE ${slide.slideNumber}
--------------------------------------------------
VOICEOVER/NARRATION:
"${slide.narrationText}"

GOOGLE FLOW VIDEO PROMPT:
${fullPrompt}
`;
  });

  outputContent += `\n==================================================\n`;

  const outputPath = path.join(outputDir, `${bookId}-flow-prompts.txt`);
  fs.writeFileSync(outputPath, outputContent, "utf-8");
  
  console.log(`✅ Flow prompts successfully written to: ${outputPath}`);
  
  // Also display them on screen for easy copy-pasting
  console.log("\n" + outputContent);

  return outputPath;
}

async function main() {
  const bookIdStr = getArg("--book") || getArg("-b");

  if (!bookIdStr) {
    console.error("❌ Error: Missing Book ID. Usage: pnpm run generate-flow --book <book_id>");
    console.error("Example: pnpm run generate-flow --book 1462");
    process.exit(1);
  }

  const bookId = parseInt(bookIdStr, 10);
  if (isNaN(bookId)) {
    console.error(`❌ Error: Invalid Book ID "${bookIdStr}". Must be a number.`);
    process.exit(1);
  }

  try {
    await generateFlowPrompts(bookId);
    console.log("🎉 Flow prompts export complete!");
  } catch (error: any) {
    console.error(`❌ Failed to generate prompts:`, error.message || error);
    process.exit(1);
  } finally {
    dbClient.close();
  }
}

main().catch((err) => {
  console.error("Fatal Error:", err);
  dbClient.close();
  process.exit(1);
});
