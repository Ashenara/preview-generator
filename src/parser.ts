import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import JSZip from "jszip";
import * as dotenv from "dotenv";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { dbClient } from "./db.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

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

async function resolveFileSource(fileSource: string): Promise<string> {
  if (fileSource.startsWith("/api/storage/")) {
    const parts = fileSource.split("/");
    const bucket = parts[3];
    const key = parts.slice(4).join("/");

    let publicDomain: string | null = null;

    try {
      // 1. Fetch active STORAGE_CONFIG from database site_settings
      let row = await dbClient.execute({
        sql: "SELECT value FROM site_settings WHERE key = 'STORAGE_CONFIG' LIMIT 1",
        args: [],
      });

      if (!row || row.rows.length === 0) {
        row = await dbClient.execute({
          sql: "SELECT value FROM site_config WHERE key = 'STORAGE_CONFIG' LIMIT 1",
          args: [],
        });
      }

      if (row && row.rows.length > 0) {
        const configVal = row.rows[0].value !== undefined ? row.rows[0].value as string : row.rows[0][0] as string;
        if (configVal) {
          const cfg = JSON.parse(configVal);

          const primaryBucket = cfg.bucket || process.env.R2_BUCKET_NAME;
          const primaryDomain = cfg.publicDomain || process.env.R2_PUBLIC_DOMAIN;

          if (bucket === "default" || bucket === primaryBucket) {
            publicDomain = primaryDomain;
          } else if (cfg.buckets && cfg.buckets[bucket]) {
            publicDomain = cfg.buckets[bucket].publicDomain || primaryDomain;
          }
        }
      }
    } catch (err) {
      console.warn("⚠️ Failed to load storage configuration from database:", err);
    }

    // 2. Fallback to environment variables if DB query failed or config was empty
    if (!publicDomain) {
      if (bucket === "ashenara-receipt") {
        publicDomain = process.env.R2_RECEIPT_PUBLIC_DOMAIN || null;
      } else {
        publicDomain = process.env.R2_PUBLIC_DOMAIN || null;
      }
    }

    // 3. If we resolved a domain, return the direct Cloudflare URL
    if (publicDomain) {
      return `${publicDomain.replace(/\/$/, "")}/${key}`;
    }

    // 4. Otherwise, fallback to the Vercel domain proxy
    const siteUrl = (process.env.SITE_URL || process.env.NEXTAUTH_URL || "https://novels.ashenara.com").replace(/\/$/, "");
    return `${siteUrl}${fileSource}`;
  }

  if (fileSource.startsWith("/uploads/")) {
    const siteUrl = (process.env.SITE_URL || process.env.NEXTAUTH_URL || "https://novels.ashenara.com").replace(/\/$/, "");
    return `${siteUrl}${fileSource}`;
  }

  return fileSource;
}

