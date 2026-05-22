import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import JSZip from "jszip";

// Removed __dirname for ESM compatibility

// Helper to strip HTML tags and normalize whitespace
function cleanHtml(html: string): string {
  // Strip script/style tags completely
  let text = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");
  // Replace br/p/div with newlines to preserve spacing
  text = text.replace(/<(br|p|div|h[1-6])[^>]*>/gi, "\n");
  // Strip all other HTML tags
  text = text.replace(/<[^>]+>/g, "");
  // Decode common HTML entities
  text = text.replace(/&ldquo;|&rdquo;/g, '"')
             .replace(/&lsquo;|&rsquo;/g, "'")
             .replace(/&hellip;/g, "...")
             .replace(/&nbsp;/g, " ")
             .replace(/&amp;/g, "&")
             .replace(/&lt;/g, "<")
             .replace(/&gt;/g, ">")
             .replace(/&#39;/g, "'")
             .replace(/&quot;/g, '"');
  // Normalize multiple spaces/newlines
  text = text.replace(/\n\s*\n+/g, "\n\n");
  return text.trim();
}

export async function extractEpubText(fileSource: string): Promise<string> {
  let buffer: Buffer;

  if (fileSource.startsWith("http://") || fileSource.startsWith("https://")) {
    console.log(`🌐 Downloading remote EPUB: ${fileSource}`);
    const response = await fetch(fileSource);
    if (!response.ok) {
      throw new Error(`Failed to download EPUB from ${fileSource}. Status: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } else {
    // Local path
    let localPath = fileSource;
    if (fileSource.startsWith("/uploads/")) {
      localPath = path.resolve(process.cwd(), "../public", fileSource.substring(1));
    } else {
      localPath = path.resolve(process.cwd(), "../", fileSource);
    }
    console.log(`📂 Reading local EPUB: ${localPath}`);
    if (!fs.existsSync(localPath)) {
      throw new Error(`EPUB file not found at: ${localPath}`);
    }
    buffer = fs.readFileSync(localPath);
  }

  // Load zip content
  const zip = await JSZip.loadAsync(buffer);
  
  // 1. Locate container.xml to find the opf path
  const containerXml = await zip.file("META-INF/container.xml")?.async("string");
  if (!containerXml) {
    throw new Error("Invalid EPUB: META-INF/container.xml is missing");
  }

  const fullPathMatch = containerXml.match(/full-path\s*=\s*["']([^"']+)["']/i);
  if (!fullPathMatch) {
    throw new Error("Invalid EPUB: full-path attribute missing in container.xml");
  }
  const opfPath = fullPathMatch[1];
  const opfDir = path.dirname(opfPath);

  // 2. Read OPF file
  let opfContent = await zip.file(opfPath)?.async("string");
  if (!opfContent) {
    throw new Error(`Invalid EPUB: OPF file not found at ${opfPath}`);
  }

  // Normalize namespace prefixes on tags (e.g. <opf:spine> -> <spine>, </opf:metadata> -> </metadata>)
  opfContent = opfContent.replace(/<(\/)?(?:[a-zA-Z0-9_-]+:)/g, '<$1');

  // 3. Parse manifest items robustly
  const manifestItems: Record<string, string> = {};
  const itemTags = opfContent.match(/<item\s+[^>]+>/g) || [];
  
  for (const tag of itemTags) {
    const idMatch = tag.match(/id\s*=\s*["']([^"']+)["']/i);
    const hrefMatch = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (idMatch && hrefMatch) {
      manifestItems[idMatch[1]] = hrefMatch[1];
    }
  }

  // 4. Parse spine items order robustly
  const spine: string[] = [];
  const itemrefTags = opfContent.match(/<itemref\s+[^>]+>/g) || [];
  
  for (const tag of itemrefTags) {
    const idrefMatch = tag.match(/idref\s*=\s*["']([^"']+)["']/i);
    if (idrefMatch) {
      const idref = idrefMatch[1];
      if (manifestItems[idref]) {
        spine.push(manifestItems[idref]);
      }
    }
  }

  if (spine.length === 0) {
    throw new Error("Invalid EPUB: No spine items found in OPF");
  }

  console.log(`📚 Total chapters/sections found: ${spine.length}`);

  // 5. Select designated 30 chapters (first 10, middle 10, last 10)
  const selectedChapters: { index: number; href: string }[] = [];
  
  if (spine.length <= 30) {
    spine.forEach((href, idx) => selectedChapters.push({ index: idx, href }));
  } else {
    // First 10
    for (let i = 0; i < 10; i++) {
      selectedChapters.push({ index: i, href: spine[i] });
    }
    // Middle 10
    const mid = Math.floor(spine.length / 2);
    for (let i = mid - 5; i <= mid + 4; i++) {
      if (!selectedChapters.some(c => c.index === i)) {
        selectedChapters.push({ index: i, href: spine[i] });
      }
    }
    // Last 10
    for (let i = spine.length - 10; i < spine.length; i++) {
      if (!selectedChapters.some(c => c.index === i)) {
        selectedChapters.push({ index: i, href: spine[i] });
      }
    }
  }

  selectedChapters.sort((a, b) => a.index - b.index);

  // 6. Read and clean text for each selected chapter
  let fullText = "";
  for (const { index, href } of selectedChapters) {
    const relativePath = decodeURIComponent(href);
    const fullZipPath = opfDir === "." || opfDir === "" ? relativePath : path.posix.join(opfDir, relativePath);
    
    const file = zip.file(fullZipPath);
    if (!file) {
      console.warn(`⚠️ Warning: Chapter file not found in zip: ${fullZipPath}`);
      continue;
    }

    const html = await file.async("string");
    const cleanText = cleanHtml(html);
    
    fullText += `\n\n--- CHAPTER ${index + 1} ---\n\n${cleanText}`;
  }

  return fullText.trim();
}
