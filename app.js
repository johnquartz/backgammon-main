// Initialize Telegram WebApp
const telegram = window.Telegram?.WebApp;

// Initialize Firebase with debug logging
try {
    firebase.initializeApp(firebaseConfig);
    console.log('Firebase initialized successfully');
    const database = firebase.database();
    
    // Test database connection
    database.ref('.info/connected').on('value', (snap) => {
        if (snap.val() === true) {
            console.log('Connected to Firebase');
        } else {
            console.log('Not connected to Firebase');
        }
    });
} catch (error) {
    console.error('Firebase initialization error:', error);
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
        
        const user = telegram.initDataUnsafe?.user;
        if (user) {
            config.currentPlayer = user;
            console.log('Connected user:', user.username);
            
            // Show welcome message
            telegram.showPopup({
                title: 'Welcome!',
                message: `Ready to play, ${user.first_name}?`,
                buttons: [{type: 'ok'}]
            });
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
    const amount = parseInt(button.dataset.amount);
    config.betAmount = amount;
    config.gameState = GameState.MATCHING;
    
    document.getElementById('selected-bet').textContent = amount;
    updateUI();

    try {
        await findMatch(amount);
    } catch (error) {
        console.error('Error finding match:', error);
        config.gameState = GameState.BETTING;
        updateUI();
        telegram.showAlert('Failed to find match. Please try again.');
    }
}

// Handle match cancellation
function handleCancelMatch() {
    if (config.currentPlayer) {
        // Remove player from matching queue
        const queueRef = database.ref(`matching/${config.betAmount}/${config.currentPlayer.id}`);
        queueRef.remove();
    }
    
    config.gameState = GameState.BETTING;
    config.betAmount = 0;
    updateUI();
}

// Find match with specific bet amount
function findMatch(betAmount) {
    return new Promise((resolve, reject) => {
        if (!config.currentPlayer) {
            reject(new Error('No player data'));
            return;
        }

        const matchingRef = database.ref(`matching/${betAmount}`);
        
        // First, check for available opponents
        matchingRef.once('value', snapshot => {
            const waitingPlayers = snapshot.val() || {};
            const waitingPlayerIds = Object.keys(waitingPlayers);
            
            if (waitingPlayerIds.length > 0) {
                // Found an opponent
                const opponentId = waitingPlayerIds[0];
                const opponent = waitingPlayers[opponentId];
                
                if (opponentId !== config.currentPlayer.id.toString()) {
                    // Remove opponent from queue
                    matchingRef.child(opponentId).remove();
                    
                    // Create a game session
                    createGameSession(config.currentPlayer, opponent, betAmount);
                    resolve();
                    return;
                }
            }
            
            // No opponent found, add self to queue
            matchingRef.child(config.currentPlayer.id).set({
                id: config.currentPlayer.id,
                username: config.currentPlayer.username,
                first_name: config.currentPlayer.first_name,
                timestamp: firebase.database.ServerValue.TIMESTAMP
            });
            
            // Listen for opponent
            const playerRef = matchingRef.child(config.currentPlayer.id);
            playerRef.onDisconnect().remove();
            
            // Wait for game session
            const gamesRef = database.ref('games');
            gamesRef.orderByChild('players/' + config.currentPlayer.id)
                   .limitToLast(1)
                   .on('child_added', gameSnapshot => {
                        const game = gameSnapshot.val();
                        if (game && game.betAmount === betAmount) {
                            playerRef.remove();
                            gamesRef.off();
                            resolve();
                        }
                   });
        });
    });
}

// Create a new game session
function createGameSession(player1, player2, betAmount) {
    const gameRef = database.ref('games').push();
    
    const gameData = {
        betAmount: betAmount,
        status: 'starting',
        timestamp: firebase.database.ServerValue.TIMESTAMP,
        players: {
            [player1.id]: {
                username: player1.username,
                first_name: player1.first_name
            },
            [player2.id]: {
                username: player2.username,
                first_name: player2.first_name
            }
        }
    };
    
    gameRef.set(gameData);
    return gameRef.key;
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