// Helper to download a file from R2 using S3 SDK or standard HTTP fetch fallback
async function fetchFileBuffer(fileSource: string): Promise<Buffer> {
  if (fileSource.startsWith("/api/storage/")) {
    const parts = fileSource.split("/");
    let bucket = parts[3];
    const key = parts.slice(4).join("/");

    // Try to get R2 configuration from database site_settings or site_config
    let cfg: any = null;
    try {
      let row = await dbClient.execute({
        sql: "SELECT value FROM site_settings WHERE key = 'STORAGE_CONFIG' LIMIT 1",
        args: [],
      });
      if (!row || row.rows.length === 0) {
        row = await dbClient.execute({
          sql: "SELECT value FROM site_config WHERE key = 'STORAGE_CONFIG' LIMIT 1",
          args: [],
        });
      }
      if (row && row.rows.length > 0) {
        const configVal = row.rows[0].value !== undefined ? row.rows[0].value as string : row.rows[0][0] as string;
        if (configVal) {
          cfg = JSON.parse(configVal);
        }
      }
    } catch (err) {
      console.warn("⚠️ Failed to load storage configuration from database:", err);
    }

    // Resolve actual bucket name
    const primaryBucket = cfg?.bucket || process.env.R2_BUCKET_NAME;
    let actualBucket = bucket;
    if (bucket === "default") {
      actualBucket = primaryBucket || "default";
    }

    // Resolve R2 S3 API credentials
    const accessKeyId = cfg?.accessKeyId || cfg?.accessKey || cfg?.access_key || cfg?.r2AccessKeyId || process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = cfg?.secretAccessKey || cfg?.secretKey || cfg?.secret_key || cfg?.r2SecretAccessKey || process.env.R2_SECRET_ACCESS_KEY;
    const endpoint = cfg?.endpoint || cfg?.r2Endpoint || (cfg?.accountId ? `https://${cfg.accountId}.r2.cloudflarestorage.com` : undefined) || process.env.R2_ENDPOINT;

    if (accessKeyId && secretAccessKey && endpoint && actualBucket) {
      console.log(`🔒 Authenticating directly with Cloudflare R2 bucket "${actualBucket}" to download: ${key}`);
      try {
        const s3 = new S3Client({
          region: "auto",
          endpoint: endpoint,
          credentials: {
            accessKeyId: accessKeyId,
            secretAccessKey: secretAccessKey,
          },
          forcePathStyle: true,
        });

        const command = new GetObjectCommand({
          Bucket: actualBucket,
          Key: key,
        });

        const response = await s3.send(command);
        if (response.Body) {
          const byteArray = await response.Body.transformToByteArray();
          return Buffer.from(byteArray);
        }
      } catch (s3Err: any) {
        console.warn(`⚠️ Direct R2 S3 download failed, falling back to HTTP fetch: ${s3Err.message || s3Err}`);
      }
    }
  }

  // Fallback to resolving the source URL and doing standard HTTP fetch
  const resolvedSource = await resolveFileSource(fileSource);
  if (resolvedSource.startsWith("http://") || resolvedSource.startsWith("https://")) {
    console.log(`🌐 Downloading remote file: ${resolvedSource}`);
    const response = await fetch(resolvedSource, {
      headers: { "User-Agent": "AshenaraPreviewBot/1.0" }
    });
    if (!response.ok) {
      throw new Error(`Failed to download file from ${resolvedSource}. Status: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } else {
    // Local path
    let localPath = resolvedSource;
    if (resolvedSource.startsWith("/uploads/")) {
      localPath = path.resolve(process.cwd(), "public", resolvedSource.substring(1));
    } else {
      localPath = path.resolve(process.cwd(), resolvedSource);
    }
    console.log(`📂 Reading local file: ${localPath}`);
    if (!fs.existsSync(localPath)) {
      throw new Error(`File not found at: ${localPath}`);
    }
    return fs.readFileSync(localPath);
  }
}

export async function extractEpubText(fileSource: string): Promise<string> {
  const buffer = await fetchFileBuffer(fileSource);

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
    let cleanText = cleanHtml(html);
    if (cleanText.length > 20000) {
      cleanText = cleanText.substring(0, 20000) + "\n... [Chapter content truncated to save tokens] ...";
    }
    
    fullText += `\n\n--- CHAPTER ${index + 1} ---\n\n${cleanText}`;
  }

  return fullText.trim();
}

export interface EpubChapter {
  index: number; // 0-based index
  title: string;
  text: string;
}

export async function extractAllEpubChapters(fileSource: string): Promise<EpubChapter[]> {
  const buffer = await fetchFileBuffer(fileSource);

  const zip = await JSZip.loadAsync(buffer);
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

  let opfContent = await zip.file(opfPath)?.async("string");
  if (!opfContent) {
    throw new Error(`Invalid EPUB: OPF file not found at ${opfPath}`);
  }

  opfContent = opfContent.replace(/<(\/)?(?:[a-zA-Z0-9_-]+:)/g, '<$1');

  const manifestItems: Record<string, string> = {};
  const itemTags = opfContent.match(/<item\s+[^>]+>/g) || [];
  for (const tag of itemTags) {
    const idMatch = tag.match(/id\s*=\s*["']([^"']+)["']/i);
    const hrefMatch = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (idMatch && hrefMatch) {
      manifestItems[idMatch[1]] = hrefMatch[1];
    }
  }

  const spine: string[] = [];
  const itemrefTags = opfContent.match(/<itemref\s+[^>]+>/g) || [];
  for (const tag of itemrefTags) {
    const idrefMatch = tag.match(/idref\s*=\s*["']([^"']+)["']/i);
    if (idrefMatch && manifestItems[idrefMatch[1]]) {
      spine.push(manifestItems[idrefMatch[1]]);
    }
  }

  console.log(`📚 Total chapters found in spine: ${spine.length}`);

  const chapters: EpubChapter[] = [];
  for (let idx = 0; idx < spine.length; idx++) {
    const href = spine[idx];
    const relativePath = decodeURIComponent(href);
    const fullZipPath = opfDir === "." || opfDir === "" ? relativePath : path.posix.join(opfDir, relativePath);
    
    const file = zip.file(fullZipPath);
    if (!file) {
      continue;
    }

    const html = await file.async("string");
    
    // Try to extract chapter title from <h1>, <h2> or <title>
    let title = `Chapter ${idx + 1}`;
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const h2Match = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (h1Match) {
      title = h1Match[1].replace(/<[^>]+>/g, "").trim();
    } else if (h2Match) {
      title = h2Match[1].replace(/<[^>]+>/g, "").trim();
    } else if (titleMatch) {
      title = titleMatch[1].replace(/<[^>]+>/g, "").trim();
    }
    title = title.replace(/\s+/g, " ").trim();

    const cleanText = cleanHtml(html);
    chapters.push({
      index: idx,
      title,
      text: cleanText,
    });
  }

  return chapters;
}

