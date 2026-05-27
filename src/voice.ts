import fs from "fs";
import path from "path";
import { EdgeTTS } from "@andresaya/edge-tts";

// Generates voiceover file for a slide and returns the local file path
export async function generateVoiceover(
  text: string,
  outputPath: string
): Promise<string> {
  const maxRetries = 3;
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;

      if (elevenLabsApiKey) {
        console.log(`🎙️ Generating premium voiceover with ElevenLabs (Attempt ${attempt})...`);
        try {
          // Default to "Rachel" voice (pre-made voice ID: 21m00Tcm4TlvDq8ikWAM)
          const voiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
          const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "xi-api-key": elevenLabsApiKey,
              "Content-Type": "application/json",
              accept: "audio/mpeg",
            },
            body: JSON.stringify({
              text: text,
              model_id: "eleven_monolingual_v1",
              voice_settings: {
                stability: 0.75,
                similarity_boost: 0.75,
              },
            }),
          });

          if (!response.ok) {
            throw new Error(`ElevenLabs error: ${response.status} ${response.statusText}`);
          }

          const arrayBuffer = await response.arrayBuffer();
          fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
          console.log(`✅ Saved ElevenLabs audio to ${outputPath}`);
          return outputPath;
        } catch (error) {
          console.warn("⚠️ ElevenLabs voiceover failed, falling back to Edge TTS:", error);
        }
      }

      // Fallback to high-quality Microsoft Edge TTS (Realistic Neural Male Voice)
      console.log(`🎙️ Generating Edge TTS voiceover (Attempt ${attempt})...`);
      const tts = new EdgeTTS();
      const voice = process.env.EDGE_VOICE || "en-US-GuyNeural"; // Deep male voice
      const rate = process.env.EDGE_RATE || "+15%"; // Slightly faster
      const pitch = process.env.EDGE_PITCH || "-5Hz"; // Slightly deeper

      await tts.synthesize(text, voice, {
        rate,
        pitch,
      });

      // edge-tts library's toFile automatically appends .mp3 extension
      let targetPathForEdge = outputPath;
      if (outputPath.endsWith(".mp3")) {
        targetPathForEdge = outputPath.slice(0, -4);
      }

      await tts.toFile(targetPathForEdge);
      console.log(`✅ Saved Edge TTS audio to ${outputPath}`);
      return outputPath;
    } catch (error: any) {
      console.error(`❌ Voiceover generation attempt ${attempt} failed: ${error.message || error}`);
      lastError = error;
      if (attempt < maxRetries) {
        const delay = 2000 * Math.pow(2, attempt - 1);
        console.log(`⏳ Waiting ${delay / 1000} seconds before retrying...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`All ${maxRetries} voiceover attempts failed. Last error: ${lastError?.message || lastError}`);
}
