import express, { Request, Response } from "express";
import Replicate from "replicate";
import cors from "cors";
import dotenv from "dotenv";

// Initialize environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Replicate client
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

// Hugging Face API configuration
const HF_API_URL =
  "https://api-inference.huggingface.co/models/Salesforce/blip-image-captioning-large";
const HF_TOKEN = process.env.HF_TOKEN;

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// POST route: Start Redesign
app.post("/api/start-redesign", async (req: Request, res: Response) => {
  try {
    // Read image (base64 string) and userPrompt from req.body
    const { image, userPrompt } = req.body;

    // Check if image is missing
    if (!image) {
      return res.status(400).json({
        error: "Image is required",
      });
    }

    // Use default prompt if userPrompt is missing or empty
    const finalUserPrompt =
      userPrompt?.trim() ||
      "Redesign this room with a modern aesthetic while maintaining its structure.";

    // STEP 1: Call Hugging Face API (with fallback if it fails)
    let aiAnalysis = "a room"; // Default fallback

    try {
      // Strip the data URI prefix
      const base64Image = image.split(";base64,").pop();

      if (!base64Image) {
        console.warn("Invalid image format, skipping HF analysis");
      } else {
        // Call the Hugging Face API
        const hfResponse = await fetch(HF_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(HF_TOKEN && { Authorization: `Bearer ${HF_TOKEN}` }),
          },
          body: JSON.stringify({ inputs: base64Image }),
        });

        // Check if HF API call succeeded
        if (hfResponse.ok) {
          // Get the JSON result
          const hfResult = (await hfResponse.json()) as any;

          // Extract the caption - handle different response formats
          if (Array.isArray(hfResult) && hfResult[0]?.generated_text) {
            aiAnalysis = hfResult[0].generated_text;
          } else if (hfResult?.generated_text) {
            aiAnalysis = hfResult.generated_text;
          } else if (typeof hfResult === "string") {
            aiAnalysis = hfResult;
          } else if (Array.isArray(hfResult) && hfResult[0]) {
            aiAnalysis = hfResult[0];
          }

          console.log("HF Analysis successful:", aiAnalysis);
        } else {
          // HF API failed, but we continue with fallback
          const errorText = await hfResponse.text();
          console.warn(
            `Hugging Face API error (${hfResponse.status}): ${errorText}. Continuing with fallback.`
          );

          // If 401 or 403, suggest checking token
          if (hfResponse.status === 401 || hfResponse.status === 403) {
            console.warn(
              "Hugging Face authentication failed. Check your HF_TOKEN in .env file or use without token (slower)."
            );
          }
        }
      }
    } catch (hfError: any) {
      // Log error but continue without analysis
      console.warn("Hugging Face API call failed:", hfError.message);
      console.warn("Continuing without image analysis...");
    }

    // STEP 2: Create Enhanced Prompt
    // If we have analysis, use it; otherwise just use the user prompt
    const enhancedPrompt =
      aiAnalysis !== "a room"
        ? `A user wants to redesign their room. Their goal is: "${finalUserPrompt}". The room currently contains: "${aiAnalysis}". Generate a new image that fulfills the user's goal, organizing and restyling the room.`
        : `A user wants to redesign their room according to the following request: "${finalUserPrompt}". Generate a new image that fulfills the user's goal, maintaining the room structure while applying the requested changes.`;

    // STEP 3: Call Replicate (ControlNet Depth Model)
    // Use predictions.create() to create a prediction (async processing)
    const prediction = await replicate.predictions.create({
      model: "black-forest-labs/flux-depth-pro",
      version:
        "b67d5fc4baa734e9fb5f970e2d116f07f8967dc7b4168256f1c400eaf5cff014",
      input: {
        prompt: enhancedPrompt,
        control_image: image,
        controlnet_conditioning_scale: 1.0,
        guidance: 7,
      },
    });

    // Return the prediction object (client will poll for status)
    res.status(201).json(prediction);
  } catch (error: any) {
    console.error("Error starting redesign:", error);

    // Provide more specific error messages
    if (
      error?.status === 429 ||
      error?.code === "insufficient_quota" ||
      error?.code === 429
    ) {
      res.status(429).json({
        error: "API quota exceeded. Please check your API billing and quota.",
        details: error.message,
      });
    } else if (error?.status === 404 || error?.response?.status === 404) {
      res.status(404).json({
        error:
          "Model not found. The model may have been removed or the version identifier is incorrect.",
        details: error.message || "Model not found on Replicate",
      });
    } else if (error?.status === 422 || error?.response?.status === 422) {
      res.status(422).json({
        error: "Invalid input parameters",
        details: error.message || "Input validation failed.",
      });
    } else if (error?.status === 400 || error?.response?.status === 400) {
      res.status(400).json({
        error: "Invalid request parameters",
        details: error.message,
      });
    } else {
      res.status(500).json({
        error: "Failed to start redesign",
        details: error.message || "Unknown error occurred",
      });
    }
  }
});

// GET route: Get Redesign Status
app.get("/api/get-redesign", async (req: Request, res: Response) => {
  try {
    // Get the prediction id from req.query
    const { id } = req.query;

    if (!id || typeof id !== "string") {
      return res.status(400).json({ error: "Prediction ID is required" });
    }

    // Call replicate.predictions.get(id)
    const prediction = await replicate.predictions.get(id as string);

    // Return the prediction object as JSON
    res.status(200).json(prediction);
  } catch (error: any) {
    console.error("Error getting redesign:", error);
    res.status(500).json({
      error: "Failed to get redesign status",
      details: error.message || "Unknown error occurred",
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});

