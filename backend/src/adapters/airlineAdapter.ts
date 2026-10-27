
export type FlightOffer = {
  id: string;
  airline: string;
  flightNumber: string;
  departureAirport: string;
  arrivalAirport: string;
  departureAt: string;
  arrivalAt: string;
  currency: string;
  total: number;
  stops: number;
  source: 'amadeus' | 'duffel' | 'mock';
};

export interface AirlineAdapter {
  search(input: {
    origin: string;
    destination: string;
    date: string;
    adults: number;
    cabin?: string;
    returnDate?: string;
  }): Promise<{
    provider: string;
    offers: FlightOffer[];
    dictionaries?: unknown;
  }>;

  status?(flightNumber: string, date?: string):
    Promise<Record<string, unknown>>;
}

type SearchInput = {
  origin: string;
  destination: string;
  date: string;
  adults: number;
  cabin?: string;
  returnDate?: string;
};

class MockAirlineAdapter implements AirlineAdapter {
  async search(input: SearchInput) {
    const base =
      4200 +
      (input.origin.charCodeAt(0) +
        input.destination.charCodeAt(0)) * 13;

    const offers: FlightOffer[] = [
      {
        id: 'MOCK-1',
        airline: 'SkyMate Demo Air',
        flightNumber: 'SM101',
        departureAirport: input.origin.toUpperCase(),
        arrivalAirport: input.destination.toUpperCase(),
        departureAt: `${input.date}T08:00:00`,
        arrivalAt: `${input.date}T10:45:00`,
        currency: 'INR',
        total: base * input.adults,
        stops: 0,
        source: 'mock',
      },
      {
        id: 'MOCK-2',
        airline: 'Demo Connect',
        flightNumber: 'DC208',
        departureAirport: input.origin.toUpperCase(),
        arrivalAirport: input.destination.toUpperCase(),
        departureAt: `${input.date}T13:30:00`,
        arrivalAt: `${input.date}T17:15:00`,
        currency: 'INR',
        total: (base - 700) * input.adults,
        stops: 1,
        source: 'mock',
      },
    ];

    return { provider: 'mock', offers };
  }
}

class AmadeusAdapter implements AirlineAdapter {
  private token?: string;
  private tokenExpiresAt = 0;

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - 30000) {
      return this.token;
    }

    const id = process.env.AMADEUS_CLIENT_ID;
    const secret = process.env.AMADEUS_CLIENT_SECRET;

    if (!id || !secret) {
      throw new Error(
        'Amadeus requires AMADEUS_CLIENT_ID and AMADEUS_CLIENT_SECRET.'
      );
    }

    const base = (
      process.env.AMADEUS_BASE_URL ||
      'https://test.api.amadeus.com'
    ).replace(/\/+$/, '');

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: id,
      client_secret: secret,
    });

    const response = await fetch(
      `${base}/v1/security/oauth2/token`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Amadeus token request failed (${response.status}).`
      );
    }

    const data = await response.json() as {
      access_token: string;
      expires_in: number;
    };

    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;

    return this.token;
  }

  async search(input: SearchInput) {
    const base = (
      process.env.AMADEUS_BASE_URL ||
      'https://test.api.amadeus.com'
    ).replace(/\/+$/, '');

    const token = await this.accessToken();

    const params = new URLSearchParams({
      originLocationCode: input.origin.toUpperCase(),
      destinationLocationCode: input.destination.toUpperCase(),
      departureDate: input.date,
      adults: String(input.adults),
      currencyCode: 'INR',
      max: '12',
    });

    const cabinMap: Record<string, string> = {
      economy: 'ECONOMY',
      premium_economy: 'PREMIUM_ECONOMY',
      business: 'BUSINESS',
      first: 'FIRST',
    };

    if (input.cabin && cabinMap[input.cabin.toLowerCase()]) {
      params.set('travelClass', cabinMap[input.cabin.toLowerCase()]);
    }

    if (input.returnDate) {
      params.set('returnDate', input.returnDate);
    }

    const response = await fetch(
      `${base}/v2/shopping/flight-offers?${params}`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Amadeus flight search failed (${response.status}).`
      );
    }

    const raw = await response.json() as any;
    const carriers = raw.dictionaries?.carriers || {};

    const offers: FlightOffer[] = (raw.data || []).map((o: any) => {
      const segments = o.itineraries?.[0]?.segments || [];
      const first = segments[0];
      const last = segments[segments.length - 1];

      return {
        id: String(o.id),
        airline:
          carriers[first?.carrierCode] ||
          first?.carrierCode ||
          'Airline',
        flightNumber:
          `${first?.carrierCode || ''}${first?.number || ''}`,
        departureAirport:
          first?.departure?.iataCode || input.origin.toUpperCase(),
        arrivalAirport:
          last?.arrival?.iataCode || input.destination.toUpperCase(),
        departureAt: first?.departure?.at || '',
        arrivalAt: last?.arrival?.at || '',
        currency: o.price?.currency || 'INR',
        total: Number(o.price?.grandTotal || o.price?.total || 0),
        stops: Math.max(0, segments.length - 1),
        source: 'amadeus',
      };
    });

    return {
      provider: 'amadeus-test-api',
      offers,
      dictionaries: raw.dictionaries,
    };
  }
}

