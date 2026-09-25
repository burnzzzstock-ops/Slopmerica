export type FarePolicy = 'free' | 'standard' | 'surge';

export interface TransitStop {
  id: number;
  seg: number;
  s: number;
  side: 1 | -1;
  x: number;
  y: number;
  z: number;
  yaw: number;
  boardings: number;
}

export interface TransitLine {
  id: number;
  name: string;
  color: number;
  stopIds: number[];
  buses: number;
  loopLength: number;
  weeklyRiders: number;
  lastWeekRiders: number;
  busiestStop: number | null;
  active: boolean;
}

export interface TransitSave {
  fare: FarePolicy;
  nextLine: number;
  nextStop: number;
  modeRoll?: number;
  lines: TransitLine[];
  stops: TransitStop[];
}

export interface TransitStats {
  ridersToday: number;
  ridersThisWeek: number;
  divertedCarTrips: number;
  busesCompletedLoops: number;
  servedBuildings: number;
  modeShare: number;
}
