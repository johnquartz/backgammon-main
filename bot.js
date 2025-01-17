require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');

// Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://betgammon-ba8bc-default-rtdb.europe-west1.firebasedatabase.app"
});

const db = admin.database();
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

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

// Store active connections
const clients = new Map();

// WebSocket connection handling
wss.on('connection', async (ws, req) => {
    console.log('New WebSocket connection');

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'register') {
                const userId = data.userId;
                clients.set(userId, ws);
                console.log(`Client registered: ${userId}`);

                // Get and send user's coin balance
                const userRef = db.ref(`users/${userId}`);
                const snapshot = await userRef.once('value');
                let userBalance = 0;

                if (!snapshot.exists()) {
                    // New user - create account with initial 1000 coins
                    await userRef.set({
                        id: userId,
                        coins: 1000,
                        created_at: admin.database.ServerValue.TIMESTAMP
                    });
                    userBalance = 1000;
                    console.log(`Created new user ${userId} with 1000 coins`);
                } else {
                    userBalance = snapshot.val().coins;
                    console.log(`Existing user ${userId} has ${userBalance} coins`);
                }

                // Send balance to client
                ws.send(JSON.stringify({
                    type: 'balance_update',
                    balance: userBalance
                }));
            }
            else if (data.type === 'place_bet') {
                const userId = data.userId;
                const amount = data.amount;
                
                // Check user's balance
                const userRef = db.ref(`users/${userId}`);
                const snapshot = await userRef.once('value');
                const user = snapshot.val();

                if (!user || user.coins < amount) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Insufficient coins'
                    }));
                    return;
                }

                // Deduct coins
                await userRef.update({
                    coins: user.coins - amount
                });

                // Add to matching pool
                const matchingRef = db.ref(`matching/${amount}`);
                await matchingRef.child(userId).set({
                    id: userId,
                    timestamp: admin.database.ServerValue.TIMESTAMP
                });

                console.log(`Player ${userId} bet ${amount} coins, added to matching pool`);

                // Send updated balance
                ws.send(JSON.stringify({
                    type: 'payment_success',
                    amount: amount,
                    remainingCoins: user.coins - amount
                }));

                // Check for opponent
                const matchSnapshot = await matchingRef.once('value');
                const players = matchSnapshot.val();
                
                if (players && Object.keys(players).length >= 2) {
                    const sortedPlayers = Object.entries(players)
                        .sort((a, b) => a[1].timestamp - b[1].timestamp)
                        .slice(0, 2);
                    
                    const [player1, player2] = sortedPlayers;
                    
                    // Create game room
                    const gameId = `game_${Date.now()}`;
                    const gameRef = db.ref(`games/${gameId}`);
                    
                    await gameRef.set({
                        player1: player1[1].id,
                        player2: player2[1].id,
                        betAmount: amount,
                        status: 'starting',
                        timestamp: admin.database.ServerValue.TIMESTAMP
                    });

                    // Remove matched players from pool
                    await Promise.all([
                        matchingRef.child(player1[0]).remove(),
                        matchingRef.child(player2[0]).remove()
                    ]);

                    // Notify both players
                    [player1[1].id, player2[1].id].forEach(playerId => {
                        const playerWs = clients.get(playerId);
                        if (playerWs) {
                            playerWs.send(JSON.stringify({
                                type: 'game_start',
                                gameId: gameId,
                                player1Id: player1[1].id,
                                player2Id: player2[1].id
                            }));
                        }
                    });
                }
            }
            else if (data.type === 'game_winner') {
                const gameRef = db.ref(`games/${data.gameId}`);
                const gameSnapshot = await gameRef.once('value');
                const game = gameSnapshot.val();
                
                if (game) {
                    const totalAmount = game.betAmount * 2;
                    
                    // Add coins to winner's balance
                    const winnerRef = db.ref(`users/${data.winnerId}`);
                    const winnerSnapshot = await winnerRef.once('value');
                    const winner = winnerSnapshot.val();
                    
                    await winnerRef.update({
                        coins: winner.coins + totalAmount
                    });

                    // Update game status
                    await gameRef.update({
                        status: 'completed',
                        winner: data.winnerId,
                        completedAt: admin.database.ServerValue.TIMESTAMP
                    });

                    // Notify both players
                    [game.player1, game.player2].forEach(playerId => {
                        const playerWs = clients.get(playerId);
                        if (playerWs) {
                            playerWs.send(JSON.stringify({
                                type: 'game_over',
                                winnerId: data.winnerId
                            }));
                        }
                    });

                    // Send winner their updated balance
                    const winnerWs = clients.get(data.winnerId);
                    if (winnerWs) {
                        winnerWs.send(JSON.stringify({
                            type: 'balance_update',
                            balance: winner.coins + totalAmount
                        }));
                    }
                }
            }
        } catch (error) {
            console.error('Error handling WebSocket message:', error);
        }
    });

    ws.on('close', () => {
        // Remove client on disconnect
        for (const [userId, client] of clients.entries()) {
            if (client === ws) {
                clients.delete(userId);
                console.log(`Client disconnected: ${userId}`);
                break;
            }
        }
    });
});

