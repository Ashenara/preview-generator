import fs from "fs";
import path from "path";
import { GoogleGenerativeAI, SchemaType, Schema } from "@google/generative-ai";
import * as dotenv from "dotenv";
import { dbClient } from "./db.js";
import { extractAllEpubChapters, EpubChapter } from "./parser.js";

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_2;
if (!apiKey) {
  console.error("❌ Error: GEMINI_API_KEY is not defined in .env.local");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

interface FlowSlide {
  slideNumber: number;
  narrationText: string;
  prompt: string;
  style: string;
}

interface FlowProfile {
  characterProfile: string;
  style: string;
}

const profileSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    characterProfile: { type: SchemaType.STRING },
    style: { type: SchemaType.STRING },
  },
  required: ["characterProfile", "style"],
};

const batchSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    slides: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          slideNumber: { type: SchemaType.INTEGER },
          narrationText: { type: SchemaType.STRING },
          prompt: { type: SchemaType.STRING },
          style: { type: SchemaType.STRING },
        },
        required: ["slideNumber", "narrationText", "prompt", "style"],
      },
    },
  },
  required: ["slides"],
};

// Helper to parse arguments
function getArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index !== -1 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return null;
}

function parseChapterRange(arg: string | null, totalChapters: number): number[] {
  if (!arg) {
    // Default to first 10 chapters
    console.log("⚠️ Notice: No --chapters specified. Defaulting to chapters 1-10.");
    const count = Math.min(10, totalChapters);
    return Array.from({ length: count }, (_, i) => i);
  }

  if (arg.toLowerCase() === "all") {
    return Array.from({ length: totalChapters }, (_, i) => i);
  }

  const indices: Set<number> = new Set();
  const parts = arg.split(",");

  for (const part of parts) {
    if (part.includes("-")) {
      const [startStr, endStr] = part.split("-");
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = start; i <= end; i++) {
          if (i >= 1 && i <= totalChapters) {
            indices.add(i - 1);
          }
        }
      }
    } else {
      const num = parseInt(part, 10);
      if (!isNaN(num) && num >= 1 && num <= totalChapters) {
        indices.add(num - 1);
      }
    }
  }

  return Array.from(indices).sort((a, b) => a - b);
}

