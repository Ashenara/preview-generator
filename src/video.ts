import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Removed __dirname for ESM compatibility

// Helpers for string escaping in FFmpeg drawtext filter
function escapeFFmpegText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\u2019") // Replace straight single quotes with curly quote to prevent FFmpeg syntax break
    .replace(/"/g, "")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");
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

let hasResolvedPath = false;

function resolveFfmpegPath(): void {
  // If ffmpeg is already on the PATH, do nothing
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    return;
  } catch (error) {
    // If not, and we are on Windows, try to load updated PATH
    if (process.platform === "win32") {
      console.log("🔍 ffmpeg not found on current process PATH. Trying to refresh PATH from registry...");
      try {
        const userPath = execSync("powershell -Command \"[Environment]::GetEnvironmentVariable('Path', 'User')\"", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
        const machinePath = execSync("powershell -Command \"[Environment]::GetEnvironmentVariable('Path', 'Machine')\"", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
        const combinedPath = `${userPath};${machinePath};${process.env.PATH}`;
        process.env.PATH = combinedPath;
        
        // Verify again
        execSync("ffmpeg -version", { stdio: "ignore" });
        console.log("✅ Successfully resolved ffmpeg from refreshed PATH!");
        return;
      } catch (pathErr) {
        // Fallback to searching the WinGet Packages directory directly
        try {
          const winGetDir = path.join(process.env.USERPROFILE || "C:/Users/Ashenara", "AppData/Local/Microsoft/WinGet/Packages");
          if (fs.existsSync(winGetDir)) {
            // Recursive search helper
            const findFfmpegBin = (dir: string): string | null => {
              const items = fs.readdirSync(dir, { withFileTypes: true });
              for (const item of items) {
                const fullPath = path.join(dir, item.name);
                if (item.isDirectory()) {
                  const found = findFfmpegBin(fullPath);
                  if (found) return found;
                } else if (item.isFile() && item.name.toLowerCase() === "ffmpeg.exe") {
                  return dir;
                }
              }
              return null;
            };

            const binPath = findFfmpegBin(winGetDir);
            if (binPath) {
              process.env.PATH = `${binPath};${process.env.PATH}`;
              execSync("ffmpeg -version", { stdio: "ignore" });
              console.log(`✅ Successfully resolved ffmpeg in WinGet packages directory: ${binPath}`);
              return;
            }
          }
        } catch {}
      }
    }
  }

  // If we still can't find it
  throw new Error(
    "❌ FFmpeg is not installed or not added to your system PATH.\n" +
    "Please install FFmpeg (e.g., winget install FFmpeg on Windows) and restart your terminal."
  );
}

function ensureFfmpegPath(): void {
  if (hasResolvedPath) return;
  resolveFfmpegPath();
  hasResolvedPath = true;
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

// Retrieves audio duration in seconds using ffprobe CLI
export function getAudioDuration(audioPath: string): number {
  ensureFfmpegPath();
  try {
    const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`;
    const output = execSync(cmd).toString().trim();
    const duration = parseFloat(output);
    if (isNaN(duration)) {
      throw new Error(`Invalid duration output: ${output}`);
    }
    return duration;
  } catch (error: any) {
    console.warn(`⚠️ Warning: Could not get audio duration for ${audioPath} via ffprobe. Defaulting to 5 seconds.`);
    return 5.0;
  }
}

export interface VideoSlideInput {
  imagePath: string;
  audioPath: string;
  subtitles: string;
}

export async function compileVideo(
  slides: VideoSlideInput[],
  outputVideoPath: string,
  tempDir: string
): Promise<string> {
  console.log("🎬 Compiling slides into a preview video...");

  // Verify ffmpeg and ffprobe are available
  ensureFfmpegPath();

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const clipPaths: string[] = [];
  const fontFile = getSystemFontFile();
  const fontOption = fontFile ? `fontfile='${fontFile.replace(/:/g, "\\:")}':` : "";

  // Check if banner exists
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const bannerPath = path.resolve(__dirname, "../assets/banner.jpeg");
  const hasBanner = fs.existsSync(bannerPath);
  if (hasBanner) {
    console.log(`✨ Found banner image at: ${bannerPath}. Adding Intro (2s) and Outro (3s) slides.`);
  }

  // 1. Generate Intro Clip (if banner exists)
  if (hasBanner) {
    const introDuration = 2; // seconds
    const introClipPath = path.join(tempDir, "clip_intro.mp4");
    console.log(`📹 Rendering Intro slide using banner (Duration: ${introDuration}s)...`);
    
    const fps = 25;
    const totalFrames = introDuration * fps;
    const zoomExpression = `1.0+0.05*(in/${totalFrames})`;
    const zoompanFilter = `scale=iw*2:ih*2,zoompan=z='${zoomExpression}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1024x576`;

    const cmd = `ffmpeg -y -loop 1 -i "${bannerPath}" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -map 0:v -map 1:a -vf "${zoompanFilter},format=yuv420p" -c:v libx264 -preset ultrafast -c:a aac -b:a 192k -t ${introDuration} "${introClipPath}"`;
    execSync(cmd, { stdio: "ignore" });
    clipPaths.push(introClipPath);
  }

  // 2. Generate individual MP4 clips for each slide
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const duration = getAudioDuration(slide.audioPath);
    const clipPath = path.join(tempDir, `clip_${i}.mp4`);
    clipPaths.push(clipPath);

    console.log(`📹 Rendering slide ${i + 1}/${slides.length} (Duration: ${duration.toFixed(2)}s)...`);

    // Prepare subtitles: wrap them and save to a temp file to avoid cmd/powershell shell escaping and newline issues
    const wrappedSubtitles = wrapText(slide.subtitles);
    const subtitlePath = path.join(tempDir, `clip_${i}_sub.txt`);
    fs.writeFileSync(subtitlePath, wrappedSubtitles, "utf-8");
    const escapedSubtitlePath = subtitlePath.replace(/\\/g, "/").replace(/:/g, "\\:");

    // Determine frames for zoompan filter
    const fps = 25;
    const totalFrames = Math.ceil(duration * fps);
    const zoomExpression = i % 2 === 0
      ? `1.0+0.12*(in/${totalFrames})`
      : `1.12-0.12*(in/${totalFrames})`;

    // Scale up first to keep zoom smooth, zoom center, and output at 1024x576
    const subtitleFilter = `drawtext=${fontOption}textfile='${escapedSubtitlePath}':x=(w-text_w)/2:y=h-100:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=12:line_spacing=4`;

    const isVideo = slide.imagePath.toLowerCase().endsWith(".mp4") || 
                    slide.imagePath.toLowerCase().endsWith(".mov") || 
                    slide.imagePath.toLowerCase().endsWith(".mkv") || 
                    slide.imagePath.toLowerCase().endsWith(".webm");

    let cmd = "";
    if (isVideo) {
      // For video clips: loop the video, scale to 1024x576, and overlay audio + subtitles
      const scaleFilter = "scale=1024:576,setsar=1";
      cmd = `ffmpeg -y -stream_loop -1 -i "${slide.imagePath}" -i "${slide.audioPath}" -map 0:v -map 1:a -vf "${scaleFilter},${subtitleFilter},format=yuv420p" -c:v libx264 -preset ultrafast -c:a aac -ar 44100 -ac 2 -b:a 192k -t ${duration} "${clipPath}"`;
    } else {
      // For static images: apply zoompan (Ken-Burns) filter
      const fps = 25;
      const totalFrames = Math.ceil(duration * fps);
      const zoomExpression = i % 2 === 0
        ? `1.0+0.12*(in/${totalFrames})`
        : `1.12-0.12*(in/${totalFrames})`;
      const zoompanFilter = `scale=iw*2:ih*2,zoompan=z='${zoomExpression}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1024x576`;
      
      cmd = `ffmpeg -y -loop 1 -i "${slide.imagePath}" -i "${slide.audioPath}" -map 0:v -map 1:a -vf "${zoompanFilter},${subtitleFilter},format=yuv420p" -c:v libx264 -preset ultrafast -c:a aac -ar 44100 -ac 2 -b:a 192k -t ${duration} "${clipPath}"`;
    }
    
    execSync(cmd, { stdio: "ignore" });
  }

  // 3. Generate Outro Clip (if banner exists)
  if (hasBanner) {
    const outroDuration = 3; // seconds
    const outroClipPath = path.join(tempDir, "clip_outro.mp4");
    console.log(`📹 Rendering Outro slide using banner (Duration: ${outroDuration}s)...`);
    
    const fps = 25;
    const totalFrames = outroDuration * fps;
    const zoomExpression = `1.05-0.05*(in/${totalFrames})`;
    const zoompanFilter = `scale=iw*2:ih*2,zoompan=z='${zoomExpression}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1024x576`;

    const cmd = `ffmpeg -y -loop 1 -i "${bannerPath}" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -map 0:v -map 1:a -vf "${zoompanFilter},format=yuv420p" -c:v libx264 -preset ultrafast -c:a aac -b:a 192k -t ${outroDuration} "${outroClipPath}"`;
    execSync(cmd, { stdio: "ignore" });
    clipPaths.push(outroClipPath);
  }

  // 4. Concatenate all generated MP4 clips into a single video file
  console.log("🔗 Merging all slides into the final video file...");
  const concatListPath = path.join(tempDir, "concat_list.txt");
  
  // Create the concat text file with single forward slashes (FFmpeg friendly)
  const concatContent = clipPaths
    .map(p => `file '${p.replace(/\\/g, "/")}'`)
    .join("\n");
    
  fs.writeFileSync(concatListPath, concatContent);

  const finalCmd = `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy "${outputVideoPath}"`;
  execSync(finalCmd, { stdio: "ignore" });

  console.log(`🎉 Video successfully compiled at: ${outputVideoPath}`);
  return outputVideoPath;
}
