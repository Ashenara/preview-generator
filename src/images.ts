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
  outputPath: string,
  useFlux: boolean = false,
  usePollinations: boolean = false
): Promise<string> {
  // Combine visual description, character description, and style preset
  const fullPrompt = `${visualDescription}, protagonist: ${characterProfile}, style: ${stylePreset}`;
  
  if (usePollinations) {
    return generateAndDownloadPollinations(fullPrompt, seed, outputPath, useFlux);
  }
  
  const token = process.env.HF_TOKEN || process.env.HF_ACCESS_TOKEN;
  if (!token) {
    console.warn("⚠️ HF_TOKEN not found in .env.local. Falling back to Pollinations.ai...");
    return generateAndDownloadPollinations(fullPrompt, seed, outputPath, useFlux);
  }
  try {
    return await generateAndDownloadHuggingFace(fullPrompt, token, outputPath);
  } catch (error: any) {
    console.warn(`⚠️ Hugging Face image generation failed: ${error.message || error}. Falling back to Pollinations.ai...`);
    return generateAndDownloadPollinations(fullPrompt, seed, outputPath, useFlux);
  }
}

async function generateAndDownloadPollinations(
  fullPrompt: string,
  seed: number,
  outputPath: string,
  useFlux: boolean
): Promise<string> {
  const model = useFlux ? "flux" : "turbo";
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

async function generateAndDownloadHuggingFace(
  fullPrompt: string,
  token: string,
  outputPath: string
): Promise<string> {
  const modelId = "black-forest-labs/FLUX.1-schnell";
  console.log(`🎨 Fetching image from Hugging Face Serverless API (${modelId})...`);
  console.log(`   Prompt: "${fullPrompt.substring(0, 120)}..."`);

  const url = `https://router.huggingface.co/hf-inference/models/${modelId}`;

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 40000);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            inputs: fullPrompt,
            parameters: {
              width: 1024,
              height: 576,
            },
            options: {
              wait_for_model: true,
            }
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Hugging Face API returned status ${response.status}: ${errorText}`);
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
  throw new Error("Failed to download image from Hugging Face after multiple retries.");
}
