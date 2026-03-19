import admin from "firebase-admin";

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
  if (req.method !== "POST") return res.status(405).json({ error: "Jen POST." });

  const { message } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!message || !apiKey) return res.status(400).json({ error: "Chybí data." });

  // --- TADY JE TEN POŘÁDNÝ PROMPT A LIMITACE ---
  const systemPrompt = `Jsi oficiální asistent projektu Learning Triangle. 
  TVOJE PRAVIDLA:
  1. Odpovídej VŽDY česky, stručně a s emojis.
  2. Nabízíme doučování (MAT, ČJ, AJ, příprava na CERMAT).
  3. Pokud se někdo ptá na věci mimo doučování, slušně ho vrať k tématu.
  4. Kontakt: info@learningtriangle.cz.
  5. LIMITACE: Odpověď nesmí být delší než 3 věty. Buď věcný a profesionální.`;

  try {
    // Logování uživatele do Firebase
    await db.collection("chatLogs").add({
      sender: "user",
      message: message,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});

    // TVOJE FUNKČNÍ VOLÁNÍ (Direct Fetch)
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
            maxOutputTokens: 150, // Tohle je hard limit pro délku odpovědi
          },
        }),
      }
    );

    const data = await response.json();
    const aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Zkus to prosím znovu.";

    // Logování bota do Firebase
    await db.collection("chatLogs").add({
      sender: "bot",
      message: aiReply,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});

    return res.status(200).json({ reply: aiReply });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
