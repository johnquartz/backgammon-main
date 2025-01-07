// Initialize Telegram WebApp
const telegram = window.Telegram.WebApp;

// Verify we're in Telegram client
if (!telegram) {
    alert('Please open this web app inside Telegram!');
}

// Game states
const GameState = {
    BETTING: 'betting',    // Choosing bet amount
    MATCHING: 'matching',  // Looking for opponent
    PLAYING: 'playing'     // In game
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
    // Expand to full height
    telegram.expand();
    
    // Get user data
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
    
    // Update UI
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
    // TODO: Inform server about cancellation
    config.gameState = GameState.BETTING;
    config.betAmount = 0;
    updateUI();
}

// Find match with specific bet amount
function findMatch(betAmount) {
    return new Promise((resolve) => {
        // TODO: Replace with actual backend call
        setTimeout(() => {
            resolve();
        }, 2000);
    });
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

// Start the app when document is ready
document.addEventListener('DOMContentLoaded', initializeApp);