import string
import random
from airport import Airport
import config

class Game:
    def __init__(self, game_id, location, distance=0, player=None, buy_fuel=0):
        self.status = {}
        self.location = None
        self.nearby_airports = []

        if config.conn is None:
            raise Exception("Database connection not initialized")

        cursor = config.conn.cursor(dictionary=True)

        if game_id == 0:
            # NEW GAME
            game_uuid = ''.join(random.choices(string.ascii_letters + string.digits, k=20))

            self.status = {
                "id": game_uuid,
                "name": player,
                "money": config.START_BUDGET,
                "range": config.START_FUEL_RANGE,
                "chemicals": 0,
                "location": location,
                "visited_airports": location
            }

            # Insert into database
            sql = """INSERT INTO game (id, money, player_range, location, screen_name, chemicals, visited_airports)
                     VALUES (%s, %s, %s, %s, %s, %s, %s)"""
            cursor.execute(sql, (
                game_uuid, config.START_BUDGET, config.START_FUEL_RANGE,
                location, player, 0, location
            ))

            # Assign events
            self.assign_events(game_uuid, location)

        else:
            # EXISTING GAME
            if buy_fuel > 0:
                # Purchase fuel
                sql = """UPDATE game 
                         SET money = money - %s,
                             player_range = player_range + (%s * %s)
                         WHERE id = %s"""
                cursor.execute(sql, (buy_fuel, buy_fuel, config.FUEL_RATE, game_id))

            elif distance > 0:
                # Check fuel
                cursor.execute("SELECT player_range FROM game WHERE id = %s", (game_id,))
                result = cursor.fetchone()

                if not result:
                    raise Exception("Game not found")

                current_range = result['player_range']

                if current_range <= 0:
                    raise Exception("No fuel remaining")

                if distance > current_range:
                    raise Exception(f"Insufficient fuel! Need {distance}km, have {current_range}km")

                # Update location and visited airports
                cursor.execute("SELECT visited_airports FROM game WHERE id = %s", (game_id,))
                result = cursor.fetchone()
                visited = result['visited_airports'] if result and result['visited_airports'] else ""

                new_visited = f"{visited},{location}" if visited else location

                sql = """UPDATE game 
                         SET player_range = player_range - %s,
                             location = %s,
                             visited_airports = %s
                         WHERE id = %s"""
                cursor.execute(sql, (distance, location, new_visited, game_id))

            # Load game state
            sql = """SELECT id,money,player_range,location,screen_name,chemicals,
                            COALESCE(visited_airports, '') as visited_airports
                     FROM game WHERE id = %s"""
            cursor.execute(sql, (game_id,))
            result = cursor.fetchone()

            if not result:
                raise Exception("Game not found")

            self.status = {
                "id": result['id'],
                "name": result['screen_name'],
                "money": result['money'],
                "range": result['player_range'],
                "chemicals": result['chemicals'],
                "location": result['location'],
                "visited_airports": result['visited_airports']
            }

            # Check for event
            if location:
                self.check_event(game_id, location)

        # Set current location
        try:
            if location:
                self.location = Airport(location, True)
        except Exception as e:
            print(f"Warning: Could not create airport for {location}: {e}")
            self.location = None

        # Get nearby airports if has fuel
        if self.location and self.status.get("range", 0) > 0:
            try:
                self.nearby_airports = self.location.find_nearby_airports(self.status["range"])
            except Exception as e:
                print(f"Warning: Could not find nearby airports: {e}")
                self.nearby_airports = []

        # Check win condition
        self.status["game_won"] = self.status.get("chemicals", 0) >= config.REQUIRED_CHEMICALS

        config.conn.commit()

    def assign_events(self, game_id, start_airport):
        """Assign events to random airports"""
        cursor = config.conn.cursor(dictionary=True)

        # Get chemical events
        cursor.execute("SELECT id FROM events WHERE money = 0 LIMIT %s", (config.CHEMICAL_EVENTS,))
        chemical_events = cursor.fetchall()

        # Get money events
        cursor.execute("SELECT id, money FROM events WHERE money != 0 LIMIT %s", (config.OTHER_EVENTS,))
        money_events = cursor.fetchall()

        # Get random airports (excluding start)
        cursor.execute("""
            SELECT ident FROM airport 
            WHERE type IN ('large_airport', 'medium_airport') AND ident != %s
            ORDER BY RAND() LIMIT %s
        """, (start_airport, config.TOTAL_AIRPORTS))
        airports = cursor.fetchall()

        # Assign events
        for i in range(min(len(airports), config.TOTAL_AIRPORTS)):
            if i < len(chemical_events):
                event_id = chemical_events[i]['id']
            else:
                idx = (i - config.CHEMICAL_EVENTS) % len(money_events)
                event_id = money_events[idx]['id'] if idx < len(money_events) else None

            if event_id:
                cursor.execute(
                    "INSERT INTO events_reached (game, airport, goal) VALUES (%s, %s, %s)",
                    (game_id, airports[i]['ident'], event_id)
                )

    def check_event(self, game_id, airport_icao):
        """Check and process event at current airport"""
        cursor = config.conn.cursor(dictionary=True)

        sql = """SELECT e.name, e.money
                 FROM events_reached er
                 JOIN events e ON er.goal = e.id
                 WHERE er.game = %s AND er.airport = %s"""
        cursor.execute(sql, (game_id, airport_icao))
        event = cursor.fetchone()

        if event:
            if event['money'] == 0:
                # Chemical event
                new_chemicals = self.status.get("chemicals", 0) + 1
                self.status["chemicals"] = new_chemicals
                cursor.execute("UPDATE game SET chemicals = %s WHERE id = %s",
                             (new_chemicals, game_id))
                self.status["last_chemical"] = event['name']
            else:
                # Money event
                new_money = max(0, self.status.get("money", 0) + event['money'])
                self.status["money"] = new_money
                cursor.execute("UPDATE game SET money = %s WHERE id = %s",
                             (new_money, game_id))

                sign = "+" if event['money'] > 0 else ""
                self.status["last_event"] = f"{event['name']} ({sign}{event['money']}€)"

            # Remove event
            cursor.execute("DELETE FROM events_reached WHERE game = %s AND airport = %s",
                         (game_id, airport_icao))
            return True

        return False