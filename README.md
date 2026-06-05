# Ashenara Preview Generator

An independent, automated script utility that generates cinematic book trailer videos for EPUB web novels and uploads them directly to YouTube.

## 🚀 Features

- **EPUB Parser**: Reads local EPUB files or downloads remote assets, extracting relevant narrative chapters to represent the beginning, middle, and end of the book.
- **AI Storyboarding**: Utilizes the Google Gemini API (supporting `gemini-2.5-flash`, `gemini-1.5-flash`, etc.) with structured JSON schema outputs to analyze the story and create voiceover scripts, visual scenes, art styles, and character presets.
- **Neural Voiceovers**: Converts script narration text into spoken audio using Microsoft Edge TTS (realistic neural voices) or ElevenLabs (premium voice api if key provided).
- **Scene Rendering**: Generates widescreen images (16:9) matching the AI-designed storyboard using Pollinations.ai (Flux high-quality or Turbo high-speed models).
- **FFmpeg Compositor**: Compiles slide images, audio voices, and subtitle overlays (centered and bounded in a dark box to avoid shell parsing bugs) into individual MP4 files and merges them using the FFmpeg concat engine.
- **YouTube Auto-Uploader**: Direct integration with the YouTube Data API to upload trailers, using a rotating multi-credential load balancer (supporting up to 3 sets of API keys) to bypass daily API quota exhaustion.
- **API Spam Prevention**: Saves quota-limit exceptions in the database (`site_settings` table) to disable automated cron executions for 12 hours once all credentials are exhausted.
- **Manual Metadata Exporter**: Automatically outputs a `output/<id>-youtube-meta.txt` containing the formatted title, reader link, and tags to allow easy manual copy-pasting for manual video uploads.

---

## 📋 Prerequisites

1. **Node.js**: Version 20.x or higher.
2. **Package Manager**: `pnpm` (recommended) or `npm`.
3. **FFmpeg**: Must be installed and configured on your system environment `PATH` (both `ffmpeg` and `ffprobe`).
   - **Windows**: `winget install FFmpeg`
   - **macOS**: `brew install ffmpeg`
   - **Linux**: `sudo apt install ffmpeg`

---

## ⚙️ Environment Configuration

Create a `.env.local` file in the root directory:

```env
# Cloudflare D1 Database Connection
CLOUDFLARE_ACCOUNT_ID="your-cloudflare-account-id"
CLOUDFLARE_DATABASE_ID="your-cloudflare-database-id"
CLOUDFLARE_API_TOKEN="your-cloudflare-api-token"

# Gemini API Keys (Fallback Rotation)
GEMINI_API_KEY="your-gemini-api-key-1"
GEMINI_API_KEY_2="your-gemini-api-key-2"

# ElevenLabs (Optional - Premium TTS)
ELEVENLABS_API_KEY="your-elevenlabs-api-key"
ELEVENLABS_VOICE_ID="your-voice-id"

# --- SCALING YOUTUBE CREDENTIAL ROTATION (Option A: JSON Array - Recommended for GitHub) ---
# You can pack all your Google Cloud project credentials into a single JSON secret/variable.
# Format: A single line JSON string containing an array of credential objects.
YOUTUBE_CREDS_JSON='[{"clientId":"id1","clientSecret":"sec1","refreshToken":"tok1"},{"clientId":"id2","clientSecret":"sec2","refreshToken":"tok2"}]'

# --- SCALING YOUTUBE CREDENTIAL ROTATION (Option B: Sequential Variables - Recommended for local .env.local) ---
# The rotation system dynamically scans variables from YOUTUBE_CLIENT_ID up to YOUTUBE_CLIENT_ID_30.
# Simply define them sequentially:
YOUTUBE_CLIENT_ID="xxx.apps.googleusercontent.com"
YOUTUBE_CLIENT_SECRET="GOCSPX-xxx"
YOUTUBE_REFRESH_TOKEN="1//xxx"

YOUTUBE_CLIENT_ID_2="xxx.apps.googleusercontent.com"
YOUTUBE_CLIENT_SECRET_2="GOCSPX-xxx"
YOUTUBE_REFRESH_TOKEN_2="1//xxx"

# ... Add YOUTUBE_CLIENT_ID_4 through YOUTUBE_CLIENT_ID_13 (or higher) sequentially here ...
YOUTUBE_CLIENT_ID_13="xxx.apps.googleusercontent.com"
YOUTUBE_CLIENT_SECRET_13="GOCSPX-xxx"
YOUTUBE_REFRESH_TOKEN_13="1//xxx"
```

---

## 🛠️ CLI Usage Commands

### 1. Installation
Install project dependencies:
```bash
pnpm install
```

### 2. Generate YouTube OAuth Refresh Tokens
To fetch OAuth credentials for your YouTube channels, run this local redirect helper server:
```bash
pnpm run get-tokens
```
Open the generated link in your web browser, authorize the application, and the CLI will display the client secrets and refresh token keys. Add them to your `.env.local` or GitHub Repository Secrets.
*(Note: Runs on local port `4567` to avoid conflicts).*

