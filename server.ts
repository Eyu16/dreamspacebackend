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
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*", // Allow all origins in development, set FRONTEND_URL in production
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));

// Style label mapping for better prompts
const STYLE_LABELS: { [key: string]: string } = {
  coastal_beachy: "Coastal Beachy",
  mid_century_modern: "Mid Century Modern",
  rustic_bohemian: "Rustic Bohemian",
  scandinavian_minimalist: "Scandinavian Minimalist",
  industrial_modern: "Industrial Modern",
  farmhouse_chic: "Farmhouse Chic",
  art_deco_glamour: "Art Deco Glamour",
  mediterranean_villa: "Mediterranean Villa",
  modern_luxury: "Modern Luxury",
  japanese_zen: "Japanese Zen",
  victorian_elegant: "Victorian Elegant",
  tropical_modern: "Tropical Modern",
};

const ROOM_TYPE_LABELS: { [key: string]: string } = {
  living_room: "Living Room",
  bedroom: "Bedroom",
  kitchen: "Kitchen",
  dining_room: "Dining Room",
  bathroom: "Bathroom",
  office: "Office",
};

// POST route: Start Redesign
app.post("/api/start-redesign", async (req: Request, res: Response) => {
  try {
    // Read image (base64 string), userPrompt, style, and roomType from req.body
    const { image, userPrompt, style, roomType } = req.body;

    // Check if image is missing
    if (!image) {
      return res.status(400).json({
        error: "Image is required",
      });
    }

    // Get style and roomType with defaults
    const selectedStyle = style || "modern_luxury";
    const selectedRoomType = roomType || "living_room";
    const styleLabel = STYLE_LABELS[selectedStyle] || "Modern Luxury";
    const roomTypeLabel = ROOM_TYPE_LABELS[selectedRoomType] || "Living Room";

    // Use default prompt if userPrompt is missing or empty
    const finalUserPrompt =
      userPrompt?.trim() ||
      `Apply ${styleLabel} style to this ${roomTypeLabel}`;

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
    // Create a strong prompt combining style and roomType
    let enhancedPrompt = `A ${styleLabel} ${roomTypeLabel}`;

    // If we have user prompt, incorporate it
    if (finalUserPrompt && finalUserPrompt.trim()) {
      enhancedPrompt = `${enhancedPrompt} ${finalUserPrompt}`;
    } else {
      // Default description based on style
      enhancedPrompt = `${enhancedPrompt} with ${styleLabel.toLowerCase()} design elements`;
    }

    // If we have AI analysis, add context about the room
    if (aiAnalysis !== "a room") {
      enhancedPrompt = `${enhancedPrompt}. The room currently contains: ${aiAnalysis}`;
    }

    // Add structure preservation instruction
    enhancedPrompt = `${enhancedPrompt}. Maintain the room's original structure and layout while applying the design changes.`;

    // STEP 3: Call Replicate (Interior Design Model)
    // Use replicate.run() which waits for completion and returns output directly
    const output = await replicate.run(
      "adirik/interior-design:76604baddc85b1b4616e1c6475eca080da339c8875bd4996705440484a6eac38",
      {
        input: {
          image: image,
          prompt: enhancedPrompt,
        },
      }
    );

    // Get the output URL - replicate.run() returns an object with url() method
    let outputUrl: string;
    if (
      typeof output === "object" &&
      output !== null &&
      typeof (output as any).url === "function"
    ) {
      outputUrl = (output as any).url();
    } else if (typeof output === "string") {
      outputUrl = output;
    } else {
      // Fallback: convert to string or use the output as-is
      outputUrl = String(output);
    }

    // Return the image URL directly (no polling needed)
    res.status(201).json({
      success: true,
      output: outputUrl,
      imageUrl: outputUrl,
    });
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

