import admin from "firebase-admin";
import fs from "fs";
import path from "path";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

const db = admin.firestore();

const systemPrompt = "Jsi přátelský AI asistent pro Learning Triangle. Odpovídej česky, stručně, max 3 věty.";


const rateLimitMap = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 20;

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, []);
  }

  const timestamps = rateLimitMap.get(ip).filter(t => now - t < windowMs);
  timestamps.push(now);
  rateLimitMap.set(ip, timestamps);

  return timestamps.length > maxRequests;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Metoda není povolena" });

  const { message } = req.body;
  if (!message)
    return res.status(400).json({ error: "Zpráva je prázdná" });

  const ip = req.headers["x-forwarded-for"] || "unknown";

  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Příliš mnoho zpráv, zkus to za chvíli." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey)
    return res.status(500).json({ error: "Chyba konfigurace serveru - chybí API klíč" });

  try {
    await db.collection("chatLogs").add({
      sender: "user",
      message: message,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ip: ip,
    });
  } catch (logError) {
    console.error("Failed to log user message:", logError.message);
  }

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: message }],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1000,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", errorText);
      return res.status(500).json({
        error: "Gemini API odmítlo požadavek",
        details: errorText,
      });
    }

    const data = await response.json();
    const aiReply =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Omlouvám se, ale nevím, co odpovědět.";

    try {
      await db.collection("chatLogs").add({
        sender: "bot",
        message: aiReply,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (logError) {
      console.error("Failed to log bot reply:", logError.message);
    }

    return res.status(200).json({ reply: aiReply });

  } catch (error) {
    console.error("=== CHAT ERROR DETAILS ===");
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);

    return res.status(500).json({
      error: "Něco se pokazilo na serveru.",
      details: error.message,
    });
  }
}
