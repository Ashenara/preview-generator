import { google } from "googleapis";
import http from "http";
import url from "url";
import readline from "readline";
import dotenv from "dotenv";

// Load root environment file if exists
dotenv.config({ path: ".env.local" });

const clientId = process.env.YOUTUBE_CLIENT_ID;
const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

const PORT = 4567;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

async function main() {
  let finalClientId = clientId;
  let finalClientSecret = clientSecret;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query: string): Promise<string> =>
    new Promise((resolve) => rl.question(query, resolve));

  console.log("🔑 YouTube OAuth Token Retrieval Tool\n");

  if (!finalClientId) {
    console.log("   YOUTUBE_CLIENT_ID not found in .env.local.");
    finalClientId = await question("   👉 Enter your Google OAuth Client ID: ");
  }
  if (!finalClientSecret) {
    console.log("   YOUTUBE_CLIENT_SECRET not found in .env.local.");
    finalClientSecret = await question("   👉 Enter your Google OAuth Client Secret: ");
  }

  rl.close();

  finalClientId = finalClientId.trim();
  finalClientSecret = finalClientSecret.trim();

  if (!finalClientId || !finalClientSecret) {
    console.error("❌ Error: Both Client ID and Client Secret are required.");
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(
    finalClientId,
    finalClientSecret,
    REDIRECT_URI
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/youtube.upload"],
    prompt: "consent", // Force Google to return a refresh token
  });

  console.log("\n==================================================");
  console.log("🔗 AUTHORIZATION URL:");
  console.log("==================================================");
  console.log(authUrl);
  console.log("==================================================");
  console.log("\n👉 Please open the link above in your browser, authorize, and you will be redirected.");

  // Spin up temporary HTTP server to capture authorization code
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url && req.url.startsWith("/oauth2callback")) {
        const query = url.parse(req.url, true).query;
        const code = query.code as string;

        if (code) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<h1>Success!</h1><p>You can close this tab now and return to your terminal.</p>");

          console.log("\n⚡ Exchanging code for tokens...");
          const { tokens } = await oauth2Client.getToken(code);

          console.log("\n==================================================");
          console.log("🎉 TOKENS RETRIEVED SUCCESSFULLY!");
          console.log("==================================================");
          console.log(`YOUTUBE_CLIENT_ID=${finalClientId}`);
          console.log(`YOUTUBE_CLIENT_SECRET=${finalClientSecret}`);
          console.log(`YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}`);
          console.log("==================================================");
          console.log("\n💡 Next Steps:");
          console.log("1. Add these 3 values to your GitHub Repository Secrets:");
          console.log("   - YOUTUBE_CLIENT_ID");
          console.log("   - YOUTUBE_CLIENT_SECRET");
          console.log("   - YOUTUBE_REFRESH_TOKEN");
          console.log("2. Add them to your local .env.local file if you want to run uploads locally.");
          console.log("==================================================\n");

          server.close(() => {
            process.exit(0);
          });
        } else {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("OAuth code not found in redirect URL.");
        }
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
      }
    } catch (err: any) {
      console.error("Error exchanging code:", err.message);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`Error: ${err.message}`);
      process.exit(1);
    }
  });

  server.listen(PORT, () => {
    console.log(`\n📡 Waiting for redirect callback on port ${PORT}...`);
  });
}

main().catch((err) => {
  console.error("Fatal Error:", err);
  process.exit(1);
});
