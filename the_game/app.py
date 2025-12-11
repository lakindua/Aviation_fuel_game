from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import config
from game import Game
import mysql.connector
import os

app = Flask(__name__)
CORS(app)


def get_db_connection():
    """Get or create database connection"""
    if config.conn is None or not config.conn.is_connected():
        try:
            config.conn = mysql.connector.connect(
                host='127.0.0.1',
                port=3306,
                database='Aviation_fuel',
                user='root',
                password='12345',
                autocommit=True
            )
        except mysql.connector.Error as err:
            print(f"Database connection error: {err}")
            config.conn = None
    return config.conn


@app.route('/')
def serve_index():
    """Serve main page"""
    return send_file('index.html')


@app.route('/<path:filename>')
def serve_file(filename):
    """Serve static files"""
    if os.path.exists(filename):
        return send_file(filename)
    return f"File {filename} not found", 404


@app.route('/newgame')
def new_game():
    """Start new game"""
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500

    try:
        player = request.args.get('player', 'Researcher')
        location = request.args.get('loc', 'LSZH')

        game = Game(0, location, 0, player)
        return jsonify(game.status)
    except Exception as e:
        print(f"Error in new_game: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/travel')
def travel():
    """Travel to destination"""
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500

    try:
        game_id = request.args.get('game')
        dest = request.args.get('dest')

        if not game_id or not dest:
            return jsonify({'error': 'Missing parameters'}), 400

        from airport import Airport

        # Get current location
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT location FROM game WHERE id = %s", (game_id,))
        result = cursor.fetchone()

        if not result:
            return jsonify({'error': 'Game not found'}), 404

        current_icao = result['location']
        current_airport = Airport(current_icao)
        dest_airport = Airport(dest)
        distance = current_airport.distance_to(dest_airport)

        # Process travel
        game = Game(game_id, dest, distance)

        # Build response
        response = game.status.copy()

        # Safely add nearby airports
        if hasattr(game, 'nearby_airports'):
            response['nearby_airports'] = []
            for ap in game.nearby_airports:
                if hasattr(ap, 'ident') and hasattr(ap, 'name'):
                    response['nearby_airports'].append({
                        'ident': ap.ident,
                        'name': ap.name,
                        'country': getattr(ap, 'country', ''),
                        'distance': getattr(ap, 'distance', 0)
                    })

        return jsonify(response)
    except KeyError as e:
        print(f"Missing parameter: {e}")
        return jsonify({'error': f'Missing parameter: {str(e)}'}), 400
    except Exception as e:
        print(f"Error in travel: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/buyfuel')
def buy_fuel():
    """Purchase fuel"""
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500

    try:
        game_id = request.args.get('game')
        amount = float(request.args.get('amount', 0))

        if not game_id:
            return jsonify({'error': 'Missing game ID'}), 400

        game = Game(game_id, "", 0, None, amount)
        return jsonify(game.status)
    except ValueError:
        return jsonify({'error': 'Invalid amount format'}), 400
    except Exception as e:
        print(f"Error in buy_fuel: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/gamestate')
def game_state():
    """Get current game state"""
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500

    try:
        game_id = request.args.get('game')

        if not game_id:
            return jsonify({'error': 'Missing game ID'}), 400

        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
                       SELECT id,
                              money,
                              player_range,
                              location,
                              screen_name,
                              chemicals,
                              COALESCE(visited_airports, '') as visited_airports
                       FROM game
                       WHERE id = %s
                       """, (game_id,))
        result = cursor.fetchone()

        if not result:
            return jsonify({'error': 'Game not found'}), 404

        visited = result['visited_airports'].split(',') if result['visited_airports'] else []
        visited = [v.strip() for v in visited if v.strip()]

        return jsonify({
            "id": result['id'],
            "name": result['screen_name'],
            "money": result['money'],
            "range": result['player_range'],
            "chemicals": result['chemicals'],
            "location": result['location'],
            "visited_count": len(visited),
            "game_over": result['player_range'] <= 0,
            "game_won": result['chemicals'] >= config.REQUIRED_CHEMICALS
        })
    except Exception as e:
        print(f"Error in game_state: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/frontend/init')
def frontend_init():
    """Provide initial game config to frontend"""
    return jsonify({
        "startBudget": config.START_BUDGET,
        "startFuel": config.START_FUEL_RANGE,
        "requiredChemicals": config.REQUIRED_CHEMICALS,
        "fuelRate": config.FUEL_RATE
    })


@app.route('/airports')
def get_airports():
    """Get airports with events"""
    conn = get_db_connection()
    if not conn:
        return jsonify({'error': 'Database connection failed'}), 500

    try:
        game_id = request.args.get('game')

        if not game_id:
            return jsonify({'error': 'Missing game ID'}), 400

        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
                       SELECT a.ident,
                              a.name,
                              a.latitude_deg,
                              a.longitude_deg,
                              a.iso_country,
                              e.name as event_name,
                              e.money
                       FROM airport a
                                JOIN events_reached er ON a.ident = er.airport AND er.game = %s
                                JOIN events e ON er.goal = e.id
                       WHERE a.type IN ('large_airport', 'medium_airport')
                       ORDER BY a.name
                       """, (game_id,))

        airports = cursor.fetchall()
        return jsonify({'airports': airports if airports else []})
    except Exception as e:
        print(f"Error in get_airports: {e}")
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000, host='0.0.0.0')
