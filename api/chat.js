import { GoogleGenerativeAI } from "@google/generative-ai";
import admin from "firebase-admin";

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  } catch (e) { console.error("Firebase init error"); }
}
const db = admin.firestore();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { message } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) return res.status(500).json({ error: "Chybí klíč" });

  // INICIALIZACE S VYNUCENOU VERZÍ v1 (stabilní)
  const genAI = new GoogleGenerativeAI(apiKey);

  try {
    // POKUS Č. 1: Moderní Flash
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(message);
    const response = await result.response;
    return res.status(200).json({ reply: response.text() });

  } catch (error) {
    console.error("Flash selhal, zkouším Pro verzi...", error.message);

    try {
      // POKUS Č. 2: Stabilní Pro (pokud Flash hází 404)
      const fallbackModel = genAI.getGenerativeModel({ model: "gemini-pro" });
      const result = await fallbackModel.generateContent(message);
      const response = await result.response;
      return res.status(200).json({ reply: response.text() });

    } catch (fallbackError) {
      return res.status(500).json({ 
        error: "Oba modely selhaly", 
        details: fallbackError.message 
      });
    }
  }
}
