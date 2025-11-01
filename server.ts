import express, { Request, Response } from "express";
import Replicate from "replicate";
import { GoogleGenerativeAI } from "@google/generative-ai";
import cors from "cors";
import dotenv from "dotenv";
import morgan from "morgan";
import multer from "multer";

// Initialize environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize AI clients
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// Extend Request interface for multer file
interface MulterRequest extends Omit<Request, "file"> {
  file?: {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
  };
}

// Valid style options for interior-design-v2
const VALID_STYLES = [
  "coastal_beachy",
  "mid_century_modern",
  "rustic_bohemian",
  "scandinavian_minimalist",
  "industrial_modern",
  "farmhouse_chic",
  "art_deco_glamour",
  "mediterranean_villa",
  "modern_luxury",
  "japanese_zen",
  "victorian_elegant",
  "tropical_modern",
] as const;

// Valid room types (common room types)
const VALID_ROOM_TYPES = [
  "living_room",
  "bedroom",
  "kitchen",
  "dining_room",
  "bathroom",
  "office",
] as const;

// Middleware
app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// POST route: Start Redesign
app.post(
  "/api/start-redesign",
  upload.single("image"),
  async (req: MulterRequest, res: Response) => {
    try {
      const file = req.file;
      const userPrompt = req.body.userPrompt;
      const requestedStyle = req.body.style || "modern_luxury"; // Default style
      const requestedRoomType = req.body.roomType || "living_room"; // Default room type

      // Validate inputs
      if (!file) {
        return res.status(400).json({
          error: "Image file is required",
        });
      }

      // Validate style
      const isValidStyle = VALID_STYLES.includes(requestedStyle as any);
      const style = isValidStyle ? requestedStyle : "modern_luxury"; // Default to valid style if invalid

      if (!isValidStyle) {
        console.warn(
          `Invalid style "${requestedStyle}", defaulting to "modern_luxury"`
        );
      }

      // Validate room_type (use as-is if valid, default if not)
      const isValidRoomType = VALID_ROOM_TYPES.includes(
        requestedRoomType as any
      );
      const roomType = isValidRoomType ? requestedRoomType : "living_room";

      if (!isValidRoomType) {
        console.warn(
          `Invalid room_type "${requestedRoomType}", defaulting to "living_room"`
        );
      }

      // Convert image buffer to base64 data URL
      const imageBase64 = `data:${file.mimetype};base64,${file.buffer.toString(
        "base64"
      )}`;

      // STEP 1: Call Replicate (Interior Design V2)
      // Using replicate.run() which waits for completion and returns output directly
      const output = await replicate.run("adirik/interior-design-v2", {
        input: {
          style: style,
          room_type: roomType,
          room_image: imageBase64, // Replicate accepts base64 data URLs
        },
      });

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
        // Replicate model not found error
        res.status(404).json({
          error:
            "Replicate model not found. The model may have been removed or the version identifier is incorrect.",
          details: error.message || "Model not found on Replicate",
        });
      } else if (error?.status === 422 || error?.response?.status === 422) {
        // Validation error from Replicate
        res.status(422).json({
          error: "Invalid input parameters",
          details:
            error.message ||
            "Input validation failed. Please check style and room_type values.",
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
  }
);

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
