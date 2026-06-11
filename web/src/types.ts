export type Pt = [number, number]; // local meters: [x (east), z (south)]

export interface Building {
  f: Pt[]; // footprint (open ring)
  h: number; // height in meters
  lv?: number;
  n?: string;
  t?: string; // OSM building=* value
}

export interface Road {
  p: Pt[];
  w: number; // width in meters
  t: string; // OSM highway=* value
  n?: string; // street name (when tagged in OSM)
  b?: number; // bridge flag
  ly?: number; // OSM layer
}

export interface Rail {
  p: Pt[];
  el: number; // elevation in meters (0 = ground)
  n?: string;
}

export interface PlatformArea {
  f: Pt[];
  el: number;
}

export interface Area {
  f: Pt[];
}

export interface Poi {
  x: number;
  z: number;
  t: string;
  n?: string;
}

export interface CityData {
  meta: Record<string, unknown>;
  buildings: Building[];
  roads: Road[];
  rails: Rail[];
  platforms: PlatformArea[];
  green: Area[];
  water: Area[];
  pois: Poi[];
}
