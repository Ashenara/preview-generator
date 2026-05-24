import fs from "fs";
import dotenv from "dotenv";
import path from "path";

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

export async function generateAndDownloadImage(
  visualDescription: string,
  characterProfile: string,
  stylePreset: string,
  seed: number,
  outputPath: string
): Promise<string> {
  const fullPrompt = `${visualDescription}, protagonist: ${characterProfile}, style: ${stylePreset}`;
  return generateAndDownloadPollinations(fullPrompt, seed, outputPath);
}

async function generateAndDownloadPollinations(
  fullPrompt: string,
  seed: number,
  outputPath: string
): Promise<string> {
  const model = "flux";
  console.log(`🎨 Fetching image from Pollinations.ai (Seed: ${seed}, Model: ${model})...`);
  console.log(`   Prompt: "${fullPrompt.substring(0, 120)}..."`);

  // We use the selected model and widescreen 16:9 aspect ratio (1024x576)
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(
    fullPrompt
  )}?width=1024&height=576&seed=${seed}&nologo=true&model=${model}`;

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 40000);
      
      try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Pollinations.ai returned status ${response.status}: ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
        console.log(`✅ Saved generated image to ${outputPath}`);
        return outputPath;
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    } catch (error) {
      console.error(`❌ Attempt ${attempt} failed:`, error);
      if (attempt === maxRetries) throw error;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  throw new Error("Failed to download image from Pollinations.ai after multiple retries.");
}
