# i18n Structure Generator & AI Translator

A Node.js CLI tool to automate the creation, synchronization, and AI-powered translation of i18n JSON files—streamlining your localization workflow.

---

## 🚩 The Problem

Manually creating and maintaining multilingual JSON files is tedious, error-prone, and time-consuming. Tasks like:

- Ensuring consistent keys across languages
- Adding new translations
- Removing obsolete keys
- Preserving placeholders and formatting

...are all fraught with manual overhead and potential mistakes.

---

## ✅ The Solution

This CLI automates and enhances your i18n workflow:

- ⚙️ Generate language files with matching structure
- 🔁 Sync changes over time between source and targets
- 🤖 Optionally use **Google Gemini AI** to prefill translations

---

## ✨ Features

- **Two Primary Commands**
  - `generate`: Bootstraps new language files from your source language.
  - `sync`: Keeps all target language files aligned with the source (adds/removes keys, files).
  
- **Structure Preservation**
  - Maintains deeply nested keys and preserves non-string values (`numbers`, `booleans`, `null`).

- **Optional AI Translation (Google Gemini)**
  - **Whole JSON Translation**: Used when generating or adding full files.
  - **Fragment Translation**: Translates only new strings during sync.
  - Supports batching and placeholder validation (e.g. `{{var}}`, `%s`).
  - Uses `responseMimeType: 'application/json'` for structured translation responses.

- **Developer-Friendly**
  - Works via `npx` or a globally installed command.
  - Secure key handling via environment variables.
  - Informative logs for debugging and guidance.

---

## 📦 Prerequisites

- **Node.js** (v18+ recommended)
- **npm**
- (For AI Translation) Google Gemini API Key with billing enabled

---

## 🚀 Installation & Setup

### 1. Install Dependencies

```bash
cd i18n-structure-generator
npm install
```

### 2. Run the Tool


Global Command with `npm link`

```bash
npm link
generate-i18n-structure            # defaults to 'generate'
generate-i18n-structure sync       # to run sync
```

---

## ⚙️ Configuration (`.i18n-generatorrc.json`)

Create this file in your **project root** (not inside the tool folder):

```json
{
  "baseDir": "src/locales",
  "sourceLang": "en",
  "targetLangs": ["fr", "ja", "de", "es"],
  "translation": {
    "enable": true,
    "apiKeyEnvVar": "GEMINI_API_KEY",
    "modelName": "gemini-1.5-flash"
  }
}
```

### Fields

- `baseDir` (string): Directory holding language folders.
- `sourceLang` (string): ISO 639-1 code of source (e.g., `"en"`).
- `targetLangs` (array): Target language codes (e.g., `["fr", "de"]`).
- `translation.enable` (bool): Enable AI translation.
- `translation.apiKeyEnvVar` (string): ENV variable storing Gemini API key.
- `translation.modelName` (string): Model to use (default: `"gemini-1.5-flash"`).

---

## 🔐 Setting the API Key

Create a `.env` file in your project root:

```env
GEMINI_API_KEY=YOUR_ACTUAL_KEY_HERE
```

Or export manually:

- **Linux/macOS**: `export GEMINI_API_KEY="your_key"`
- **Windows CMD**: `set GEMINI_API_KEY=your_key`
- **PowerShell**: `$env:GEMINI_API_KEY="your_key"`

---

## 🧪 Usage Workflow

### 1. Generate (Initial Setup)

```bash
npx .            # or: generate-i18n-structure
```

- Creates structure and files for all target languages.
- Auto-translates full files if translation is enabled.

### 2. Sync (Ongoing Maintenance)

```bash
npx . sync       # or: generate-i18n-structure sync
```

- Compares source to targets:
  - Adds missing keys/files
  - Removes obsolete keys/files
- Translates only new content using batching.

---

## 🌍 Translation Details

- Uses `@google/genai` syntax (ensure installed).
- Requires a valid **Google Gemini API key**.
- Placeholder-aware (e.g., `{{count}}`, `%s`).
- Handles full and partial translations.

---

## ⚠️ Limitations

- **Review AI Translations**: Always proofread for quality and cultural accuracy.
- **API Constraints**: Large files or high concurrency may trigger rate limits or fail.
- **Only JSON Supported**: No YAML or complex plural forms (yet).
- **Doesn't auto-modify your app’s i18n config** – you’ll need to import new files manually.

---

## 🔮 Potential Improvements

- Batching-only translation mode (for better token limit handling)
- Term glossaries for consistency
- Support other LLMs (OpenAI, Anthropic)
- YAML/other format support
- `--dry-run` mode for sync

---

## 🧰 Dependencies

- `@google/genai`
- `inquirer`
- `dotenv`
- `iso-639-1`
- `p-limit`
- `fs-extra`

---

## 📜 License

MIT — use it freely and contribute if you improve it!
