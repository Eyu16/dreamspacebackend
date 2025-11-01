import express, { Request, Response } from "express";
import Replicate from "replicate";
import cors from "cors";
import dotenv from "dotenv";
import morgan from "morgan";

// Initialize environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));

// POST route: Start Redesign
app.post("/api/start-redesign", async (req: Request, res: Response) => {
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

  try {
    const { image, prompt } = req.body;

    const prediction = await replicate.predictions.create({
      model:
        "adirik/interior-design:76604baddc85b1b4616e1c6475eca080da339c8875bd4996705440484a6eac38",
      input: {
        image: image,
        prompt: prompt,
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
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

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
