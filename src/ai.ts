import { GoogleGenerativeAI, SchemaType, Schema } from "@google/generative-ai";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Removed __dirname for ESM compatibility
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const isLocal = !process.env.GITHUB_ACTIONS;
const apiKey = (isLocal && process.env.GEMINI_API_KEY_2) || process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_2;
if (!apiKey) {
  console.error("❌ Error: GEMINI_API_KEY or GEMINI_API_KEY_2 is not defined in .env.local");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

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
Your task is to analyze these chapters and create an engaging, highly cinematic 60-second video preview trailer script for the book.

The video trailer should have exactly 10 to 12 slides. To create a professional, engaging trailer that is not boring or repetitive, you MUST structure the storyboard into a clear narrative arc across the slides:

1. Hook & Setting (Slides 1-2): Set the atmosphere, introduce the conflict, or show a secondary character or key environment. The main protagonist must NOT appear yet (describe the setting, other characters, or a dramatic event).
2. Protagonist Reveal (Slides 3-4): Show the protagonist, their unique situation (e.g., system interface screen, regression, special power, or status), and their immediate goal or reaction.
3. Side Characters / Allies (Slides 5-6): Show interactions, dialogue, or close-ups with secondary characters (allies, family, love interest, or mentors) to add depth.
4. The Rival / Antagonist (Slides 7-8): Show the antagonist, rival plotting, or a rising threat to introduce tension.
5. Climax / Action (Slides 9-10): Show active conflict, spell clashes, or high-speed movement (gravity chains flaring, sword clashes, volcanic storms) showing both parties or the epic scale.
6. Cliffhanger (Slides 11-12): A close-up shot of the protagonist looking directly at the viewer with an eager smirk or glowing eyes, posing a suspenseful question.

To ensure character and visual consistency across all slides:
1. Create a "stylePreset": A detailed art style description that should apply to all slides (e.g., "detailed 2D digital anime illustration, web novel cover art, cinematic composition, dramatic lighting, dark fantasy atmosphere").
2. Create a "characterProfile": A detailed description of the protagonist's features, clothes, hair, and expression (e.g., "A 17-year-old boy, messy silver hair, glowing cyan eyes, black leather high-collar jacket, serious expression").

For each slide:
- Write "narrationText": Voiceover line for this slide (10-20 words). Write like a movie trailer voiceover (punchy, short, dramatic sentences).
- Write "visualDescription": Describe the action, pose, and background of that scene (e.g., "standing atop a windy cliff under a red moon, holding a glowing blue sword"). Do NOT repeat the style preset or character profile in the visualDescription.
- Ensure at least 3-4 slides do NOT contain the protagonist (e.g., they focus on side characters, rivals, or landscapes).

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
    "gemini-3-flash",
    "gemini-2.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash-lite",
  ];

  let lastError: any = null;

  for (const modelName of modelsToTry) {
    console.log(`🤖 Attempting script generation with model: ${modelName}...`);
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
      console.warn(`⚠️ Model "${modelName}" failed: ${error.message || error}`);
      lastError = error;
    }
  }

  console.error("❌ All attempted Gemini models failed.");
  throw lastError;
}
