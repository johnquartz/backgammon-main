require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');

// Initialize Firebase Admin
admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: "https://betgammon-ba8bc-default-rtdb.europe-west1.firebasedatabase.app"
});

const db = admin.database();

// Initialize bot with your token
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Initialize Express server for WebApp communication
const app = express();
app.use(cors());
app.use(express.json());

// Handle /start command
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const webAppUrl = 'https://johnquartz.github.io/backgammon-main/'; // Update with your actual URL
    
    bot.sendMessage(chatId, 'Welcome to Backgammon Stars!��', {
        reply_markup: {
            inline_keyboard: [[
                { text: 'Play Backgammon', web_app: { url: webAppUrl } }
            ]]
        }
    });
});

// API Endpoints for WebApp
app.post('/checkStars', async (req, res) => {
    const { userId, amount } = req.body;
    
    try {
        // Here you would check user's star balance
        // For now, we'll simulate it
        const userStars = await getUserStars(userId);
        const hasEnough = userStars >= amount;
        
        res.json({ success: true, hasEnough });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.post('/commitStars', async (req, res) => {
    const { userId, amount } = req.body;
    
    try {
        // Lock stars for the game
        await lockUserStars(userId, amount);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.post('/processGameEnd', async (req, res) => {
    const { winnerId, loserId, amount } = req.body;
    
    try {
        // Process star transfer
        await transferStars(winnerId, loserId, amount);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Add this to your existing Express routes
app.get('/firebase-config', (req, res) => {
    // You might want to add authentication here
    res.json({
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.FIREBASE_APP_ID,
        measurementId: process.env.FIREBASE_MEASUREMENT_ID,
        databaseURL: process.env.FIREBASE_DATABASE_URL
    });
});

// Helper functions
async function getUserStars(userId) {
    // In a real implementation, you would get this from Telegram
    // For now, we'll simulate it with Firebase
    const userRef = db.ref(`users/${userId}`);
    const snapshot = await userRef.once('value');
    return snapshot.val()?.stars || 0;
}

async function lockUserStars(userId, amount) {
    // Lock stars in user's balance
    const userRef = db.ref(`users/${userId}`);
    const snapshot = await userRef.once('value');
    const currentStars = snapshot.val()?.stars || 0;
    
    if (currentStars < amount) {
        throw new Error('Insufficient stars');
    }
    
    await userRef.update({
        stars: currentStars - amount,
        lockedStars: (snapshot.val()?.lockedStars || 0) + amount
    });
}

async function transferStars(winnerId, loserId, amount) {
    // Transfer stars from loser to winner
    const batch = db.batch();
    const winnerRef = db.ref(`users/${winnerId}`);
    const loserRef = db.ref(`users/${loserId}`);
    
    // Update balances
    await Promise.all([
        winnerRef.update({
            stars: admin.database.ServerValue.increment(amount * 2),
            lockedStars: admin.database.ServerValue.increment(-amount)
        }),
        loserRef.update({
            lockedStars: admin.database.ServerValue.increment(-amount)
        })
    ]);
}

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 