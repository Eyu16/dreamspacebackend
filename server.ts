import express, { Request, Response } from "express";
import Replicate from "replicate";
import OpenAI from "openai";
import cors from "cors";
import dotenv from "dotenv";
import morgan from "morgan";

// Initialize environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize AI clients
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Middleware
app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));

// POST route: Start Redesign
app.post("/api/start-redesign", async (req: Request, res: Response) => {
  try {
    const { image, userPrompt } = req.body;

    // Validate inputs
    if (!image || !userPrompt) {
      return res
        .status(400)
        .json({ error: "Both image and userPrompt are required" });
    }

    // STEP 1: Call OpenAI Vision
    const visionResponse = await openai.chat.completions.create({
      model: "gpt-4-vision-preview",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "You are an expert interior design assistant. Analyze this image of a room. Respond ONLY with a brief, bulleted list of the key furniture, objects, and materials you see. Be concise.",
            },
            {
              type: "image_url",
              image_url: {
                url: image,
              },
            },
          ],
        },
      ],
      max_tokens: 300,
    });

    const aiAnalysis =
      visionResponse.choices[0].message.content || "No analysis available";

    // STEP 2: Create Enhanced Prompt
    const enhancedPrompt = `
A user wants to redesign their room. Their goal is: "${userPrompt}"

Here is an analysis of the room's current contents:
${aiAnalysis}

Please generate a new image that fulfills the user's goal, organizing and restyling the analyzed contents.
`;

    // STEP 3: Call Replicate (ControlNet)
    const prediction = await replicate.predictions.create({
      model:
        "adirik/interior-design:76604baddc85b1b4616e1c6475eca080da339c8875bd4996705440484a6eac38",
      input: {
        image: image,
        prompt: enhancedPrompt,
      },
    });

    res.status(201).json(prediction);
  } catch (error) {
    console.error("Error starting redesign:", error);
    res.status(500).json({ error: "Failed to start redesign" });
  }
});

// GET route: Get Redesign Status
app.get("/api/get-redesign", async (req: Request, res: Response) => {
  try {
    const { id } = req.query;

    if (!id || typeof id !== "string") {
      return res.status(400).json({ error: "Prediction ID is required" });
    }

    const prediction = await replicate.predictions.get(id);

    res.status(200).json(prediction);
  } catch (error) {
    console.error("Error getting redesign:", error);
    res.status(500).json({ error: "Failed to get redesign status" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
