import admin from 'firebase-admin';

// Inicializace Firebase Admin (jen jednou)
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
        }),
        databaseURL: process.env.FIREBASE_DATABASE_URL
    });
}

const db = admin.database();

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { action } = req.body || req.query;

    try {
        // ========== ČTENÍ RECENZÍ (index.html) ==========
        if (req.method === 'GET' && action === 'get-reviews') {
            const snapshot = await db.ref('reviews').orderByChild('timestamp').once('value');
            const data = snapshot.val();

            if (!data) return res.json({ reviews: [] });

            const reviews = Object.entries(data)
                .map(([id, review]) => ({ id, ...review }))
                .filter(r => r.approved === true)
                .reverse();

            return res.json({ reviews });
        }

        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Metoda není povolena' });
        }

        // ========== PŘIDAT RECENZI (writereview.html) ==========
        if (action === 'add-review') {
            const { name, email, rating, text } = req.body;

            if (!name || !rating || !text) {
                return res.status(400).json({ error: 'Chybí povinná pole' });
            }

            if (text.length < 10 || text.length > 500) {
                return res.status(400).json({ error: 'Recenze musí být 10-500 znaků' });
            }

            const reviewData = {
                name,
                rating: parseInt(rating),
                text,
                email: email || null,
                timestamp: admin.database.ServerValue.TIMESTAMP,
                approved: parseInt(rating) >= 4,
                pending: parseInt(rating) < 4
            };

            const newRef = db.ref('reviews').push();
            await newRef.set(reviewData);

            return res.json({
                success: true,
                autoApproved: parseInt(rating) >= 4
            });
        }

        // ========== HLEDÁM DOUČOVÁNÍ (hledamdoucovani.html) ==========
        if (action === 'contact') {
            const { name, email, phone, city, message } = req.body;

            if (!name || !email || !phone || !city) {
                return res.status(400).json({ error: 'Chybí povinná pole' });
            }

            const formData = {
                name, email, phone, city,
                message: message || '',
                timestamp: admin.database.ServerValue.TIMESTAMP,
                date: new Date().toLocaleString('cs-CZ'),
                status: 'new'
            };

            const newRef = db.ref('hledam-doucovani').push();
            await newRef.set(formData);

            return res.json({ success: true });
        }

        // ========== CHCI DOUČOVAT (chcidoucovat.html) ==========
        if (action === 'tutor-apply') {
            const { name, email, phone, birthdate, message } = req.body;

            if (!name || !email || !phone || !birthdate || !message) {
                return res.status(400).json({ error: 'Chybí povinná pole' });
            }

            const formData = {
                name, email, phone, birthdate, message,
                timestamp: admin.database.ServerValue.TIMESTAMP,
                date: new Date().toLocaleString('cs-CZ'),
                status: 'new'
            };

            const newRef = db.ref('chci-doucovat').push();
            await newRef.set(formData);

            return res.json({ success: true });
        }

        return res.status(400).json({ error: 'Neznámá akce' });

    } catch (error) {
        console.error('Firebase API error:', error);
        return res.status(500).json({ error: 'Chyba serveru' });
    }
}