class DuffelAdapter implements AirlineAdapter {
  async search(input: SearchInput) {
    const token = process.env.DUFFEL_ACCESS_TOKEN;

    if (!token) {
      throw new Error(
        'Duffel requires the DUFFEL_ACCESS_TOKEN environment variable.'
      );
    }

    const cabinMap: Record<string, string> = {
      economy: 'economy',
      premium_economy: 'premium_economy',
      business: 'business',
      first: 'first',
    };

    const slices: Array<Record<string, string>> = [
      {
        origin: input.origin.toUpperCase(),
        destination: input.destination.toUpperCase(),
        departure_date: input.date,
      },
    ];

    if (input.returnDate) {
      slices.push({
        origin: input.destination.toUpperCase(),
        destination: input.origin.toUpperCase(),
        departure_date: input.returnDate,
      });
    }

    const passengerCount = Math.max(
      1,
      Math.floor(input.adults)
    );

    const body = {
      data: {
        slices,
        passengers: Array.from(
          { length: passengerCount },
          () => ({ type: 'adult' })
        ),
        cabin_class:
          cabinMap[(input.cabin || 'economy').toLowerCase()] ||
          'economy',
      },
    };

    const response = await fetch(
      'https://api.duffel.com/air/offer_requests',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Duffel-Version': 'v2',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      }
    );

    if (!response.ok) {
      const detail = await response.text();

      throw new Error(
        `Duffel flight search failed (${response.status}): ` +
        detail.slice(0, 500)
      );
    }

    const result = await response.json() as any;
    const rawOffers = result.data?.offers || [];

    const offers: FlightOffer[] = rawOffers.map((offer: any) => {
      // This UI model currently represents the outbound itinerary.
      const segments = offer.slices?.[0]?.segments || [];
      const first = segments[0];
      const last = segments[segments.length - 1];

      return {
        id: String(offer.id),
        airline:
          offer.owner?.name ||
          offer.owner?.iata_code ||
          'Airline',
        flightNumber:
          first?.marketing_carrier_flight_number ||
          first?.operating_carrier_flight_number ||
          offer.id,
        departureAirport:
          first?.origin?.iata_code ||
          input.origin.toUpperCase(),
        arrivalAirport:
          last?.destination?.iata_code ||
          input.destination.toUpperCase(),
        departureAt: first?.departing_at || '',
        arrivalAt: last?.arriving_at || '',
        currency: offer.total_currency || 'USD',
        total: Number(offer.total_amount || 0),
        stops: Math.max(0, segments.length - 1),
        source: 'duffel',
      };
    });

    return {
      provider: 'duffel-test-api',
      offers,
    };
  }
}

export function createAirlineAdapter(): AirlineAdapter {
  const provider = (
    process.env.AIRLINE_PROVIDER || 'mock'
  ).toLowerCase();

  switch (provider) {
    case 'amadeus':
      return new AmadeusAdapter();

    case 'duffel':
      return new DuffelAdapter();

    case 'mock':
      return new MockAirlineAdapter();

    default:
      throw new Error(
        `Unsupported AIRLINE_PROVIDER: ${provider}`
      );
  }
}
