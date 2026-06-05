import fs from "fs";
import path from "path";
import { generateScreenplay, Screenplay } from "./ai.js";
import { extractEpubText } from "./parser.js";

// Helper to parse arguments
function getArg(flag: string, alias?: string): string | null {
  let index = process.argv.indexOf(flag);
  if (index !== -1 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  if (alias) {
    index = process.argv.indexOf(alias);
    if (index !== -1 && process.argv[index + 1]) {
      return process.argv[index + 1];
    }
  }
  return null;
}

// Generate slug for output filename
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

function formatMarkdown(screenplay: Screenplay): string {
  let md = `# Screenplay: ${screenplay.title}\n\n`;
  md += `## 🎨 Visual Style Preset\n`;
  md += `> ${screenplay.stylePreset}\n\n`;
  md += `## 👤 Character Profile\n`;
  md += `> ${screenplay.characterProfile}\n\n`;
  md += `## 🎬 Storyboard Slides\n\n`;

  for (const slide of screenplay.slides) {
    md += `### Slide ${slide.slideNumber}\n`;
    md += `* **Voiceover / Narration:** "${slide.narrationText}"\n`;
    md += `* **Visual Description:** ${slide.visualDescription}\n\n`;
  }
  return md;
}

function formatPlainText(screenplay: Screenplay): string {
  let txt = `==================================================\n`;
  txt += `SCREENPLAY: ${screenplay.title.toUpperCase()}\n`;
  txt += `==================================================\n\n`;
  txt += `VISUAL STYLE PRESET:\n`;
  txt += `${screenplay.stylePreset}\n\n`;
  txt += `CHARACTER PROFILE:\n`;
  txt += `${screenplay.characterProfile}\n\n`;
  txt += `--------------------------------------------------\n`;
  txt += `STORYBOARD SLIDES\n`;
  txt += `--------------------------------------------------\n\n`;

  for (const slide of screenplay.slides) {
    txt += `[SLIDE ${slide.slideNumber}]\n`;
    txt += `NARRATION:  "${slide.narrationText}"\n`;
    txt += `VISUALS:    ${slide.visualDescription}\n\n`;
  }
  txt += `==================================================\n`;
  return txt;
}

async function main() {
  const bookIdStr = getArg("--book", "-b");
  const epubPath = getArg("--epub", "-e");
  const textPath = getArg("--text", "-t");

  const customTitle = getArg("--title");
  const customAuthor = getArg("--author");
  const customDesc = getArg("--desc");
  const outPathArg = getArg("--out", "-o");

  // Verify that at least one source is provided
  if (!bookIdStr && !epubPath && !textPath) {
    console.error("❌ Error: Missing input source.");
    console.error("Usage:");
    console.error("  pnpm run generate-screenplay --book <id>               Generate screenplay from database book ID");
    console.error("  pnpm run generate-screenplay --epub <path-to-epub>    Generate screenplay from a local EPUB file");
    console.error("  pnpm run generate-screenplay --text <path-to-text>    Generate screenplay from a local text file");
    console.error("\nOptional flags:");
    console.error("  --title <title>       Override or provide book title");
    console.error("  --author <author>     Override or provide book author");
    console.error("  --desc <description>  Override or provide book description");
    console.error("  --out <path>          Specify custom output JSON file path");
    process.exit(1);
  }

  let title = customTitle || "";
  let author = customAuthor || "Unknown Author";
  let description = customDesc || "";
  let chaptersText = "";
  let defaultOutputFilename = "";

  let dbClient: any = null;

  try {
    if (bookIdStr) {
      const bookId = parseInt(bookIdStr, 10);
      if (isNaN(bookId)) {
        throw new Error(`Invalid Book ID "${bookIdStr}". Must be a number.`);
      }

      console.log(`\n🔍 Fetching book metadata for ID: ${bookId} from Cloudflare D1...`);
      // Import dbClient dynamically so we only connect to D1 if we are actually using it
      const dbModule = await import("./db.js");
      dbClient = dbModule.dbClient;

      const queryResult = await dbClient.execute({
        sql: "SELECT id, title, author, description, fileUrl FROM books WHERE id = ?",
        args: [bookId],
      });

      if (queryResult.rows.length === 0) {
        throw new Error(`No book found in the database with ID ${bookId}`);
      }

      const book = queryResult.rows[0];
      title = customTitle || (book.title as string) || `Book ${bookId}`;
      author = customAuthor || (book.author as string) || author;
      description = customDesc || (book.description as string) || description;
      const fileUrl = book.fileUrl as string;

      if (!fileUrl) {
        throw new Error(`Book "${title}" does not have an EPUB file associated (fileUrl is null).`);
      }

      console.log(`📖 DB Book: "${title}" by ${author}`);
      console.log(`🔗 File URL: ${fileUrl}`);

      console.log("📥 Extracting chapters...");
      chaptersText = await extractEpubText(fileUrl);
      defaultOutputFilename = `book-${bookId}-screenplay.md`;

    } else if (epubPath) {
      console.log(`\n📖 Parsing local EPUB: ${epubPath}`);
      chaptersText = await extractEpubText(epubPath);

      if (!title) {
        // Fallback title from file name
        const baseName = path.basename(epubPath, path.extname(epubPath));
        title = baseName.replace(/[-_]+/g, ' ');
      }
      defaultOutputFilename = `${generateSlug(title)}-screenplay.md`;

    } else if (textPath) {
      console.log(`\n📖 Reading local text file: ${textPath}`);
      if (!fs.existsSync(textPath)) {
        throw new Error(`Text file not found at: ${textPath}`);
      }
      chaptersText = fs.readFileSync(textPath, "utf-8");

      if (!title) {
        const baseName = path.basename(textPath, path.extname(textPath));
        title = baseName.replace(/[-_]+/g, ' ');
      }
      defaultOutputFilename = `${generateSlug(title)}-screenplay.md`;
    }

    if (!chaptersText || chaptersText.trim().length === 0) {
      throw new Error("No text content could be extracted or read from the source.");
    }

    console.log(`✅ Text prepared. Length: ${chaptersText.length} characters.`);
    console.log(`\n--- GENERATING SCREENPLAY WITH GEMINI ---`);
    console.log(`Title: "${title}"`);
    console.log(`Author: "${author}"`);
    console.log(`Description: "${description.substring(0, 100)}${description.length > 100 ? '...' : ''}"`);

    const screenplay = await generateScreenplay(title, author, description, chaptersText);

    // Resolve output path
    const outputDir = path.resolve(process.cwd(), "output");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const finalOutPath = outPathArg
      ? path.resolve(process.cwd(), outPathArg)
      : path.join(outputDir, defaultOutputFilename);

    const ext = path.extname(finalOutPath).toLowerCase();
    let contentToWrite = "";
    let formatName = "JSON";

    if (ext === ".md") {
      contentToWrite = formatMarkdown(screenplay);
      formatName = "Markdown";
    } else if (ext === ".txt") {
      contentToWrite = formatPlainText(screenplay);
      formatName = "Plain Text";
    } else {
      contentToWrite = JSON.stringify(screenplay, null, 2);
    }

    fs.writeFileSync(finalOutPath, contentToWrite, "utf-8");

    console.log("\n==================================================");
    console.log("🎉 SUCCESS!");
    console.log("==================================================");
    console.log(`🎬 Screenplay generated successfully.`);
    console.log(`💾 ${formatName} file saved to: ${finalOutPath}`);
    console.log(`👤 Character Profile: ${screenplay.characterProfile}`);
    console.log(`🎨 Style Preset: ${screenplay.stylePreset}`);
    console.log(`📁 Slides Count: ${screenplay.slides.length}`);
    console.log("==================================================\n");

  } catch (error: any) {
    console.error(`\n❌ Failed to generate screenplay:`, error.message || error);
    process.exit(1);
  } finally {
    if (dbClient) {
      dbClient.close();
    }
  }
}

main().catch((err) => {
  console.error("Fatal Error:", err);
  process.exit(1);
});
