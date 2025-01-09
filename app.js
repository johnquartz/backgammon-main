// Debug logging
console.log('Starting app initialization...');
console.log('Firebase config:', window.firebaseConfig);

// Initialize Telegram WebApp
const telegram = window.Telegram?.WebApp;

// Initialize Firebase
async function initializeFirebase() {
    try {
        if (!firebase.apps.length) {  // Only initialize if not already initialized
            firebase.initializeApp(window.firebaseConfig);
        }
        return firebase.database();
    } catch (error) {
        console.error('Firebase initialization error:', error);
        telegram.showAlert && telegram.showAlert('Error connecting to game server');
        throw error;
    }
}

// Game states
const GameState = {
    BETTING: 'betting',
    MATCHING: 'matching',
    PLAYING: 'playing'
};

// App configuration
const config = {
    gameState: GameState.BETTING,
    currentPlayer: null,
    betAmount: 0,
    opponent: null
};

// Initialize the application
async function initializeApp() {
    const appElement = document.getElementById('app');
    const telegramMessage = document.getElementById('telegram-only-message');
    
    if (!telegram) {
        appElement.style.display = 'none';
        telegramMessage.style.display = 'block';
        return;
    }

    try {
        const database = await initializeFirebase();
        window.database = database;  // Make database globally available
        
        appElement.style.display = 'block';
        telegramMessage.style.display = 'none';
        telegram.expand();
        
        // Get user data
        if (telegram.initDataUnsafe?.user) {
            config.currentPlayer = {
                id: telegram.initDataUnsafe.user.id,
                username: telegram.initDataUnsafe.user.username || 'Anonymous',
                first_name: telegram.initDataUnsafe.user.first_name || 'Player'
            };
        }

        setupEventListeners();
        updateUI();
    } catch (error) {
        console.error('App initialization error:', error);
    }
}

// Set up event listeners
function setupEventListeners() {
    // Setup bet button listeners
    const betButtons = document.querySelectorAll('.bet-button');
    betButtons.forEach(button => {
        button.addEventListener('click', () => handleBetSelection(button));
    });

    // Setup cancel button listener
    const cancelButton = document.getElementById('cancel-match');
    cancelButton.addEventListener('click', handleCancelMatch);
}

// Handle bet selection - simplified version without star checking
async function handleBetSelection(button) {
    if (!config.currentPlayer) {
        telegram.showAlert && telegram.showAlert('Unable to access user data. Please try again.');
        return;
    }

    const amount = parseInt(button.dataset.amount);
    config.betAmount = amount;
    config.gameState = GameState.MATCHING;
    updateUI();

    try {
        await findMatch(amount);
    } catch (error) {
        config.gameState = GameState.BETTING;
        updateUI();
        telegram.showAlert && telegram.showAlert('Failed to find match. Please try again.');
    }
}

// Handle match cancellation
function handleCancelMatch() {
    if (config.currentPlayer) {
        // Remove from matching queue
        const queueRef = database.ref(`matching/${config.betAmount}/${config.currentPlayer.id}`);
        queueRef.remove()
            .then(() => console.log('Removed from queue'))
            .catch(error => console.error('Error removing from queue:', error));
    }
    
    config.gameState = GameState.BETTING;
    config.betAmount = 0;
    updateUI();
}