// Webhook endpoint
app.post(`/webhook/${process.env.BOT_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Bot commands
bot.onText(/\/start/, async (msg) => {
    const userId = msg.from.id;
    
    try {
        // Check if user exists
        const userRef = db.ref(`users/${userId}`);
        const snapshot = await userRef.once('value');
        
        if (!snapshot.exists()) {
            // New user - create account with initial 1000 coins
            await userRef.set({
                id: userId,
                coins: 1000,
                created_at: admin.database.ServerValue.TIMESTAMP
            });
            await bot.sendMessage(userId, 'Welcome! You received 1000 coins to start playing!');
        }
        
        // Send the web app keyboard
        await bot.sendMessage(userId, 'Ready to play?', {
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: '🎲 Play Backgammon',
                        web_app: { url: process.env.WEBAPP_URL }
                    }
                ]]
            }
        });
    } catch (error) {
        console.error('Error handling start command:', error);
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

        // Notify client about payment success
        const ws = clients.get(userId);
        if (ws) {
            ws.send(JSON.stringify({
                type: 'payment_success',
                amount: amount
            }));
        }

        // Check for opponent
        const snapshot = await matchingRef.once('value');
        const players = snapshot.val();
        
        if (players && Object.keys(players).length >= 2) {
            const sortedPlayers = Object.entries(players)
                .sort((a, b) => a[1].timestamp - b[1].timestamp)
                .slice(0, 2);
            
            const [player1, player2] = sortedPlayers;
            
            // Create game room
            const gameId = `game_${Date.now()}`;
            const gameRef = db.ref(`games/${gameId}`);
            
            await gameRef.set({
                player1: player1[1].id,
                player2: player2[1].id,
                betAmount: amount,
                status: 'starting',
                timestamp: admin.database.ServerValue.TIMESTAMP
            });

            // Remove matched players from pool
            await Promise.all([
                matchingRef.child(player1[0]).remove(),
                matchingRef.child(player2[0]).remove()
            ]);

            // Notify both players about game start
            [player1[1].id, player2[1].id].forEach(playerId => {
                const ws = clients.get(playerId);
                if (ws) {
                    ws.send(JSON.stringify({
                        type: 'game_start',
                        gameId: gameId
                    }));
                }
            });
        }

    } catch (error) {
        console.error('Error in matching process:', error);
        const ws = clients.get(userId);
        if (ws) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Error processing match'
            }));
        }
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

// Start the server
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

async function sendStarsToWinner(userId, amount, gameId) {
    try {
        // Create a form ID (you might want to store this in your database)
        const formId = Date.now();
        
        // Create the API request
        const response = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/payments.sendStarsForm`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                form_id: formId,
                invoice: {
                    title: 'Game Winnings',
                    description: `You won ${amount} Stars!`,
                    payload: `win-${gameId}`,
                    amount: amount,
                    currency: 'XTR'
                }
            })
        });

        const result = await response.json();
        console.log('Stars transfer result:', result);
        return result;
    } catch (error) {
        console.error('Error sending stars:', error);
        throw error;
    }
} 

// When user clicks bet button
async function handleBet(userId, amount) {
    try {
        const userRef = db.ref(`users/${userId}`);
        const snapshot = await userRef.once('value');
        const user = snapshot.val();

        if (!user || user.coins < amount) {
            throw new Error('Insufficient coins');
        }

        // Deduct coins and add to matching pool
        await userRef.update({
            coins: user.coins - amount
        });

        // Add to matching pool
        const matchingRef = db.ref(`matching/${amount}`);
        await matchingRef.child(userId).set({
            id: userId,
            timestamp: admin.database.ServerValue.TIMESTAMP,
            betPlaced: true
        });

        // Notify client
        const ws = clients.get(userId);
        if (ws) {
            ws.send(JSON.stringify({
                type: 'payment_success',
                amount: amount,
                remainingCoins: user.coins - amount
            }));
        }

        return true;
    } catch (error) {
        console.error('Error handling bet:', error);
        return false;
    }
}

// Handle winner payment
async function sendCoinsToWinner(userId, amount) {
    try {
        const userRef = db.ref(`users/${userId}`);
        const snapshot = await userRef.once('value');
        const user = snapshot.val();

        await userRef.update({
            coins: user.coins + amount
        });

        return true;
    } catch (error) {
        console.error('Error sending coins to winner:', error);
        return false;
    }
} 