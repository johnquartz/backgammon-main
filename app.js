// Debug logging
console.log('Starting app initialization...');
console.log('Firebase config:', window.firebaseConfig);

// Initialize Telegram WebApp
const telegram = window.Telegram?.WebApp;

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

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
function initializeApp() {
    console.log('Initializing app...');
    
    const appElement = document.getElementById('app');
    const telegramMessage = document.getElementById('telegram-only-message');
    
    if (!telegram) {
        console.log('Not in Telegram WebApp');
        appElement.style.display = 'none';
        telegramMessage.style.display = 'block';
        return;
    }

    try {
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
            console.log('Connected user:', config.currentPlayer);
        } else {
            console.warn('No user data available');
        }

        setupEventListeners();
        updateUI();
    } catch (error) {
        console.error('Error during initialization:', error);
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

// Handle bet selection
async function handleBetSelection(button) {
    console.log('Handling bet selection...');
    
    // Check if we have user data
    if (!config.currentPlayer) {
        console.error('No user data available');
        telegram.showAlert && telegram.showAlert('Unable to access user data. Please try again.');
        return;
    }

    const amount = parseInt(button.dataset.amount);
    console.log(`Selected bet amount: ${amount}`);
    config.betAmount = amount;
    config.gameState = GameState.MATCHING;
    
    document.getElementById('selected-bet').textContent = amount;
    updateUI();

    try {
        // Show matching status
        const statusText = document.getElementById('matching-status');
        if (statusText) statusText.textContent = 'Finding opponent...';

        await findMatch(amount);
    } catch (error) {
        console.error('Error in matchmaking:', error);
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
    
    try {
        // Update UI to show status
        const statusText = document.getElementById('matching-status');
        if (statusText) statusText.textContent = 'Checking for opponents...';
        
        // First, check for available opponents
        const snapshot = await matchingRef.once('value');
        const waitingPlayers = snapshot.val() || {};
        
        // Filter out our own ID and get opponents
        const opponents = Object.values(waitingPlayers)
            .filter(player => player.id !== config.currentPlayer.id);
            
        if (opponents.length > 0) {
            const opponent = opponents[0];
            statusText.textContent = 'Found an opponent! Starting game...';
            
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
        statusText.textContent = 'Waiting for an opponent...';
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
        telegram.showAlert(`Matching error: ${error.message}`);
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
            break;
        case GameState.PLAYING:
            gameScreen.classList.remove('hidden');
            break;
    }
}

// Make sure we initialize only after DOM is fully loaded
document.addEventListener('DOMContentLoaded', initializeApp);