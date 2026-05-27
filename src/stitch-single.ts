import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { getAudioDuration } from "./video.js";
import { generateVoiceover } from "./voice.js";

// Helper to parse arguments
function getArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index !== -1 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return null;
}

// Simple text wrapping for subtitle overlay
function wrapText(text: string, maxCharsPerLine = 45): string {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if ((currentLine + " " + word).trim().length > maxCharsPerLine) {
      lines.push(currentLine.trim());
      currentLine = word;
    } else {
      currentLine = (currentLine + " " + word).trim();
    }
  }
  if (currentLine) {
    lines.push(currentLine.trim());
  }
  return lines.join("\n");
}

function getSystemFontFile(): string | null {
  if (process.platform === "win32") {
    const winFonts = [
      "C:/Windows/Fonts/arial.ttf",
      "C:/Windows/Fonts/msyh.ttc",
      "C:/Windows/Fonts/segoeui.ttf",
    ];
    for (const font of winFonts) {
      if (fs.existsSync(font)) {
        return font;
      }
    }
  } else if (process.platform === "darwin") {
    const macFonts = [
      "/Library/Fonts/Arial.ttf",
      "/System/Library/Fonts/Helvetica.ttc",
      "/Library/Fonts/Microsoft/Arial.ttf",
    ];
    for (const font of macFonts) {
      if (fs.existsSync(font)) {
        return font;
      }
    }
  } else {
    const linuxFonts = [
      "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
      "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
      "/usr/share/fonts/fonts-dejavu/DejaVuSans.ttf",
    ];
    for (const font of linuxFonts) {
      if (fs.existsSync(font)) {
        return font;
      }
    }
  }
  return null;
}

async function main() {
  const videoInput = getArg("--video") || getArg("-v");
  const imageInput = getArg("--image") || getArg("-i");
  let audioInput = getArg("--audio") || getArg("-a");
  const textInput = getArg("--text") || getArg("-t");
  const outputInput = getArg("--output") || getArg("-o") || "output/stitched.mp4";

  if (!videoInput && !imageInput) {
    console.error("❌ Error: You must specify either --video (-v) or --image (-i) input.");
    console.error("Usage: pnpm run stitch-single -v <video_path> -t <subtitle_text> -o <output_path>");
    process.exit(1);
  }

  const mediaPath = videoInput ? path.resolve(videoInput) : path.resolve(imageInput!);
  if (!fs.existsSync(mediaPath)) {
    console.error(`❌ Error: Input media file does not exist at: ${mediaPath}`);
    process.exit(1);
  }

  // Create temporary directory for operations
  const tempDir = path.resolve(process.cwd(), "temp", "stitch-single");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  let finalAudioPath = "";
  if (audioInput) {
    finalAudioPath = path.resolve(audioInput);
    if (!fs.existsSync(finalAudioPath)) {
      console.error(`❌ Error: Specified audio file does not exist at: ${finalAudioPath}`);
      process.exit(1);
    }
  } else if (textInput) {
    console.log("🎤 Generating voiceover for the text...");
    const genAudioPath = path.join(tempDir, `temp_voice_${Date.now()}.mp3`);
    await generateVoiceover(textInput, genAudioPath);
    finalAudioPath = genAudioPath;
  } else {
    console.error("❌ Error: You must specify either an audio file (--audio / -a) or subtitle text (--text / -t) to generate audio.");
    process.exit(1);
  }

  const duration = getAudioDuration(finalAudioPath);
  console.log(`⏱️ Audio duration: ${duration.toFixed(2)}s`);

  // Ensure output directory exists
  const outputPath = path.resolve(outputInput);
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const fontFile = getSystemFontFile();
  const fontOption = fontFile ? `fontfile='${fontFile.replace(/:/g, "\\:")}':` : "";

  // Handle Subtitle text file creation to prevent shell escaping issues
  const subtitles = textInput || "";
  const wrappedSubtitles = wrapText(subtitles);
  const subtitlePath = path.join(tempDir, `temp_sub_${Date.now()}.txt`);
  fs.writeFileSync(subtitlePath, wrappedSubtitles, "utf-8");
  const escapedSubtitlePath = subtitlePath.replace(/\\/g, "/").replace(/:/g, "\\:");

  const subtitleFilter = `drawtext=${fontOption}textfile='${escapedSubtitlePath}':x=(w-text_w)/2:y=h-125:fontsize=30:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=12:line_spacing=4`;

  console.log("🎬 Compiling video clip...");

  let cmd = "";
  if (videoInput) {
    // For video inputs
    const scaleFilter = "scale=1280:720,setsar=1";
    cmd = `ffmpeg -y -stream_loop -1 -i "${mediaPath}" -i "${finalAudioPath}" -map 0:v -map 1:a -vf "${scaleFilter},${subtitleFilter},format=yuv420p" -c:v libx264 -preset ultrafast -c:a aac -ar 44100 -ac 2 -b:a 192k -t ${duration} "${outputPath}"`;
  } else {
    // For image inputs
    const fps = 25;
    const totalFrames = Math.ceil(duration * fps);
    const zoomExpression = `1.0+0.12*(in/${totalFrames})`;
    const zoompanFilter = `scale=iw*2:ih*2,zoompan=z='${zoomExpression}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1280x720`;
    cmd = `ffmpeg -y -loop 1 -i "${mediaPath}" -i "${finalAudioPath}" -map 0:v -map 1:a -vf "${zoompanFilter},${subtitleFilter},format=yuv420p" -c:v libx264 -preset ultrafast -c:a aac -ar 44100 -ac 2 -b:a 192k -t ${duration} "${outputPath}"`;
  }

  console.log(`Running FFmpeg command...`);
  try {
    execSync(cmd, { stdio: "inherit" });
    console.log(`\n🎉 Success! Stitched video output created at: ${outputPath}`);
  } catch (err: any) {
    console.error("❌ FFmpeg compilation failed:", err.message || err);
    process.exit(1);
  } finally {
    // Clean up subtitle file
    try {
      if (fs.existsSync(subtitlePath)) fs.unlinkSync(subtitlePath);
    } catch {}
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
