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

      // Validate inputs
      if (!file || !userPrompt) {
        return res.status(400).json({
          error: "Both image file and userPrompt are required",
        });
      }

      // Convert image buffer to base64
      const imageBase64 = `data:${file.mimetype};base64,${file.buffer.toString(
        "base64"
      )}`;

      let aiAnalysis = "";

      // STEP 1: Call Google Gemini Vision (with fallback if quota exceeded)
      try {
        // Try gemini-1.5-flash first, fallback to gemini-pro-vision if needed
        let model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // Convert base64 data URL to format Gemini expects
        const base64Data = imageBase64.split(",")[1]; // Remove data:image/jpeg;base64, prefix
        const imagePart = {
          inlineData: {
            data: base64Data,
            mimeType: file.mimetype,
          },
        };

        const prompt =
          "You are an expert interior design assistant. Analyze this image of a room. Respond ONLY with a brief, bulleted list of the key furniture, objects, and materials you see. Be concise.";

        let result;
        try {
          result = await model.generateContent([prompt, imagePart]);
        } catch (modelError: any) {
          // If gemini-1.5-flash fails, try gemini-pro-vision
          if (modelError?.status === 404) {
            console.warn(
              "gemini-1.5-flash not available, trying gemini-pro-vision"
            );
            model = genAI.getGenerativeModel({ model: "gemini-pro-vision" });
            result = await model.generateContent([prompt, imagePart]);
          } else {
            throw modelError;
          }
        }

        const response = await result.response;
        aiAnalysis = response.text() || "No analysis available";
      } catch (geminiError: any) {
        // Handle Gemini quota/rate limit errors gracefully
        if (
          geminiError?.status === 429 ||
          geminiError?.code === 429 ||
          geminiError?.message?.includes("quota")
        ) {
          console.warn(
            "Gemini quota exceeded or rate limited. Proceeding without AI analysis."
          );
          aiAnalysis = "Skipped AI analysis due to quota limits.";
        } else {
          console.error("Gemini Vision error:", geminiError);
          // For other errors, also fallback to no analysis
          aiAnalysis = "AI analysis unavailable.";
        }
      }

      // STEP 2: Create Enhanced Prompt
      let enhancedPrompt: string;
      if (
        aiAnalysis &&
        !aiAnalysis.includes("Skipped") &&
        !aiAnalysis.includes("unavailable")
      ) {
        enhancedPrompt = `
A user wants to redesign their room. Their goal is: "${userPrompt}"

Here is an analysis of the room's current contents:
${aiAnalysis}

Please generate a new image that fulfills the user's goal, organizing and restyling the analyzed contents.
`;
      } else {
        // Fallback: use only user prompt if AI analysis failed
        enhancedPrompt = `Redesign this room according to the following request: "${userPrompt}". Apply the requested changes while maintaining the overall room structure and layout.`;
      }

      // STEP 3: Call Replicate (ControlNet)
      // Using replicate.run() which waits for completion and returns output directly
      const output = await replicate.run(
        "adirik/interior-design:76604baddc85b1b4616e1c6475eca080da339c8875bd4996705440484a6eac38",
        {
          input: {
            image: imageBase64,
            prompt: enhancedPrompt,
          },
        }
      );

      // Get the output URL - replicate.run() returns an object with url() method or a string
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
