// Add this at the top of app.js
const API_URL = 'https://betgammon.onrender.com';  // Your Render URL

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

// Initialize function with more logging
function initializeApp() {
    window.Telegram.WebApp.showAlert('App initializing...');
    
    if (!window.Telegram?.WebApp) {
        window.Telegram.WebApp.showAlert('Telegram WebApp not available');
        return;
    }

    // Show the app
    const appElement = document.getElementById('app');
    if (appElement) {
        appElement.style.display = 'block';
        window.Telegram.WebApp.showAlert('App element found and displayed');
    } else {
        window.Telegram.WebApp.showAlert('App element not found!');
    }

    // Setup click handlers with logging
    const buttons = document.querySelectorAll('.bet-button');
    window.Telegram.WebApp.showAlert(`Found ${buttons.length} bet buttons`);
    
    buttons.forEach(button => {
        button.addEventListener('click', () => {
            const amount = parseInt(button.dataset.amount);
            window.Telegram.WebApp.showAlert(`Button clicked: ${amount} Stars`);
            handleBetClick(amount);
        });
    });

    // Expand the WebApp
    window.Telegram.WebApp.expand();
    window.Telegram.WebApp.showAlert('Initialization complete');
}

// Verify DOM content loaded event
document.addEventListener('DOMContentLoaded', () => {
    window.Telegram.WebApp.showAlert('DOM Content Loaded');
    initializeApp();
});

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
    if (!config.currentPlayer) {
        telegram.showAlert('Unable to access user data. Please try again.');
        return;
    }

    const amount = parseInt(button.dataset.amount);
    
    try {
        console.log('Bet button clicked:', amount);
        
        const confirmed = await window.Telegram.WebApp.showConfirm(`Ready to place a ${amount} Stars bet?`);
        console.log('User confirmed bet:', confirmed);
        
        if (confirmed) {
            console.log('Sending bet creation request...');
            const response = await fetch(`${API_URL}/create-bet`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    userId: window.Telegram.WebApp.initDataUnsafe.user.id,
                    amount: amount
                })
            });

            console.log('Bet creation response:', await response.clone().json());

            if (!response.ok) {
                throw new Error('Failed to create bet');
            }

            // Show payment processing UI
            showPaymentUI(amount);
        }
    } catch (error) {
        console.error('Error in handleBetClick:', error);
        window.Telegram.WebApp.showAlert('Error: ' + error.message);
    }
}

async function startPaymentCheck(amount) {
    const userId = window.Telegram.WebApp.initDataUnsafe.user.id;
    const checkInterval = setInterval(async () => {
        try {
            const response = await fetch(`${API_URL}/check-payment-status/${userId}/${amount}`);
            const data = await response.json();
            
            if (data.success && data.paymentConfirmed) {
                clearInterval(checkInterval);
                showSearchingUI(amount);
            }
        } catch (error) {
            console.error('Error checking payment status:', error);
            clearInterval(checkInterval);
            window.Telegram.WebApp.showAlert('Error checking payment status');
        }
    }, 2000); // Check every 2 seconds

    // Clear interval after 5 minutes (timeout)
    setTimeout(() => {
        clearInterval(checkInterval);
    }, 5 * 60 * 1000);
}

function showPaymentUI(amount) {
    console.log('Showing payment UI for amount:', amount);
    const bettingScreen = document.getElementById('betting-screen');
    const paymentScreen = document.getElementById('payment-screen');
    const searchingScreen = document.getElementById('searching-screen');
    
    // Make sure searching screen is hidden
    searchingScreen.style.display = 'none';
    bettingScreen.style.display = 'none';
    paymentScreen.style.display = 'block';
    paymentScreen.innerHTML = `
        <h2>Processing Payment</h2>
        <p>Please complete the payment of ${amount} Stars in Telegram.</p>
        <button onclick="cancelBet()">Cancel</button>
    `;
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
        }, 2 * 60 * 1000);

        // Use once() instead of on() to prevent continuous polling
        const snapshot = await matchingRef.once('value');
        const waitingPlayers = snapshot.val() || {};
        
        // Filter out our own ID and get opponents
        const opponents = Object.values(waitingPlayers)
            .filter(player => player.id !== config.currentPlayer.id);
            
        if (opponents.length > 0) {
            // Found an opponent
            clearTimeout(matchingTimeout);
            config.opponent = opponents[0];
            config.gameState = GameState.PLAYING;
            updateUI();
        } else {
            // Add ourselves to the matching queue
            await matchingRef.child(config.currentPlayer.id.toString()).set({
                id: config.currentPlayer.id,
                timestamp: firebase.database.ServerValue.TIMESTAMP
            });
        }
    } catch (error) {
        clearTimeout(matchingTimeout);
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

// Make sure searching UI is only shown after payment confirmation
function showSearchingUI(amount) {
    console.log('Showing searching UI for amount:', amount);
    const paymentScreen = document.getElementById('payment-screen');
    const searchingScreen = document.getElementById('searching-screen');
    
    paymentScreen.style.display = 'none';
    searchingScreen.style.display = 'block';
    searchingScreen.innerHTML = `
        <h2>Searching for Opponent</h2>
        <p>Bet amount: ${amount} Stars</p>
        <button onclick="cancelSearch(${amount})">Cancel Search</button>
    `;
}

// Single click handler function
async function handleBetClick(amount) {
    try {
        window.Telegram.WebApp.showAlert(`Processing bet: ${amount} Stars`);
        
        const confirmed = await window.Telegram.WebApp.showConfirm(`Ready to place a ${amount} Stars bet?`);
        
        if (confirmed) {
            const userId = window.Telegram.WebApp.initDataUnsafe.user.id;
            window.Telegram.WebApp.showAlert(`Sending request for user ${userId}`);

            const response = await fetch(`${API_URL}/create-bet`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    userId: userId,
                    amount: amount
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            window.Telegram.WebApp.showAlert(`Request completed: ${JSON.stringify(result)}`);
        }
    } catch (error) {
        window.Telegram.WebApp.showAlert(`Error: ${error.message}`);
    }
}

// Single event listener setup
document.addEventListener('DOMContentLoaded', () => {
    const buttons = document.querySelectorAll('.bet-button');
    buttons.forEach(button => {
        button.addEventListener('click', () => {
            const amount = parseInt(button.dataset.amount);
            handleBetClick(amount);
        });
    });
});