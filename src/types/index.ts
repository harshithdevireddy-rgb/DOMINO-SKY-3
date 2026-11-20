// ───────────────────────── Raw dataset (exactly as in flight_network.json) ─────────────────────────
export interface RawAirport { id: string; name: string; city: string; lat: number; lng: number; tier: string; capacity_per_hour: number }
export interface RawFlight {
  flight_id: string; tail_id: string; leg_order: number; origin: string; destination: string;
  dep: string; arr: string; block_minutes: number; pax: number; turnaround_before_min: number | null;
}
export interface RawConnection { connection_id: string; airport: string; from_flight: string; to_flight: string; passengers: number; min_connect_minutes: number }
export interface RawCrew { crew_id: string; tail_id: string; base: string; duty_start: string; max_duty_mins: number; flight_ids: string[] }
export interface RawSpare { tail_id: string; base: string; available_from: string; seats: number }
export interface RawDataset {
  meta: { dataset: string; operating_day: string; min_turnaround_minutes: number; seats_per_aircraft: number; notes: string[] };
  airports: RawAirport[]; flights: RawFlight[]; connections: RawConnection[]; crews: RawCrew[]; spare_aircraft: RawSpare[];
}

// ───────────────────────── Normalised network (numeric minutes since 00:00 IST) ─────────────────────────
export interface Airport { id: string; name: string; city: string; lat: number; lng: number; tier: string; capacityPerHour: number }
export interface FlightDef {
  id: string; tail: string; leg: number; origin: string; dest: string;
  schedDep: number; schedArr: number; block: number; pax: number;
  /** scheduled ground time before this flight (dataset field turnaround_before_min); null for first leg */
  schedTurn: number | null;
}
export interface ConnectionDef { id: string; airport: string; from: string; to: string; pax: number; minConnect: number }
export interface CrewDef { id: string; tail: string; base: string; dutyStart: number; maxDuty: number; flightIds: string[] }
export interface SpareDef { tail: string; base: string; availableFrom: number; seats: number }
export interface Network {
  name: string;
  minTurnaround: number;
  seats: number;
  airports: Airport[];
  airportById: Map<string, Airport>;
  flights: FlightDef[];
  flightById: Map<string, FlightDef>;
  tails: string[];
  /** original rotation per tail, ordered by leg */
  rotations: Map<string, string[]>;
  connections: ConnectionDef[];
  crews: CrewDef[];
  spares: SpareDef[];
  /** minutes between crew report and first scheduled departure (verified constant across dataset) */
  crewReportLead: number;
}

// ───────────────────────── Scenario ─────────────────────────
export interface Closure { airport: string; start: number; end: number }

export type RecoveryAction =
  | { id: string; type: 'cancel_flight'; flightIds: string[]; label?: string }
  | { id: string; type: 'deploy_spare'; spareTail: string; flightIds: string[] }
  | { id: string; type: 'swap_aircraft'; tailA: string; flightA: string; tailB: string; flightB: string }
  | { id: string; type: 'prioritize_flight'; flightId: string }
  | { id: string; type: 'protect_connection'; connectionId: string };

export interface Scenario {
  closures: Closure[];
  actions: RecoveryAction[];
  /** optional per-airport capacity (movements/hour) overriding the dataset */
  capacityOverrides?: Record<string, number>;
}

// ───────────────────────── Results ─────────────────────────
export type FlightStatus = 'on_time' | 'delayed' | 'severe' | 'cancelled';
export type CauseKind =
  | 'NONE' | 'CLOSURE_DEPARTURE' | 'CLOSURE_ARRIVAL_GROUND_HOLD' | 'CLOSURE_AIRBORNE_HOLD'
  | 'ROTATION' | 'CAPACITY' | 'CONNECTION_HOLD' | 'RECOVERY_CANCEL';

export interface Binding { kind: 'SCHEDULE' | 'ROTATION' | 'SPARE_AVAILABILITY' | 'CLOSURE_DEPARTURE' | 'CLOSURE_ARRIVAL_GROUND_HOLD' | 'CAPACITY' | 'CONNECTION_HOLD'; from?: string; airport?: string; connectionId?: string }
export interface Cause { kind: CauseKind; minutes: number; text: string; airport?: string; sourceFlight?: string }

