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

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Pollinations.ai returned status ${response.status}: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
    console.log(`✅ Saved generated image to ${outputPath}`);
    return outputPath;
  } catch (error) {
    console.error("❌ Error downloading image from Pollinations.ai:", error);
    throw error;
  }
}
