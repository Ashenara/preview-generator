import fs from "fs";
import JSZip from "jszip";

async function main() {
  const url = "https://assets.ashenara.com/9815e70ff935f599-Release-That-Witch.epub";
  console.log(`Downloading ${url}...`);
  const response = await fetch(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  const zip = await JSZip.loadAsync(buffer);
  
  const containerXml = await zip.file("META-INF/container.xml")?.async("string");
  console.log("Container XML:\n", containerXml);
  
  const fullPathMatch = containerXml?.match(/full-path\s*=\s*["']([^"']+)["']/i);
  if (!fullPathMatch) {
    throw new Error("No full path found");
  }
  const opfPath = fullPathMatch[1];
  console.log("OPF Path:", opfPath);
  
  let opfContent = await zip.file(opfPath)?.async("string");
  if (!opfContent) {
    throw new Error("No OPF content found");
  }
  console.log("OPF Content (first 2000 chars):\n", opfContent.substring(0, 2000));
  
  // Strip namespace prefixes from tags (e.g., <opf:spine> -> <spine>, </opf:itemref> -> </itemref>)
  opfContent = opfContent.replace(/<(\/)?(?:[a-zA-Z0-9_-]+:)/g, '<$1');

  console.log("\nSearching for itemref tags...");
  const itemrefTags = opfContent.match(/<itemref\s+[^>]+>/g) || [];
  console.log(`Found ${itemrefTags.length} itemref tags.`);
  if (itemrefTags.length > 0) {
    console.log("Sample itemref tags:", itemrefTags.slice(0, 10));
  } else {
    // Let's print the entire spine block
    const spineMatch = opfContent.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i);
    if (spineMatch) {
      console.log("Spine Block:\n", spineMatch[0]);
    } else {
      console.log("No spine block found!");
    }
  }
}

main().catch(console.error);
