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
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const app = express();

app.use(cors());
app.use(express.json());

// Handle star transactions
async function createStarTransaction(userId, amount) {
    try {
        const result = await bot.createInvoice(userId, {
            title: `Backgammon Bet: ${amount} Stars`,
            description: `Bet ${amount} stars on a game of backgammon`,
            payload: `game_bet_${Date.now()}`,
            currency: 'XTR',
            prices: [{
                label: 'Game Bet',
                amount: amount
            }]
        });
        return result;
    } catch (error) {
        console.error('Error creating star transaction:', error);
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

// Handle pre-checkout queries
bot.on('pre_checkout_query', async (query) => {
    try {
        await bot.answerPreCheckoutQuery(query.id, true);
    } catch (error) {
        console.error('Error in pre-checkout:', error);
        await bot.answerPreCheckoutQuery(query.id, false, 'Error processing stars');
    }
});

// Handle successful payments
bot.on('successful_payment', async (msg) => {
    const userId = msg.from.id;
    const amount = msg.successful_payment.total_amount;
    
    try {
        // Add user to matching queue with their bet
        const matchingRef = db.ref(`matching/${amount}/${userId}`);
        await matchingRef.set({
            id: userId,
            timestamp: admin.database.ServerValue.TIMESTAMP,
            transactionId: msg.successful_payment.telegram_payment_charge_id
        });
        
        bot.sendMessage(msg.chat.id, `Successfully placed bet of ${amount} Stars! Looking for opponent...`);
    } catch (error) {
        console.error('Error handling successful payment:', error);
        bot.sendMessage(msg.chat.id, 'Error processing your bet. Please try again.');
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