// Find match with specific bet amount
async function findMatch(amount) {
    if (!config.currentPlayer) {
        throw new Error('No player data');
    }

    const matchingRef = database.ref(`matching/${amount}`);
    let matchingTimeout;
    
    try {
        // Set timeout to remove player after 2 minutes
        matchingTimeout = setTimeout(async () => {
            try {
                await matchingRef.child(config.currentPlayer.id.toString()).remove();
                config.gameState = GameState.BETTING;
                updateUI();
                telegram.showAlert('No opponent found. Please try again.');
            } catch (error) {
                telegram.showAlert('Error removing from queue');
            }
        }, 2 * 60 * 1000); // 2 minutes

        // First, check for available opponents
        const snapshot = await matchingRef.once('value');
        const waitingPlayers = snapshot.val() || {};
        
        // Filter out our own ID and get opponents
        const opponents = Object.values(waitingPlayers)
            .filter(player => player.id !== config.currentPlayer.id);
            
        if (opponents.length > 0) {
            clearTimeout(matchingTimeout); // Clear timeout since we found a match
            const opponent = opponents[0];
            
            // Remove both players from queue
            await Promise.all([
                matchingRef.child(opponent.id.toString()).remove(),
                matchingRef.child(config.currentPlayer.id.toString()).remove()
            ]);
            
            // Create game session
            const gameRef = database.ref('games').push();
            
            const gameData = {
                status: 'starting',
                betAmount: amount,
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                players: {
                    [config.currentPlayer.id]: {
                        id: config.currentPlayer.id,
                        username: config.currentPlayer.username,
                        first_name: config.currentPlayer.first_name
                    },
                    [opponent.id]: {
                        id: opponent.id,
                        username: opponent.username,
                        first_name: opponent.first_name
                    }
                }
            };
            
            await gameRef.set(gameData);
            
            config.opponent = opponent;
            config.gameState = GameState.PLAYING;
            updateUI();
            return;
        }
        
        // No opponent found, add self to queue
        await matchingRef.child(config.currentPlayer.id.toString()).set({
            id: config.currentPlayer.id,
            username: config.currentPlayer.username,
            first_name: config.currentPlayer.first_name,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });
        
        // Listen for matches
        return new Promise((resolve) => {
            const gamesRef = database.ref('games');
            
            const gameListener = gamesRef
                .orderByChild(`players/${config.currentPlayer.id}/id`)
                .equalTo(config.currentPlayer.id)
                .limitToLast(1)
                .on('child_added', async (snapshot) => {
                    const game = snapshot.val();
                    
                    if (game && game.betAmount === amount) {
                        clearTimeout(matchingTimeout); // Clear timeout since we found a match
                        // Cleanup
                        gamesRef.off('child_added', gameListener);
                        await matchingRef.child(config.currentPlayer.id.toString()).remove();
                        
                        // Get opponent
                        const opponentId = Object.keys(game.players)
                            .find(id => id !== config.currentPlayer.id.toString());
                        config.opponent = game.players[opponentId];
                        
                        config.gameState = GameState.PLAYING;
                        updateUI();
                        resolve();
                    }
                });
        });
    } catch (error) {
        clearTimeout(matchingTimeout); // Clear timeout on error
        throw error;
    }
}

// Update UI based on game state
function updateUI() {
    const bettingScreen = document.getElementById('betting-screen');
    const matchingScreen = document.getElementById('matching-screen');
    const gameScreen = document.getElementById('game-screen');
    
    // Hide all screens first
    [bettingScreen, matchingScreen, gameScreen].forEach(screen => 
        screen.classList.add('hidden')
    );

    // Show appropriate screen
    switch (config.gameState) {
        case GameState.BETTING:
            bettingScreen.classList.remove('hidden');
            break;
        case GameState.MATCHING:
            matchingScreen.classList.remove('hidden');
            // Update matching screen bet amount
            document.getElementById('matching-bet-amount').textContent = config.betAmount;
            break;
        case GameState.PLAYING:
            gameScreen.classList.remove('hidden');
            // Update game screen info
            if (config.currentPlayer && config.opponent) {
                document.getElementById('player1-name').textContent = config.currentPlayer.first_name;
                document.getElementById('player2-name').textContent = config.opponent.first_name;
                document.getElementById('bet-amount').textContent = config.betAmount;
            }
            break;
    }
}

// Add this function to handle game end
async function handleGameEnd(winner) {
    const totalPrize = config.betAmount * 2; // Both players' bets
    
    if (winner.id === config.currentPlayer.id) {
        // Current player won
        await telegram.sendStarsPayment(totalPrize);
        telegram.showAlert(`Congratulations! You won ${totalPrize} stars!`);
    } else {
        // Opponent won
        telegram.showAlert(`Game Over. You lost ${config.betAmount} stars.`);
    }
    
    // Reset game state
    config.gameState = GameState.BETTING;
    config.betAmount = 0;
    config.opponent = null;
    updateUI();
}

// Make sure we initialize only after DOM is fully loaded
document.addEventListener('DOMContentLoaded', initializeApp);