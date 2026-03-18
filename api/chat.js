import admin from "firebase-admin";

// Inicializace Firebase Admin
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

  const apiKey = process.env.GEMINI_API_KEY;

  console.log("=== CHAT DEBUG ===");
  console.log("Message received:", message);
  console.log("Gemini API Key exists:", !!apiKey);
  console.log("Gemini API Key length:", apiKey?.length);

  if (!apiKey)
    return res
      .status(500)
      .json({ error: "Chyba konfigurace serveru - chybí API klíč" });

  // LOG user message
  try {
    await db.collection("chatLogs").add({
      sender: "user",
      message: message,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.headers["x-forwarded-for"] || "unknown",
    });
  } catch (logError) {
    console.error("Failed to log user message:", logError.message);
  }

  const systemPrompt = `Jsi přátelský AI asistent pro Learning Triangle.
Nabízíme doučování: matematiku, češtinu, angličtinu a další předměty.
Připravujeme na CERMAT. Kontakt: info@learningtriangle.cz.
Odpovídej stručně (max 3 věty), česky a s emojis.`;

  try {
    console.log("Calling Gemini API...");

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent",
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

    console.log("Gemini response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", errorText);
      return res.status(500).json({
        error: "Gemini API odmítlo požadavek",
        details: errorText,
      });
    }

    const data = await response.json();
    console.log("Gemini response received");

    const aiReply =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Omlouvám se, ale nevím, co odpovědět.";

    // LOG bot reply
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
