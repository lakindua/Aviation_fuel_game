const API_BASE_URL = window.location.origin;
const CHEMICAL_NAMES = [
    "Dodecane", "Octane", "Benzene", "Ethanol", "Isobutanol",
    "Methanol", "Hexane", "Cyclohexane", "Toluene", "Nonane",
    "Acetone", "Heptane", "Butanol", "Phenol", "Palmitic acid"
];

const gameState = {
    gameId: null,
    researcherName: 'Researcher',
    currentLocation: null,
    airports: [],
    selectedAirport: null,
    gameStarted: false,
    travelPath: null,
    visitedAirports: []
};

const map = L.map('map').setView([20, 0], 2);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18
}).addTo(map);

const airportMarkers = L.featureGroup().addTo(map);
let currentMarker = null;

function showLoading(show) {
    document.getElementById('loading').classList.toggle('active', show);
}

async function apiCall(endpoint, params = {}) {
    try {
        const queryString = new URLSearchParams(params).toString();
        const url = queryString ? `${API_BASE_URL}${endpoint}?${queryString}` : `${API_BASE_URL}${endpoint}`;
        const response = await fetch(url);

        if (!response.ok) {
            const errorText = await response.text();

            if (errorText.includes("Insufficient fuel")) {
                throw new Error("Insufficient fuel for this journey");
            }
            throw new Error(`API Error: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('API call failed:', error);
        throw error;
    }
}

async function fetchChemicalData(name) {
    try {
        const cidResp = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/cids/JSON`);
        if (!cidResp.ok) return null;

        const cidJson = await cidResp.json();
        const cid = cidJson?.IdentifierList?.CID?.[0];
        if (!cid) return null;

        const propResp = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/MolecularFormula,MolecularWeight,IUPACName/JSON`);
        if (!propResp.ok) return null;

        const propJson = await propResp.json();
        const props = propJson?.PropertyTable?.Properties?.[0] || {};
        const imageUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/PNG`;

        let description = `Chemical component ${name} used in aviation fuel research.`;
        try {
            const wikiResp = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`);
            if (wikiResp.ok) {
                const wiki = await wikiResp.json();
                description = wiki.extract || description;
            }
        } catch (e) {
            // Use default description if Wikipedia fails
        }

        return {
            cid: cid,
            name: props.IUPACName || name,
            formula: props.MolecularFormula || '—',
            weight: props.MolecularWeight ? `${Math.round(props.MolecularWeight)} g/mol` : '—',
            image: imageUrl,
            description: description,
            source: 'PubChem API'
        };
    } catch (err) {
        console.error('API fetch error:', err);
        return null;
    }
}

function displayEvent(eventData, airport) {
    document.getElementById('content-title').textContent = eventData.name || 'Event';
    document.getElementById('content-subtitle').textContent = airport.name || 'Airport';

    const imgElement = document.getElementById('chemical-image');
    imgElement.style.display = 'none';

    if (eventData.money === 0) {
        document.getElementById('content-description').textContent = 'You found a chemical component!';
    } else if (eventData.money > 0) {
        document.getElementById('content-description').textContent = `Positive event: Gained ${eventData.money}€`;
    } else {
        document.getElementById('content-description').textContent = `Negative event: Lost ${Math.abs(eventData.money)}€`;
    }

    document.getElementById('chemical-properties').style.display = 'none';
    document.getElementById('content-location').textContent = `📍 ${airport.name}, ${airport.iso_country}`;
    document.getElementById('content-meta').textContent = `Event: ${eventData.name || 'Unknown'}`;
    document.getElementById('content-display').scrollTop = 0;
}

function displayChemical(chemicalData, airport) {
    document.getElementById('content-title').textContent = chemicalData.name;
    document.getElementById('content-subtitle').textContent = `Chemical Found at ${airport.name}`;

    const imgElement = document.getElementById('chemical-image');
    if (chemicalData.image) {
        imgElement.src = chemicalData.image;
        imgElement.alt = chemicalData.name;
        imgElement.style.display = 'block';
    } else {
        imgElement.style.display = 'none';
    }

    document.getElementById('content-description').textContent = chemicalData.description;

    const props = document.getElementById('chemical-properties');
    props.style.display = 'grid';
    document.getElementById('prop-formula').textContent = chemicalData.formula;
    document.getElementById('prop-weight').textContent = chemicalData.weight;
    document.getElementById('prop-state').textContent = 'Liquid';
    document.getElementById('prop-source').textContent = chemicalData.source;

    document.getElementById('content-location').textContent = `📍 Found at: ${airport.name}`;
    document.getElementById('content-meta').textContent = 'Type: Chemical Component • Added to collection';
    document.getElementById('content-display').scrollTop = 0;
}

function displayAirportInfo(airport) {
    document.getElementById('content-title').textContent = airport.name;
    document.getElementById('content-subtitle').textContent = `${airport.ident} • ${airport.iso_country}`;

    document.getElementById('chemical-image').style.display = 'none';
    document.getElementById('content-description').textContent = `Airport located at coordinates: ${airport.latitude_deg}, ${airport.longitude_deg}`;
    document.getElementById('chemical-properties').style.display = 'none';
    document.getElementById('content-location').textContent = `📍 ${airport.name}`;

    const isVisited = gameState.visitedAirports.includes(airport.ident);
    document.getElementById('content-meta').textContent = isVisited ? '✓ Visited' : '✈️ Destination Available';
    document.getElementById('content-display').scrollTop = 0;
}

function displayWelcomeMessage() {
    document.getElementById('content-title').textContent = 'Welcome to the Lab';
    document.getElementById('content-subtitle').textContent = 'Start your research journey';
    document.getElementById('chemical-image').style.display = 'none';
    document.getElementById('content-description').textContent = 'Begin at an airport. Travel to airports worldwide to collect chemical components to create new aviation fuel. Manage your fuel and budget carefully.';
    document.getElementById('chemical-properties').style.display = 'none';
    document.getElementById('content-location').textContent = '📍 Location: Not started';
    document.getElementById('content-meta').textContent = 'Click "Start New Game" to begin';
    document.getElementById('content-display').scrollTop = 0;
}

async function startNewGame() {
    const researcherName = prompt("Enter your researcher name:", "Dr. Scientist");
    if (!researcherName) return;

    showLoading(true);
    try {
        const gameData = await apiCall('/newgame', {
            player: researcherName,
            loc: 'LSZH'
        });

        if (gameData.error) throw new Error(gameData.error);

        gameState.gameId = gameData.id;
        gameState.researcherName = researcherName;
        gameState.gameStarted = true;
        gameState.visitedAirports = gameData.visited_airports ? gameData.visited_airports.split(',') : [];

        await loadAirports();
        await updateGameState();

        document.getElementById('travel-btn').textContent = "Travel to Destination";
        document.getElementById('travel-btn').disabled = true;
        alert(`Welcome, ${researcherName}! Begin your chemical collection journey.`);
    } catch (error) {
        console.error('Failed to start game:', error);
        alert(`Failed to start game: ${error.message}`);
        displayWelcomeMessage();
    } finally {
        showLoading(false);
    }
}

async function loadAirports() {
    if (!gameState.gameId) return;

    try {
        const data = await apiCall('/airports', { game: gameState.gameId });
        gameState.airports = data.airports || [];
        updateAirportMarkers();
    } catch (error) {
        console.error('Failed to load airports:', error);
        gameState.airports = [];
    }
}

function getAirportIcon(airport) {
    if (gameState.visitedAirports.includes(airport.ident)) {
        return '<div style="background:#00b894;color:white;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border:2px solid #4dabf7;font-size:16px;">✓</div>';
    } else {
        return '<div style="background:#0a1929;color:#4dabf7;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border:2px solid #00b894;font-size:16px;">🧪</div>';
    }
}

function updateAirportMarkers() {
    airportMarkers.clearLayers();

    gameState.airports.forEach(function(airport) {
        if (gameState.currentLocation && gameState.currentLocation.ident === airport.ident) {
            return;
        }

        const icon = L.divIcon({
            html: getAirportIcon(airport),
            className: 'airport-icon',
            iconSize: [36, 36],
            iconAnchor: [18, 18]
        });

        const marker = L.marker(
            [parseFloat(airport.latitude_deg), parseFloat(airport.longitude_deg)],
            { icon: icon, airportId: airport.ident }
        ).addTo(airportMarkers);

        const isVisited = gameState.visitedAirports.includes(airport.ident);
        const popupContent = `
            <div style="min-width:220px;background:#0a1929;color:white;padding:12px;border:2px solid #4dabf7;border-radius:8px;">
                <h3 style="margin:0 0 6px 0;color:#00b894;">${airport.name}</h3>
                <p style="margin:0 0 6px 0;color:#94a3b8;font-size:0.9rem;">${airport.ident} • ${airport.iso_country}</p>
                <p style="margin:0 0 8px 0;color:#cbd5e1;font-weight:bold;">${isVisited ? '✓ Visited' : '⚗️ Unknown Research Site'}</p>
                <p style="margin:0;color:#cbd5e1;font-size:0.85rem;">
                    Coordinates: ${parseFloat(airport.latitude_deg).toFixed(4)}°, ${parseFloat(airport.longitude_deg).toFixed(4)}°
                </p>
            </div>
        `;

        marker.bindPopup(popupContent);
        marker.on('click', function() {
            if (!gameState.gameStarted) {
                alert("Please start the game first");
                return;
            }
            selectDestination(airport.ident);
        });
    });

    if (airportMarkers.getLayers().length > 0) {
        const bounds = airportMarkers.getBounds();
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 5 });
    }
}

async function updateGameState() {
    if (!gameState.gameId) return;

    try {
        const state = await apiCall('/gamestate', { game: gameState.gameId });

        if (state.error) {
            console.error('Error in game state:', state.error);
            return;
        }

        document.getElementById('hud-player').textContent = gameState.researcherName;
        document.getElementById('hud-components').textContent = `${state.chemicals}/5`;
        document.getElementById('hud-budget').textContent = `${state.money}€`;
        document.getElementById('hud-fuel').textContent = `${Math.floor(state.range)} km`;

        if (state.visited_count) {
            gameState.visitedAirports = state.location ? state.location.split(',') : [];
        }

        updateCurrentLocation(state.location);

        if (state.game_over) {
            alert("Game Over! You have no fuel remaining. Please buy fuel to continue.");
            document.getElementById('travel-btn').disabled = true;
        }

        if (state.game_won) {
            showWinScreen(state);
        }
    } catch (error) {
        console.error('Failed to update game state:', error);
    }
}

function updateCurrentLocation(airportIcao) {
    if (!airportIcao) return;

    const airport = gameState.airports.find(function(a) { return a.ident === airportIcao; }) || {
        ident: airportIcao,
        name: airportIcao,
        latitude_deg: 0,
        longitude_deg: 0,
        iso_country: 'Unknown'
    };

    gameState.currentLocation = airport;

    if (currentMarker) {
        map.removeLayer(currentMarker);
    }

    currentMarker = L.marker(
        [parseFloat(airport.latitude_deg) || 0, parseFloat(airport.longitude_deg) || 0],
        {
            icon: L.divIcon({
                html: '<div style="font-size:24px;color:#00b894;filter:drop-shadow(0 0 8px rgba(0,184,148,0.5))">🧪</div>',
                className: 'current-location-icon',
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            })
        }
    ).addTo(map);

    if (parseFloat(airport.latitude_deg) && parseFloat(airport.longitude_deg)) {
        map.setView([parseFloat(airport.latitude_deg), parseFloat(airport.longitude_deg)], 5);
    }
}

function selectDestination(airportIcao) {
    if (!gameState.currentLocation) return;

    const airport = gameState.airports.find(function(a) { return a.ident === airportIcao; });
    if (!airport) {
        alert("Airport not found in game list");
        return;
    }

    if (gameState.currentLocation.ident === airportIcao) {
        alert("You are already at this airport!");
        return;
    }

    gameState.selectedAirport = airport;
    document.getElementById('travel-btn').disabled = false;
    document.getElementById('travel-btn').textContent = `Travel to ${airport.name}`;
    map.setView([parseFloat(airport.latitude_deg), parseFloat(airport.longitude_deg)], 5);
    displayAirportInfo(airport);
}

async function travelToDestination() {
    if (!gameState.selectedAirport || !gameState.gameId) {
        alert("Select a destination airport first.");
        return;
    }

    showLoading(true);
    try {
        const state = await apiCall('/gamestate', { game: gameState.gameId });

        if (state.range <= 0) {
            alert("Game Over! You have no fuel remaining. Please buy fuel to continue.");
            showLoading(false);
            return;
        }

        const result = await apiCall('/travel', {
            game: gameState.gameId,
            dest: gameState.selectedAirport.ident
        });

        if (result.error) throw new Error(result.error);

        if (gameState.travelPath) map.removeLayer(gameState.travelPath);
        if (gameState.currentLocation) {
            gameState.travelPath = L.polyline([
                [parseFloat(gameState.currentLocation.latitude_deg), parseFloat(gameState.currentLocation.longitude_deg)],
                [parseFloat(gameState.selectedAirport.latitude_deg), parseFloat(gameState.selectedAirport.longitude_deg)]
            ], {
                color: '#00b894',
                weight: 3,
                opacity: 0.7,
                dashArray: '5,5'
            }).addTo(map);
        }

        if (!gameState.visitedAirports.includes(gameState.selectedAirport.ident)) {
            gameState.visitedAirports.push(gameState.selectedAirport.ident);
        }

        if (result.last_chemical) {
            const chemicalData = await fetchChemicalData(result.last_chemical);
            if (chemicalData) {
                displayChemical(chemicalData, gameState.selectedAirport);
            } else {
                displayAirportInfo(gameState.selectedAirport);
            }
        } else if (result.last_event) {
            // FIXED PART - Simple beginner solution
            const eventStr = result.last_event;
            let eventName = eventStr;
            let moneyValue = 0;

            // Look for + or - sign in the event string
            if (eventStr.includes('+')) {
                // Positive event - extract the number after +
                const match = eventStr.match(/\+(\d+)/);
                if (match) {
                    moneyValue = parseInt(match[1]);
                    eventName = eventStr.replace(/\(\+\d+€\)/, '').trim();
                }
            } else if (eventStr.includes('-')) {
                // Negative event - extract the number after -
                const match = eventStr.match(/-(\d+)/);
                if (match) {
                    moneyValue = -parseInt(match[1]);
                    eventName = eventStr.replace(/\(-\d+€\)/, '').trim();
                }
            }

            const eventData = {
                name: eventName,
                money: moneyValue
            };
            displayEvent(eventData, gameState.selectedAirport);
        } else {
            displayAirportInfo(gameState.selectedAirport);
        }

        await updateGameState();
        await loadAirports();

        gameState.selectedAirport = null;
        document.getElementById('travel-btn').textContent = "Select Destination";
        document.getElementById('travel-btn').disabled = true;

        setTimeout(function() {
            if (gameState.travelPath) {
                map.removeLayer(gameState.travelPath);
                gameState.travelPath = null;
            }
        }, 3000);

    } catch (error) {
        console.error('Travel failed:', error);

        if (error.message.includes("Insufficient fuel")) {
            alert("Insufficient fuel for this journey. Please buy more fuel or choose a closer airport.");
        } else if (error.message.includes("Game over")) {
            alert("Game Over! You have no fuel remaining. Please buy fuel to continue.");
        } else {
            alert(`Travel failed: ${error.message}`);
        }
    } finally {
        showLoading(false);
    }
}

async function buyFuel() {
    if (!gameState.gameId) {
        alert("Start the game first.");
        return;
    }

    const input = prompt('Enter amount to spend on fuel (1€ = 2 km):', "1000");
    if (!input) return;

    const amount = Math.floor(Number(input));
    if (!Number.isFinite(amount) || amount <= 0) {
        alert("Invalid amount");
        return;
    }

    showLoading(true);
    try {
        const result = await apiCall('/buyfuel', {
            game: gameState.gameId,
            amount: amount
        });

        if (result.error) throw new Error(result.error);

        await updateGameState();
        alert(`Purchased ${amount * 2} km of fuel for ${amount}€`);
    } catch (error) {
        console.error('Fuel purchase failed:', error);
        alert(`Failed to purchase fuel: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

function showWinScreen(state) {
    document.getElementById('win-visited').textContent = state.visited_count || 0;
    // Simple distance calculation
    const visitedCount = state.visited_count || gameState.visitedAirports.length;
    const distance = visitedCount * 1200; // Rough estimate
    document.getElementById('win-distance').textContent = `${distance.toLocaleString()} km`;
    document.getElementById('win-budget').textContent = `${state.money}€`;
    document.getElementById('win-components').textContent = `${state.chemicals}/5`;
    document.getElementById('win-screen').classList.add('active');
}

document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('travel-btn').addEventListener('click', function() {
        if (!gameState.gameStarted) {
            startNewGame();
        } else {
            travelToDestination();
        }
    });

    document.getElementById('buy-fuel-btn').addEventListener('click', buyFuel);
    document.getElementById('close-win').addEventListener('click', function() {
        document.getElementById('win-screen').classList.remove('active');
    });

    displayWelcomeMessage();
});