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

  // Select endpoint based on presence of POLLINATIONS_API_KEY
  let url: string;
  if (process.env.POLLINATIONS_API_KEY) {
    url = `https://gen.pollinations.ai/image/${encodeURIComponent(
      fullPrompt
    )}?width=1920&height=1080&seed=${seed}&nologo=true&model=${model}`;
  } else {
    // Fall back to legacy unauthenticated endpoint for free users
    url = `https://image.pollinations.ai/prompt/${encodeURIComponent(
      fullPrompt
    )}?width=1920&height=1080&seed=${seed}&nologo=true&model=${model}`;
  }

  const maxRetries = 5;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000);
      
      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://pollinations.ai/",
        "Origin": "https://pollinations.ai/",
      };

      // Support optional Pollinations API Key if provided
      if (process.env.POLLINATIONS_API_KEY) {
        headers["Authorization"] = `Bearer ${process.env.POLLINATIONS_API_KEY.trim()}`;
      }

      try {
        const response = await fetch(url, { 
          signal: controller.signal,
          headers
        });
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
