import { GoogleGenerativeAI, SchemaType, Schema } from "@google/generative-ai";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Removed __dirname for ESM compatibility
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const geminiKeys: string[] = [];
if (process.env.GEMINI_API_KEY) geminiKeys.push(process.env.GEMINI_API_KEY);
for (let i = 2; i <= 30; i++) {
  const key = process.env[`GEMINI_API_KEY_${i}`];
  if (key) geminiKeys.push(key);
}

if (geminiKeys.length === 0) {
  console.error("❌ Error: GEMINI_API_KEY is not defined in .env.local");
  process.exit(1);
}

export interface ScreenplaySlide {
  slideNumber: number;
  narrationText: string;
  visualDescription: string;
}

export interface Screenplay {
  title: string;
  stylePreset: string;
  characterProfile: string;
  slides: ScreenplaySlide[];
}

const screenplaySchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    title: { type: SchemaType.STRING },
    stylePreset: { type: SchemaType.STRING },
    characterProfile: { type: SchemaType.STRING },
    slides: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          slideNumber: { type: SchemaType.INTEGER },
          narrationText: { type: SchemaType.STRING },
          visualDescription: { type: SchemaType.STRING },
        },
        required: ["slideNumber", "narrationText", "visualDescription"],
      },
    },
  },
  required: ["title", "stylePreset", "characterProfile", "slides"],
};

export async function generateScreenplay(
  bookTitle: string,
  bookAuthor: string,
  bookDesc: string,
  chaptersText: string
): Promise<Screenplay> {
  console.log(`🤖 Initializing screenplay generation for "${bookTitle}"...`);

  const prompt = `
You are an expert book trailer director and screenplay writer.
You are given a selection of chapters from an EPUB novel.
Your task is to analyze these chapters and create an engaging, cinematic 60-second video preview trailer script for the book.

The video trailer should have exactly 10 to 12 slides. Each slide will have:
1. A short, highly engaging voiceover narration line (10-20 words) that builds suspense.
2. A detailed visual scene description.

To ensure character and visual consistency across all slides:
1. Create a "stylePreset": A detailed art style description that should apply to all slides (e.g. "detailed 2D digital anime illustration, web novel cover art, cinematic composition, dramatic lighting, dark fantasy atmosphere").
2. Create a "characterProfile": A detailed description of the protagonist's features, clothes, hair, and expression (e.g. "A 17-year-old boy, messy silver hair, glowing cyan eyes, black leather high-collar jacket, serious expression").

For each slide, write the "visualDescription" describing only the action, pose, and background of that scene (e.g. "standing atop a windy cliff under a red moon, holding a glowing blue sword"). Do NOT repeat the style preset or character profile in the visualDescription, as our program will automatically append them when generating images.

Output the result in the following JSON format:
{
  "title": "Title of the preview",
  "stylePreset": "A detailed art style description.",
  "characterProfile": "A detailed description of the protagonist's features and clothing.",
  "slides": [
    {
      "slideNumber": 1,
      "narrationText": "Voiceover line for this slide (10-20 words).",
      "visualDescription": "Visual action/background scene details for this slide."
    }
  ]
}

Here is the novel info:
Title: ${bookTitle}
Author: ${bookAuthor}
Description: ${bookDesc}

Extracted Chapters Content:
${chaptersText}
`;

  // We iterate through available model list to handle load-balancing/keys availability.
  // This matches the Next.js app model routing priority.
  const modelsToTry = [
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-1.5-flash",
  ];

  let lastError: any = null;

  for (const modelName of modelsToTry) {
    for (let i = 0; i < geminiKeys.length; i++) {
      const currentKey = geminiKeys[i];
      const genAI = new GoogleGenerativeAI(currentKey);
      console.log(`🤖 Attempting script generation with model: ${modelName} (Key #${i + 1})...`);
      
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: screenplaySchema,
          },
        });

        const result = await model.generateContent(prompt);
        const textResponse = result.response.text();
        if (!textResponse) {
          throw new Error("Empty response from Gemini API");
        }

        const screenplay: Screenplay = JSON.parse(textResponse);
        console.log(`✅ Screenplay generated successfully using model: ${modelName}!`);
        console.log(`🎬 Title: "${screenplay.title}"`);
        console.log(`🎨 Style: "${screenplay.stylePreset}"`);
        console.log(`👤 Character: "${screenplay.characterProfile}"`);
        console.log(`📁 Slides Count: ${screenplay.slides.length}`);

        return screenplay;
      } catch (error: any) {
        console.warn(`⚠️ Model "${modelName}" failed with Key #${i + 1}: ${error.message || error}`);
        lastError = error;
        
        const errorStr = (error.message || "").toLowerCase();
        if (error.status === 429 || errorStr.includes('quota') || errorStr.includes('429') || errorStr.includes('rate limit') || errorStr.includes('too many requests')) {
          // It's a quota issue, try the next key with the same model
          continue;
        } else {
          // Model might not be supported, break to next model
          break;
        }
      }
    }
  }

  console.error("❌ All attempted Gemini models and keys failed.");
  throw lastError;
}
