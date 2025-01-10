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
const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Initialize bot without polling
const bot = new TelegramBot(process.env.BOT_TOKEN, {
    webHook: {
        port: PORT
    }
});

// Set webhook
const url = 'https://betgammon.onrender.com';
bot.setWebHook(`${url}/webhook/${process.env.BOT_TOKEN}`);

// Handle star transactions
async function createStarTransaction(userId, amount) {
    try {
        const result = await bot.sendInvoice(
            userId,
            "Backgammon Bet",
            `Bet ${amount} Stars`,
            `bet_${Date.now()}`,
            "",
            "XTR",
            [{
                label: "Bet",
                amount: amount
            }]
        );
        return result;
    } catch (error) {
        console.error('Error details:', error);
        throw error;
    }
}

// Webhook endpoint
app.post(`/webhook/${process.env.BOT_TOKEN}`, (req, res) => {
    bot.handleUpdate(req.body);
    res.sendStatus(200);
});

// Bot commands
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const webAppUrl = 'https://johnquartz.github.io/backgammon-main/';
    
    bot.sendMessage(chatId, 'Welcome to Backgammon Stars! 🎲\nBet and win Telegram Stars!', {
        reply_markup: {
            inline_keyboard: [[
                { text: 'Play Backgammon', web_app: { url: webAppUrl } }
            ]]
        }
    });
});

// Handle pre-checkout query
bot.on('pre_checkout_query', async (query) => {
    try {
        await bot.answerPreCheckoutQuery(query.id, true);
    } catch (error) {
        console.error('Pre-checkout error:', error);
        await bot.answerPreCheckoutQuery(query.id, false, 'Payment failed, please try again.');
    }
});

// Handle successful payment
bot.on('successful_payment', async (msg) => {
    try {
        const userId = msg.from.id;
        const amount = msg.successful_payment.total_amount;
        const chargeId = msg.successful_payment.telegram_payment_charge_id;

        const matchingRef = db.ref(`matching/${amount}/${userId}`);
        await matchingRef.set({
            id: userId,
            timestamp: admin.database.ServerValue.TIMESTAMP,
            chargeId: chargeId
        });

        await bot.sendMessage(msg.chat.id, `Successfully placed bet of ${amount} Stars! Looking for opponent...`);
    } catch (error) {
        console.error('Error handling successful payment:', error);
        await bot.sendMessage(msg.chat.id, 'Error processing payment. Please try again.');
    }
});

// API Endpoints for WebApp
app.post('/create-bet', async (req, res) => {
    const { userId, amount } = req.body;
    
    try {
        const invoice = await createStarTransaction(userId, amount);
        res.json({ success: true, invoice });
    } catch (error) {
        console.error('Error creating bet:', error);
        res.json({ success: false, error: error.message });
    }
});

// Only start the Express server, don't create another server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}).on('error', (err) => {
    console.error('Server error:', err);
    process.exit(1);
}); 