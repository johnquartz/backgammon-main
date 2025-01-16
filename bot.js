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
    console.log('=== PRE-CHECKOUT QUERY ===');
    console.log('Query details:', query);
    bot.answerPreCheckoutQuery(query.id, true)
        .then(() => console.log('Pre-checkout query answered successfully'))
        .catch(error => console.error('Error answering pre-checkout:', error));
});

// Handle successful payment
bot.on('successful_payment', async (msg) => {
    try {
        const userId = msg.from.id;
        const amount = msg.successful_payment.total_amount;

        console.log(`Player ${userId} paid ${amount} Stars, adding to matching pool`);

        // Add to matching pool
        const matchingRef = db.ref(`matching/${amount}`);
        await matchingRef.child(userId).set({
            id: userId,
            timestamp: admin.database.ServerValue.TIMESTAMP,
            paymentConfirmed: true
        });

        // Check for opponent
        const snapshot = await matchingRef.once('value');
        const players = snapshot.val();
        
        if (players && Object.keys(players).length >= 2) {
            console.log('Found enough players:', players);
            
            // Get the two oldest players in the pool
            const sortedPlayers = Object.entries(players)
                .sort((a, b) => a[1].timestamp - b[1].timestamp)
                .slice(0, 2);
            
            const [player1, player2] = sortedPlayers;
            console.log('Matched players:', player1[1].id, player2[1].id);
            
            // Create a new game room
            const gameId = `game_${Date.now()}`;
            const gameRef = db.ref(`games/${gameId}`);
            
            // Create game room first
            await gameRef.set({
                player1: player1[1].id,
                player2: player2[1].id,
                betAmount: amount,
                status: 'starting',
                timestamp: admin.database.ServerValue.TIMESTAMP
            });
            console.log('Created game room:', gameId);

            // Remove players from matching pool
            await Promise.all([
                matchingRef.child(player1[0]).remove(),
                matchingRef.child(player2[0]).remove()
            ]);
            console.log('Removed players from matching pool');

            // Notify both players
            const paymentEvent = {
                eventType: 'payment_success',
                eventData: { amount: amount }
            };
            await Promise.all([
                bot.sendMessage(player1[1].id, JSON.stringify(paymentEvent)),
                bot.sendMessage(player2[1].id, JSON.stringify(paymentEvent))
            ]);
            
            const gameStartEvent = {
                eventType: 'game_start',
                eventData: {}
            };
            await Promise.all([
                bot.sendMessage(player1[1].id, JSON.stringify(gameStartEvent)),
                bot.sendMessage(player2[1].id, JSON.stringify(gameStartEvent))
            ]);
            
            console.log('Game setup complete:', gameId);
        } else {
            await bot.sendMessage(userId, 'Payment successful!', {
                web_app: {
                    main_button: {
                        text: `MATCHING_${amount}`,
                        is_visible: true
                    }
                }
            });
        }

        // After successful payment
        await bot.answerWebAppQuery(msg.web_app_query_id, {
            type: 'article',
            id: String(Date.now()),
            title: 'Payment Success',
            input_message_content: {
                message_text: 'Payment successful! Looking for opponent...'
            },
            web_app_data: {
                data: 'PAYMENT_SUCCESS'
            }
        });

        // When game starts
        await Promise.all([
            bot.answerWebAppQuery(player1[1].web_app_query_id, {
                type: 'article',
                id: String(Date.now()),
                title: 'Game Starting',
                input_message_content: {
                    message_text: 'Game starting...'
                },
                web_app_data: {
                    data: 'GAME_START'
                }
            }),
            bot.answerWebAppQuery(player2[1].web_app_query_id, {
                type: 'article',
                id: String(Date.now()),
                title: 'Game Starting',
                input_message_content: {
                    message_text: 'Game starting...'
                },
                web_app_data: {
                    data: 'GAME_START'
                }
            })
        ]);

    } catch (error) {
        console.error('Error in matching process:', error);
        await bot.sendMessage(userId, 'Error processing match. Please try again.');
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
    console.log('=== START BET CREATION ===');
    const { userId, amount } = req.body;
    
    console.log('1. Received bet request:', { userId, amount });
    
    try {
        console.log('2. Validating input...');
        if (!userId || !amount) {
            throw new Error('Missing userId or amount');
        }

        console.log('3. Attempting to send invoice with:', {
            userId,
            amount,
            timestamp: Date.now()
        });

        const result = await bot.sendInvoice(
            userId,
            "Backgammon Stars Bet",
            "Place your bet to start playing",
            "bet-" + Date.now(),
            "",
            "XTR",
            [{ label: `${amount} Stars Bet`, amount: amount }]
        );
        
        console.log('4. Invoice sent successfully:', result);
        res.json({ success: true, result });
    } catch (error) {
        console.error('ERROR in bet creation:', {
            message: error.message,
            stack: error.stack
        });
        res.status(500).json({ success: false, error: error.message });
    }
    console.log('=== END BET CREATION ===');
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

// Add a simple test endpoint
app.get('/test', (req, res) => {
    console.log('Test endpoint hit');
    res.json({ status: 'ok' });
});

// Make sure CORS is properly configured
app.use(cors({
    origin: ['https://johnquartz.github.io', 'https://t.me'],
    methods: ['GET', 'POST'],
    credentials: true
}));

// Add a root route
app.get('/', (req, res) => {
    res.send('Betgammon server is running!');
});

// Start the Express server
const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}).on('error', (err) => {
    console.error('Server error:', err);
    process.exit(1);
}); 