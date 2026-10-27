import type { Pool } from 'mysql2/promise';

export class FlightRepository {
  constructor(private readonly db: Pool) {}
  async findByRouteAndDate(from: string, to: string, date: string, passengers: number) {
    const [rows] = await this.db.execute<any[]>(
      'SELECT f.*, COALESCE(fi.premium_economy_fare, f.economy_fare) AS premium_economy_fare FROM flights f LEFT JOIN flight_instances fi ON fi.flight_id=f.id WHERE f.departure_code=? AND f.arrival_code=? AND DATE(f.departure_at)=? AND f.seats_available>=? ORDER BY f.departure_at',
      [from, to, date, passengers]
    );
    return rows;
  }
}
