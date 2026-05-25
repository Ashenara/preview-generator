import { dbClient } from "../src/db.ts";
import JSZip from "jszip";
import path from "path";
import fs from "fs";

async function main() {
  const queryResult = await dbClient.execute({
    sql: "SELECT fileUrl FROM books WHERE id = 24",
    args: []
  });
  const fileUrl = queryResult.rows[0].fileUrl as string;
  console.log("File URL:", fileUrl);
  
  let buffer: Buffer;
  if (fileUrl.startsWith("http://") || fileUrl.startsWith("https://")) {
    const response = await fetch(fileUrl);
    buffer = Buffer.from(await response.arrayBuffer());
  } else {
    buffer = fs.readFileSync(path.resolve(process.cwd(), fileUrl));
  }
  
  const zip = await JSZip.loadAsync(buffer);
  const containerXml = await zip.file("META-INF/container.xml")?.async("string");
  const fullPathMatch = containerXml?.match(/full-path\s*=\s*["']([^"']+)["']/i);
  const opfPath = fullPathMatch![1];
  let opfContent = await zip.file(opfPath)?.async("string");
  opfContent = opfContent!.replace(/<(\/)?(?:[a-zA-Z0-9_-]+:)/g, '<$1');
  
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
  
  console.log("Total chapters/sections in spine:", spine.length);
  dbClient.close();
}

main().catch(console.error);
