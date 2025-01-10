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
let botInstance = null;

function initBot() {
    if (botInstance) {
        return botInstance;
    }

    botInstance = new TelegramBot(process.env.BOT_TOKEN, { 
        polling: true,
        webHook: {
            port: process.env.PORT
        }
    });

    return botInstance;
}

const bot = initBot();
const app = express();

app.use(cors());
app.use(express.json());

// Handle star transactions
async function createStarTransaction(userId, amount) {
    try {
        const result = await bot.sendInvoice(
            userId,                     // chat_id
            "Backgammon Bet",          // title (1-32 characters)
            `Bet ${amount} Stars`,      // description
            `bet_${Date.now()}`,       // payload
            "",                        // provider_token (empty for Stars)
            "XTR",                     // currency
            [{                         // prices array
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
        console.log('Received pre-checkout query:', query);
        // Always approve for now - you might want to add validation later
        await bot.answerPreCheckoutQuery(query.id, true);
    } catch (error) {
        console.error('Pre-checkout error:', error);
        await bot.answerPreCheckoutQuery(query.id, false, 'Payment failed, please try again.');
    }
});

// Handle successful payment
bot.on('successful_payment', async (msg) => {
    try {
        console.log('Received successful payment:', msg.successful_payment);
        const userId = msg.from.id;
        const amount = msg.successful_payment.total_amount;
        const chargeId = msg.successful_payment.telegram_payment_charge_id;

        // Store the payment in the database
        const matchingRef = db.ref(`matching/${amount}/${userId}`);
        await matchingRef.set({
            id: userId,
            timestamp: admin.database.ServerValue.TIMESTAMP,
            chargeId: chargeId,
            amount: amount
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

app.post('/process-win', async (req, res) => {
    const { winnerId, loserId, amount } = req.body;
    
    try {
        // Process win through Telegram's star system
        await bot.sendStars(winnerId, amount * 2); // Winner gets double the bet
        res.json({ success: true });
    } catch (error) {
        console.error('Error processing win:', error);
        res.json({ success: false, error: error.message });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 