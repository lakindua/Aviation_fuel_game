import config
from geopy import distance


class Airport:
    def __init__(self, ident, active=False, data=None):
        self.ident = ident
        self.active = active

        # Default values
        self.name = ident
        self.latitude = 0.0
        self.longitude = 0.0
        self.country = ''
        self.continent = ''
        self.type = ''

        if data is None:
            try:
                cursor = config.conn.cursor(dictionary=True)
                cursor.execute("""
                               SELECT ident,
                                      name,
                                      latitude_deg,
                                      longitude_deg,
                                      iso_country,
                                      continent,
                                      type
                               FROM airport
                               WHERE ident = %s
                               """, (ident,))
                data = cursor.fetchone()
            except Exception as e:
                print(f"Warning: Could not fetch airport {ident}: {e}")
                data = None

        if data:
            self.name = data.get('name', ident)
            try:
                self.latitude = float(data.get('latitude_deg', 0))
                self.longitude = float(data.get('longitude_deg', 0))
            except (ValueError, TypeError):
                self.latitude = 0.0
                self.longitude = 0.0
            self.country = data.get('iso_country', '')
            self.continent = data.get('continent', '')
            self.type = data.get('type', '')

    def distance_to(self, target_airport):
        """Calculate distance in km"""
        try:
            if not target_airport:
                return 0
            return int(distance.distance(
                (self.latitude, self.longitude),
                (target_airport.latitude, target_airport.longitude)
            ).km)
        except Exception as e:
            print(f"Warning: Distance calculation failed: {e}")
            return 0

    def find_nearby_airports(self, player_range):
        """Find airports within range"""
        nearby = []

        if not player_range or player_range <= 0:
            return nearby

        try:
            cursor = config.conn.cursor(dictionary=True)
            cursor.execute("""
                           SELECT ident,
                                  name,
                                  latitude_deg,
                                  longitude_deg,
                                  iso_country,
                                  continent,
                                  type
                           FROM airport
                           WHERE latitude_deg BETWEEN %s AND %s
                             AND longitude_deg BETWEEN %s AND %s
                             AND type IN ('large_airport', 'medium_airport')
                             AND ident != %s
                           """, (
                               self.latitude - 5, self.latitude + 5,
                               self.longitude - 5, self.longitude + 5,
                               self.ident
                           ))

            for row in cursor.fetchall():
                try:
                    airport = Airport(row['ident'], False, row)
                    dist = self.distance_to(airport)

                    if 0 < dist <= player_range:
                        airport.distance = dist
                        nearby.append(airport)
                except Exception as e:
                    print(f"Warning: Could not process airport {row.get('ident', 'unknown')}: {e}")
                    continue

        except Exception as e:
            print(f"Warning: Failed to find nearby airports: {e}")

        return nearby