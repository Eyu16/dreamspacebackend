# DreamSpace Backend Setup Guide

## 1. Install Dependencies

Run these commands in your terminal:

```bash
npm install express replicate cors dotenv

npm install -D typescript ts-node-dev @types/express @types/cors @types/node
```

## 2. Create .env File

Create a `.env` file in the `DreamSpaceBackend` directory and add your API keys:

```env
# Required: Replicate API Token
# Get your token from: https://replicate.com/account/api-tokens
REPLICATE_API_TOKEN=your_replicate_api_token_here

# Optional: Hugging Face Token (not required, but helps with rate limits)
# Get your token from: https://huggingface.co/settings/tokens
HF_TOKEN=your_hugging_face_token_here

# Server Port (optional, defaults to 3001)
PORT=3001
```

## 3. Package.json Script

Make sure your `package.json` has the `dev` script:

```json
{
  "scripts": {
    "dev": "ts-node-dev server.ts"
  }
}
```

## 4. Start the Server

```bash
npm run dev
```

The server will start on `http://localhost:3001`

## API Endpoints

### POST `/api/start-redesign`

Starts the redesign process. Accepts:

- `image`: Base64 encoded image string (with data URI prefix like `data:image/jpeg;base64,...`)
- `userPrompt`: String describing the desired redesign

Returns a Replicate prediction object with `id`, `status`, and other metadata. The client should poll `/api/get-redesign` to check the status.

### GET `/api/get-redesign?id=<prediction_id>`

Gets the status of a prediction. Returns the current prediction object.

## How It Works

1. **Hugging Face Analysis**: The server uses Salesforce's BLIP image captioning model to analyze the room image and generate a description.

2. **Enhanced Prompt Creation**: The user's prompt and the AI analysis are combined to create an enhanced prompt.

3. **Replicate ControlNet**: The enhanced prompt and original image are sent to Black Forest Labs' FLUX Depth Pro ControlNet model to generate the redesigned room.
