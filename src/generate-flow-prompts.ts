import fs from "fs";
import path from "path";
import { GoogleGenerativeAI, SchemaType, Schema } from "@google/generative-ai";
import * as dotenv from "dotenv";
import { dbClient } from "./db.js";
import { extractEpubText } from "./parser.js";

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
  prompt: string;
  style: string;
}

interface FlowScreenplay {
  slides: FlowSlide[];
}

const flowSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    slides: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          slideNumber: { type: SchemaType.INTEGER },
          prompt: { type: SchemaType.STRING },
          style: { type: SchemaType.STRING },
        },
        required: ["slideNumber", "prompt", "style"],
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
  
  const outputDir = path.resolve(process.cwd(), "output");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // Step 1: Parse EPUB text
  console.log("\n--- STEP 1: PARSING EPUB ---");
  const chaptersText = await extractEpubText(fileUrl);
  console.log(`✅ Text successfully extracted from EPUB. Length: ${chaptersText.length} characters.`);

  // Step 2: Call Gemini to write Flow Screenplay
  console.log("\n--- STEP 2: GENERATING STORYBOARD WITH GEMINI ---");
  
  const prompt = `
You are an expert AI prompt engineer and video director.
Your task is to analyze the chapters of the novel and generate optimized prompts for Google Labs Flow video generation.
The video should consist of 10 to 12 slides representing the story's progression.

For each slide, you must generate:
1. A "prompt": Describe the action, character pose, background, clothing, hair, and expression. Use a consistent name or descriptor for the protagonist (e.g. "Main_Girl" if the protagonist is female, "Main_Boy" or the actual name like "Jiang Yuan" if male). Integrate details like: "Main_Girl has a confident and feisty expression" or "Jiang Yuan is dressed in elegant silk robes matching his new status." Ensure the protagonist description remains consistent across slides, but updates to fit the scene (e.g. changing wardrobe to fit a modern setting or winter setting).
2. A "style": The detailed art style description (e.g., "Detailed 2D digital anime illustration, web novel cover art style, cinematic composition, dramatic lighting, vibrant colors with rich historical details, ancient Chinese background").

Output the result in the following JSON format:
{
  "slides": [
    {
      "slideNumber": 1,
      "prompt": "Description of the scene and characters...",
      "style": "Detailed art style preset..."
    }
  ]
}

Here is the novel info:
Title: ${title}
Author: ${author}
Description: ${description}

Extracted Chapters Content:
${chaptersText}
`;

  const modelsToTry = [
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-1.5-flash",
  ];

  let flowScreenplay: FlowScreenplay | null = null;
  let lastError: any = null;

  for (const modelName of modelsToTry) {
    console.log(`🤖 Attempting prompt generation with model: ${modelName}...`);
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: flowSchema,
        },
      });

      const result = await model.generateContent(prompt);
      const textResponse = result.response.text();
      if (!textResponse) {
        throw new Error("Empty response from Gemini API");
      }

      flowScreenplay = JSON.parse(textResponse);
      console.log(`✅ Screenplay generated successfully using model: ${modelName}!`);
      break;
    } catch (error: any) {
      console.warn(`⚠️ Model "${modelName}" failed: ${error.message || error}`);
      lastError = error;
    }
  }

  if (!flowScreenplay) {
    console.error("❌ All attempted Gemini models failed.");
    throw lastError;
  }

  // Step 3: Format prompts for Google Labs Flow matching user format
  console.log("\n--- STEP 3: FORMATTING PROMPTS FOR GOOGLE LABS FLOW ---");
  
  let outputContent = `Optimized & Corrected Prompts (Ready to Copy-Paste)
Here is your corrected list of prompts with the conflicts resolved and structured for Google Flow:
`;

  flowScreenplay.slides.forEach((slide) => {
    outputContent += `
Slide ${slide.slideNumber}
Prompt: ${slide.prompt}
Style: ${slide.style}
`;
  });

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
