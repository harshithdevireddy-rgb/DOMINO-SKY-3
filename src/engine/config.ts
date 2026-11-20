/** Tunable, documented constants of the simulation model. */
export const CONFIG = {
  /** A flight counts as "delayed" when its arrival delay is at least this many minutes. */
  delayThreshold: 1,
  /** A delayed flight is "severe" at or above this arrival delay. */
  severeThreshold: 60,
  /** A recovery connection-hold longer than this is rejected as operationally unacceptable. */
  maxConnectionHold: 90,
  /** Hard stop for the departure fixed-point loop (guards against bugs, never reached in practice). */
  maxFixedPointIterations: 2000,
  /** Standby crew (for deployed spares) uses the same max duty as the tightest dataset crew. */
  /** Objective used by the rule-based dispatcher (documented in README). */
  cost: {
    /** passenger-minutes of delay, 1:1 */
    paxDelayMinute: 1,
    /** one stranded passenger (cancelled / missed connection, no same-day rebooking) ≙ 120 passenger-minutes */
    strandedPax: 120,
    /** a crew duty-limit breach is a regulatory event */
    crewViolation: 20000,
    crewExcessMinute: 50,
  },
  /** Network status thresholds (share of flights delayed or cancelled). */
  status: { minorMax: 0.10, majorMax: 0.25, criticalCrewViolations: 2, majorSevere: 3 },
} as const;
