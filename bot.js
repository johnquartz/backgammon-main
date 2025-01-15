require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');

// Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://betgammon-ba8bc-default-rtdb.europe-west1.firebasedatabase.app"
});

const db = admin.database();
const app = express();

// Enable CORS for GitHub Pages
app.use(cors({
    origin: 'https://johnquartz.github.io',
    methods: ['GET', 'POST'],
    credentials: true
}));

app.use(express.json());

const PORT = process.env.PORT || 3000;

// Initialize bot without specifying port in webhook
const bot = new TelegramBot(process.env.BOT_TOKEN);

// Set webhook
const url = 'https://betgammon.onrender.com';
bot.setWebHook(`${url}/webhook/${process.env.BOT_TOKEN}`);

// Handle star transactions
async function createStarTransaction(userId, amount) {
    try {
        const result = await bot.sendInvoice(
            userId,
            "Backgammon Bet", // Title
            `Bet ${amount} Stars`, // Description
            `bet_${Date.now()}`, // Payload
            "", // Provider token (not needed for Stars)
            "XTR", // Currency
            [{ label: "Bet", amount: amount }], // Prices
            { start_parameter: "bet_game" } // Optional parameters
        );
        return result;
    } catch (error) {
        console.error('Error details:', error);
        throw error;
    }
}

// Webhook endpoint
app.post(`/webhook/${process.env.BOT_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Bot commands
bot.onText(/\/start/, async (msg) => {
    try {
        await bot.sendMessage(msg.chat.id, 'Welcome to Backgammon Stars!', {
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: 'Play Now',
                        web_app: { url: 'https://johnquartz.github.io/backgammon-main/' }
                    }
                ]]
            }
        });
    } catch (error) {
        console.error('Error sending welcome message:', error);
    }
});

// Handle pre-checkout query
bot.on('pre_checkout_query', (query) => {
    console.log('Received pre-checkout query:', query);
    bot.answerPreCheckoutQuery(query.id, true);
});

// Handle successful payment
bot.on('successful_payment', async (msg) => {
    console.log('Received successful payment:', msg);
    try {
        const userId = msg.from.id;
        const amount = msg.successful_payment.total_amount;

        // Now we can safely add to matching pool
        const matchingRef = db.ref(`matching/${amount}/${userId}`);
        await matchingRef.set({
            id: userId,
            timestamp: admin.database.ServerValue.TIMESTAMP,
            paymentConfirmed: true  // Add this flag
        });

        await bot.sendMessage(userId, 'Payment successful! Starting search for opponent...');
    } catch (error) {
        console.error('Error handling successful payment:', error);
        await bot.sendMessage(userId, 'Error processing payment. Please try again.');
    }
});

// Handle button callbacks
bot.on('callback_query', async (query) => {
    const data = query.data;
    
    if (data.startsWith('start_search_')) {
        const amount = parseInt(data.split('_')[2]);
        const userId = query.from.id;
        
        // Add to matching pool
        const matchingRef = db.ref(`matching/${amount}/${userId}`);
        await matchingRef.set({
            id: userId,
            timestamp: admin.database.ServerValue.TIMESTAMP
        });

        await bot.editMessageText('Searching for opponent... ⏳', {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id,
            reply_markup: {
                inline_keyboard: [[
                    { text: 'Cancel Search', callback_data: 'cancel_search' }
                ]]
            }
        });
    } 
    else if (data === 'cancel_bet') {
        await bot.deleteMessage(query.message.chat.id, query.message.message_id);
        await bot.sendMessage(query.message.chat.id, 'Bet cancelled. You can start a new bet anytime!');
    }
    else if (data === 'cancel_search') {
        const userId = query.from.id;
        // Remove from all matching pools
        const matchingRef = db.ref('matching');
        const snapshot = await matchingRef.once('value');
        const amounts = snapshot.val() || {};
        
        Object.keys(amounts).forEach(async (amount) => {
            if (amounts[amount][userId]) {
                await db.ref(`matching/${amount}/${userId}`).remove();
            }
        });

        await bot.editMessageText('Search cancelled. You can start a new bet anytime!', {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id
        });
    }
    else if (data.startsWith('confirm_bet_')) {
        const amount = parseInt(data.split('_')[2]);
        try {
            await createStarTransaction(query.from.id, amount);
            await bot.deleteMessage(query.message.chat.id, query.message.message_id);
        } catch (error) {
            await bot.editMessageText('Error creating bet. Please try again.', {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id
            });
        }
    }
});

// API Endpoints for WebApp
app.post('/create-bet', async (req, res) => {
    const { userId, amount } = req.body;
    
    console.log('Received bet request:', { userId, amount });
    
    try {
        console.log('Attempting to send invoice...');
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
            }],
            {
                need_name: false,
                need_phone_number: false,
                need_email: false,
                need_shipping_address: false,
                is_flexible: false
            }
        );
        console.log('Invoice sent successfully:', result);
        res.json({ success: true, result });
    } catch (error) {
        console.error('Error creating invoice:', error);
        console.error('Full error object:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add endpoint to check payment status
app.get('/check-payment-status/:userId/:amount', async (req, res) => {
    try {
        const { userId, amount } = req.params;
        const matchingRef = db.ref(`matching/${amount}/${userId}`);
        const snapshot = await matchingRef.once('value');
        const data = snapshot.val();
        
        res.json({ 
            success: true, 
            isMatching: !!data,
            paymentConfirmed: data?.paymentConfirmed || false
        });
    } catch (error) {
        console.error('Error checking payment status:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start the Express server
const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}).on('error', (err) => {
    console.error('Server error:', err);
    process.exit(1);
}); 