### 3. Generate a Preview Video
Create the trailer video and metadata description file for a specific book ID:
```bash
# Turbo model (High-Speed default)
pnpm run generate --book 12

# Flux model (High-Quality rendering)
pnpm run generate --book 12 --flux
```
- Outputs video to `output/12-preview.mp4`
- Outputs metadata to `output/12-youtube-meta.txt`

### 4. Upload to YouTube manually
Upload an already-generated preview video from the `output/` folder:
```bash
pnpm run upload-youtube --book 12 --privacy public
```

### 5. Run Sharded Batch Jobs
Runs a batch workflow sharded by book ID:
```bash
pnpm run batch-generate --shard 0 --total-shards 2 --limit 1 --privacy public
```
- Reads novels from the DB where `youtubeVideoId` is empty or null.
- Processes sharded books (`book.id % total-shards === shard`).
- Exits early if database site setting indicates a recent YouTube API quota block.
- Deletes intermediate compiled videos after upload to conserve runner storage.

### 6. Database Migrations
Runs the migration queries to update target tables on Cloudflare D1:
```bash
pnpm run run-migration
```

---

## 📁 Directory Structure

```
├── .github/workflows/    # CI/CD GitHub Action configurations
├── assets/               # Fixed assets (e.g., banner.jpeg)
├── output/               # Rendered preview videos and text metadata
├── src/
│   ├── ai.ts             # Gemini integration & structured screenplay schema
│   ├── batch-generate.ts # Cron runner sharding and batch orchestrator
│   ├── db.ts             # LibSQL database connection
│   ├── get-tokens.ts     # YouTube OAuth setup local server
│   ├── images.ts         # Pollinations.ai image generator
│   ├── index.ts          # Compilation orchestrator & manual copy-paste metadata exporter
│   ├── parser.ts         # Local/remote EPUB text extractor
│   ├── run-migration.ts  # Database schema migrator
│   ├── update-db.ts      # Manual youtubeVideoId column updating utility
│   ├── upload-youtube.ts # YouTube uploader, fallback rotation, and quota logger
│   ├── video.ts          # FFmpeg subtitle drawing and video compile engine
│   └── voice.ts          # Edge TTS & ElevenLabs generation falling back
├── package.json
└── tsconfig.json
```

---

## 🔑 How to Create YouTube API Credentials (100% Free)

Since a single Google Cloud project is limited to about **6 uploads/day** (10,000 units quota, 1,600 units per video upload), you need to create multiple projects (e.g. 16 projects total) to upload ~100 videos/day. Follow these steps for each project:

### Step 1: Create a Google Cloud Project
1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Click the project dropdown in the top-left corner and click **New Project**.
3. Name it (e.g., `ashenara-youtube-4`) and click **Create**.

### Step 2: Enable the YouTube Data API v3
1. With your new project selected, open the left sidebar and go to **APIs & Services** > **Library**.
2. Search for `YouTube Data API v3`.
3. Click on it and click **Enable**.

### Step 3: Configure the OAuth Consent Screen
1. Go to **APIs & Services** > **OAuth consent screen**.
2. Select User Type: **External** and click **Create**.
3. Fill in the mandatory fields:
   - **App name**: (e.g., `Ashenara Video Uploader`)
   - **User support email**: (Your Gmail address)
   - **Developer contact information**: (Your Gmail address)
4. Click **Save and Continue**.
5. On the **Scopes** screen, click **Add or Remove Scopes**, check the box for `.../auth/youtube.upload`, and click **Update**. Click **Save and Continue**.
6. On the **Test Users** screen, click **+ Add Users** and type the Gmail address of the YouTube channel account you want to upload to. **This is critical!** If the account is not added as a test user, authorization will fail with an error. Click **Save and Continue** and then **Back to Dashboard**.

### Step 4: Create OAuth 2.0 Credentials
1. Go to **APIs & Services** > **Credentials**.
2. Click **+ Create Credentials** at the top and select **OAuth client ID**.
3. Select Application type: **Web application**.
4. In the **Authorized redirect URIs** section, click **+ Add URI** and paste:
   ```text
   http://localhost:4567/oauth2callback
   ```
5. Click **Create**.
6. Copy the **Client ID** and **Client Secret**.

### Step 5: Generate the Refresh Token
1. Open your local `preview-generator/.env.local` file.
2. Paste the client ID and secret into the next empty sequential slot:
   ```env
   YOUTUBE_CLIENT_ID_4="YOUR_NEW_CLIENT_ID"
   YOUTUBE_CLIENT_SECRET_4="YOUR_NEW_CLIENT_SECRET"
   ```
3. Run the OAuth token helper in your terminal:
   ```bash
   pnpm run get-tokens
   ```
4. Since the script detects that `YOUTUBE_REFRESH_TOKEN_4` is missing, it will output a login link.
5. Copy the link, paste it into your browser, choose the Google account associated with your YouTube channel, bypass the warning ("Google hasn't verified this app" -> click **Advanced** -> **Go to Ashenara Video Uploader (unsafe)**), and click **Continue**.
6. The terminal will capture the redirect and print your `YOUTUBE_REFRESH_TOKEN_4`. Copy and add it to your `.env.local` file.
7. Repeat this workflow for each additional project credentials set!