export async function generateFlowPrompts(bookId: number, chaptersArg: string | null): Promise<string> {
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
  
  const outputDir = path.resolve(process.cwd(), "output");
  const tempDir = path.resolve(process.cwd(), "temp", bookId.toString());
  
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  // Step 1: Parse EPUB text
  console.log("\n--- STEP 1: PARSING ALL CHAPTERS FROM EPUB ---");
  const allChapters = await extractAllEpubChapters(fileUrl);
  console.log(`✅ Extracted ${allChapters.length} chapters.`);

  const selectedIndices = parseChapterRange(chaptersArg, allChapters.length);
  if (selectedIndices.length === 0) {
    throw new Error("No valid chapters were selected by the range filter.");
  }
  console.log(`🎯 Selected ${selectedIndices.length} chapters for generation.`);

  // Step 2: Resolve Character Profile & Style Preset
  console.log("\n--- STEP 2: RESOLVING CHARACTER PROFILE & VISUAL STYLE ---");
  const profileCachePath = path.join(tempDir, "flow_profile.json");
  let profile: FlowProfile;

  if (fs.existsSync(profileCachePath)) {
    console.log(`🔄 Found cached character profile. Reusing: ${profileCachePath}`);
    profile = JSON.parse(fs.readFileSync(profileCachePath, "utf-8"));
  } else {
    console.log("Generating a fresh character profile and visual style from first 3 chapters...");
    const sampleChapters = allChapters.slice(0, 3);
    let sampleText = "";
    for (const ch of sampleChapters) {
      sampleText += `\n\n--- ${ch.title} ---\n\n${ch.text.substring(0, 3000)}`;
    }

    const profilePrompt = `
You are an expert AI prompt engineer and character designer.
Analyze the following novel details and chapters, and generate:
1. A "characterProfile": A detailed description of the protagonist's features, clothes, hair, and expression (e.g. "A 16-year-old girl, delicate face, sharp black eyes, a confident and feisty expression, and long dark hair partially tied up in a simple ancient bun"). This will be used to define and create consistent characters in Google Labs Flow.
2. A consistent visual "style" preset for the book (e.g., "Detailed 2D digital anime illustration, web novel cover art style, cinematic composition, dramatic lighting, vibrant colors with rich historical details, ancient Chinese rustic background").

Here is the novel info:
Title: ${title}
Author: ${author}
Description: ${description}

Sample Chapters Text:
${sampleText}
`;

    const model = genAI.getGenerativeModel({
      model: "gemini-3.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: profileSchema,
      },
    });

    const result = await model.generateContent(profilePrompt);
    const textResponse = result.response.text();
    if (!textResponse) {
      throw new Error("Failed to generate character profile response");
    }

    profile = JSON.parse(textResponse);
    fs.writeFileSync(profileCachePath, JSON.stringify(profile, null, 2), "utf-8");
    console.log(`💾 Character profile and style saved to cache: ${profileCachePath}`);
  }

  console.log(`👤 Protagonist Profile: "${profile.characterProfile}"`);
  console.log(`🎨 Style Preset: "${profile.style}"`);

  // Step 3: Generate slides in batches of 10 chapters
  console.log("\n--- STEP 3: GENERATING STORYBOARD IN BATCHES ---");
  const batchSize = 10;
  const allSlides: FlowSlide[] = [];

  for (let i = 0; i < selectedIndices.length; i += batchSize) {
    const batchIndices = selectedIndices.slice(i, i + batchSize);
    console.log(`🤖 Generating prompts for batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(selectedIndices.length / batchSize)} (Chapters: ${batchIndices.map(idx => idx + 1).join(", ")})...`);

    let chaptersBatchText = "";
    for (const idx of batchIndices) {
      const ch = allChapters[idx];
      chaptersBatchText += `\n\n--- Chapter ${ch.index + 1}: ${ch.title} ---\n\n${ch.text.substring(0, 2000)}`;
    }

    const batchPrompt = `
You are an expert AI prompt engineer and video director.
We are generating Google Labs Flow prompts and English voiceover subtitles for a series of chapters from the novel "${title}".

Here is the consistent character profile of the protagonist:
${profile.characterProfile}

Here is the consistent visual style preset:
${profile.style}

For each of the following chapters, generate exactly 1 slide (Slide Number matching the Chapter Number).
For each slide/chapter, you must generate:
1. "slideNumber": The actual chapter number (e.g. 1 for Chapter 1).
2. "narrationText": A short, highly engaging English voiceover/subtitle line (10-20 words) summarizing the key hook of the chapter. THIS MUST BE WRITTEN IN ENGLISH.
3. "prompt": Describe the key action/event of the chapter. Describe the character pose, background, clothing, hair, and expression. Use a consistent name/descriptor for the protagonist matching the profile.
4. "style": The visual style preset to use (exactly: "${profile.style}").

Here are the chapters to process:
${chaptersBatchText}
`;

    const model = genAI.getGenerativeModel({
      model: "gemini-3.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: batchSchema,
      },
    });

    const result = await model.generateContent(batchPrompt);
    const textResponse = result.response.text();
    if (!textResponse) {
      throw new Error(`Failed to generate storyboard for batch starting at index ${batchIndices[0]}`);
    }

    const batchOutput = JSON.parse(textResponse);
    if (batchOutput.slides && Array.isArray(batchOutput.slides)) {
      allSlides.push(...batchOutput.slides);
    }
  }

  // Sort slides by chapter number
  allSlides.sort((a, b) => a.slideNumber - b.slideNumber);

  // Step 4: Write output file
  console.log("\n--- STEP 4: WRITING FLOW PROMPT SHEET ---");
  
  let outputContent = `Optimized & Corrected Prompts (Ready to Copy-Paste)
Here is your corrected list of prompts with the conflicts resolved and structured for Google Flow:

CHARACTER PROFILE:
${profile.characterProfile}
`;

  allSlides.forEach((slide) => {
    outputContent += `
Slide ${slide.slideNumber} (Chapter ${slide.slideNumber})
Voiceover: "${slide.narrationText}"
Prompt: ${slide.prompt}
Style: ${slide.style}
Subtitle: English
`;
  });

  const rangeStr = chaptersArg ? chaptersArg.replace(/[^a-zA-Z0-9-]/g, "_") : "1-10";
  const outputPath = path.join(outputDir, `${bookId}-flow-prompts-ch${rangeStr}.txt`);
  fs.writeFileSync(outputPath, outputContent, "utf-8");
  
  console.log(`✅ Flow prompts successfully written to: ${outputPath}`);
  
  // Also display them on screen for easy copy-pasting
  console.log("\n" + outputContent);

  return outputPath;
}

async function main() {
  const bookIdStr = getArg("--book") || getArg("-b");
  const chaptersArg = getArg("--chapters") || getArg("-c");

  if (!bookIdStr) {
    console.error("❌ Error: Missing Book ID. Usage: pnpm run generate-flow --book <book_id> [--chapters <range>]");
    console.error("Examples:");
    console.error("  pnpm run generate-flow --book 24 --chapters 1-5");
    console.error("  pnpm run generate-flow --book 24 --chapters all");
    process.exit(1);
  }

  const bookId = parseInt(bookIdStr, 10);
  if (isNaN(bookId)) {
    console.error(`❌ Error: Invalid Book ID "${bookIdStr}". Must be a number.`);
    process.exit(1);
  }

  try {
    await generateFlowPrompts(bookId, chaptersArg);
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