export interface FlightResult {
  id: string;
  tail: string;            // aircraft that actually operates (after recovery)
  scheduledTail: string;   // dataset tail
  cancelled: boolean;
  schedDep: number; schedArr: number;
  actualDep: number | null; actualArr: number | null;
  depDelay: number; arrDelay: number; airborneHold: number;
  status: FlightStatus;
  binding: Binding;
  predecessor: string | null;      // previous operated flight of the same aircraft
  /** true if this flight now operates on a different aircraft than scheduled */
  reassigned: boolean;
  crewId: string | null;
  causes: Cause[];
  primaryCause: CauseKind;
  /** slack (minutes) between actual earliest-ready time and scheduled departure, i.e. buffer that absorbed inbound delay */
  absorbed: number;
}

export type ConnectionStatus = 'made' | 'missed' | 'from_cancelled' | 'to_cancelled';
export interface ConnectionResult {
  id: string; airport: string; from: string; to: string; pax: number; minConnect: number;
  scheduledTransfer: number;
  actualArr: number | null; actualDep: number | null; transfer: number | null;
  status: ConnectionStatus; held: boolean;
}

export interface CrewResult {
  crewId: string; tail: string; base: string; standby: boolean;
  dutyStart: number; lastArr: number | null; dutyMinutes: number; maxDuty: number; excess: number; violation: boolean;
  flights: string[]; flightsAffected: string[]; flightsBeyondLimit: string[];
}

export interface PaxAccounting {
  /** distinct passengers = Σ flight pax − Σ connection pax (connecting pax occupy a seat on two flights) */
  distinct: number;
  onTime: number; delayed: number; cancelled: number; missedConnection: number;
  stranded: number;   // cancelled + missedConnection
  impacted: number;   // delayed + cancelled + missedConnection
  /** seat-based figure: Σ pax of operated delayed flights (connecting pax counted per segment) */
  seatsOnDelayedFlights: number;
  seatsOnCancelledFlights: number;
  /** Σ delay minutes × passengers over distinct passenger groups */
  paxDelayMinutes: number;
}

export interface Metrics {
  totalFlights: number; operated: number; onTime: number; delayed: number; severe: number; cancelled: number;
  totalDelayMinutes: number; totalDepDelayMinutes: number; maxDelay: number;
  aircraftAffected: number; airportsAffected: number;
  pax: PaxAccounting;
  brokenConnections: number; connectionsTotal: number; missedConnectionPax: number;
  crewViolations: number; crewExcessMinutes: number;
  cost: number;
  status: NetworkStatus;
}
export type NetworkStatus = 'NORMAL' | 'MINOR' | 'MAJOR' | 'CRITICAL';

export interface AirportImpact {
  id: string; incoming: number; outgoing: number; affectedFlights: number; affectedPax: number;
  delayMinutes: number; closed: boolean; status: 'normal' | 'affected' | 'closed';
}

export interface RejectedAction { actionId: string; reason: string }

export interface SimulationResult {
  scenario: Scenario;
  flights: FlightResult[];
  flightById: Map<string, FlightResult>;
  connections: ConnectionResult[];
  crews: CrewResult[];
  airports: AirportImpact[];
  metrics: Metrics;
  /** chronological computed events (used by the timeline / replay) */
  events: SimEvent[];
  /** tail → ordered operated flight ids */
  sequences: Map<string, string[]>;
  rejectedActions: RejectedAction[];
}

export type SimEventKind = 'closure_start' | 'closure_end' | 'departure' | 'arrival' | 'cancellation' | 'recovery';
export interface SimEvent { time: number; kind: SimEventKind; flightId?: string; airport?: string; tail?: string; delay?: number; text: string }

export class ActionError extends Error {
  constructor(public actionId: string, message: string) { super(message); this.name = 'ActionError'; }
}
export class SimulationError extends Error { constructor(message: string) { super(message); this.name = 'SimulationError'; } }
