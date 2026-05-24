import fs from "fs";

export async function generateAndDownloadImage(
  visualDescription: string,
  characterProfile: string,
  stylePreset: string,
  seed: number,
  outputPath: string,
  useFlux: boolean = false
): Promise<string> {
  // Combine visual description, character description, and style preset
  const fullPrompt = `${visualDescription}, protagonist: ${characterProfile}, style: ${stylePreset}`;
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
  throw new Error("Failed to download image after multiple retries.");
}
