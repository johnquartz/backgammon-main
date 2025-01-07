// Debug logging
console.log('Starting app initialization...');
console.log('Firebase config:', window.firebaseConfig);

// Initialize Telegram WebApp
const telegram = window.Telegram?.WebApp;

// Initialize Firebase with debug logging
try {
    console.log('Attempting to initialize Firebase...');
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

    // Test write operation
    const testRef = database.ref('test');
    testRef.set({
        timestamp: Date.now(),
        test: 'Hello Firebase!'
    })
    .then(() => console.log('Test write successful'))
    .catch(error => console.error('Test write failed:', error));

} catch (error) {
    console.error('Firebase initialization error:', error);
    console.error('Error details:', error.message);
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
        // Show status in UI
        const matchingScreen = document.getElementById('matching-screen');
        const statusText = document.createElement('p');
        statusText.id = 'matching-status';
        statusText.textContent = 'Joining queue...';
        matchingScreen.appendChild(statusText);

        // Add to matching queue
        const matchingRef = database.ref(`matching/${amount}/${config.currentPlayer.id}`);
        await matchingRef.set({
            id: config.currentPlayer.id,
            username: config.currentPlayer.username,
            first_name: config.currentPlayer.first_name,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });

        statusText.textContent = 'Waiting for opponent...';
        console.log(`Added to ${amount} stars queue`);

        // Listen for game creation
        const gamesRef = database.ref('games');
        gamesRef.orderByChild(`players/${config.currentPlayer.id}/id`)
               .equalTo(config.currentPlayer.id)
               .limitToLast(1)
               .on('child_added', (snapshot) => {
                    const game = snapshot.val();
                    if (game && game.betAmount === amount) {
                        statusText.textContent = 'Opponent found!';
                        console.log('Match found!', game);
                        // TODO: Start the game
                    }
               });

    } catch (error) {
        console.error('Error in matchmaking:', error);
        config.gameState = GameState.BETTING;
        updateUI();
        telegram.showAlert('Failed to find match. Please try again.');
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