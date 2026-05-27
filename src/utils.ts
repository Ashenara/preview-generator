import fs from "fs";

/**
 * Parse a CLI flag value from process.argv.
 * e.g. getArg("--book") returns "42" for `--book 42`
 */
export function getArg(flag: string, alias?: string): string | null {
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

/**
 * Derive a URL-safe slug from a book title.
 */
export function generateBookSlug(id: number, title?: string | null): string {
  if (!title) return "novel";
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

/**
 * Check whether an error looks like a YouTube quota / rate-limit error.
 */
export function isQuotaError(error: any): boolean {
  const errMsg = (error.message || "").toLowerCase();
  if (errMsg.includes("quota") || errMsg.includes("limit") || errMsg.includes("rate limit")) {
    return true;
  }
  if (error.response?.data?.error) {
    const apiErr = error.response.data.error;
    const apiMsg = (apiErr.message || "").toLowerCase();
    if (apiMsg.includes("quota") || apiMsg.includes("limit") || apiMsg.includes("rate limit")) {
      return true;
    }
    if (apiErr.errors && Array.isArray(apiErr.errors)) {
      for (const ent of apiErr.errors) {
        const reason = (ent.reason || "").toLowerCase();
        const msg = (ent.message || "").toLowerCase();
        if (
          reason.includes("quota") || reason.includes("limit") ||
          msg.includes("quota") || msg.includes("limit")
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Wrap text to a maximum number of characters per line for subtitle overlay.
 */
export function wrapText(text: string, maxCharsPerLine = 50): string {
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

/**
 * Find the first available system font file for the current platform.
 * Returns null if no known font is found.
 */
export function getSystemFontFile(): string | null {
  if (process.platform === "win32") {
    const winFonts = [
      "C:/Windows/Fonts/arial.ttf",
      "C:/Windows/Fonts/msyh.ttc",
      "C:/Windows/Fonts/segoeui.ttf",
    ];
    for (const font of winFonts) {
      if (fs.existsSync(font)) return font;
    }
  } else if (process.platform === "darwin") {
    const macFonts = [
      "/Library/Fonts/Arial.ttf",
      "/System/Library/Fonts/Helvetica.ttc",
      "/Library/Fonts/Microsoft/Arial.ttf",
    ];
    for (const font of macFonts) {
      if (fs.existsSync(font)) return font;
    }
  } else {
    const linuxFonts = [
      "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
      "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
      "/usr/share/fonts/fonts-dejavu/DejaVuSans.ttf",
    ];
    for (const font of linuxFonts) {
      if (fs.existsSync(font)) return font;
    }
  }
  return null;
}
