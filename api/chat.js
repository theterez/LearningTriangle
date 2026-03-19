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
  } catch (e) { console.error("Firebase fail"); }
}
const db = admin.firestore();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { message } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!message || !apiKey) return res.status(400).json({ error: "Chybí message nebo API key" });

  // DEFINICE PRAVIDEL (Vložíme je přímo do kontextu zprávy)
  const systemPrompt = `Instrukce pro AI: Jsi asistent Learning Triangle. 
  Nabízíme doučování: MAT, ČJ, AJ a přípravu na CERMAT. 
  Odpovídej česky, stručně (max 3 věty) a s emojis. 
  Kontakt: info@learningtriangle.cz.`;

  try {
    // Logování uživatele
    db.collection("chatLogs").add({
      sender: "user",
      message: message,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});

    // VOLÁNÍ PŘES TVŮJ FUNKČNÍ FETCH
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { 
                  // Tady spojíme pravidla a otázku do jednoho balíku
                  text: `${systemPrompt}\n\nOtázka uživatele: ${message}` 
                }
              ],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 300, // Zvětšeno, aby bot nedořekl jen "Nabízíme"
          },
        }),
      }
    );

    const data = await response.json();
    const aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Zkus to prosím znovu za chvilku.";

    // Logování bota
    db.collection("chatLogs").add({
      sender: "bot",
      message: aiReply,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});

    return res.status(200).json({ reply: aiReply });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
