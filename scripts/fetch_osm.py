#!/usr/bin/env python3
"""Fetch OpenStreetMap data for the Jiyugaoka target area via the Overpass API. (rev 2)

Output: data/raw/osm/osm_raw.json (Overpass JSON) + fetch metadata.

Data license: ODbL 1.0 — (c) OpenStreetMap contributors.
The downloaded data and anything derived from it are subject to ODbL.
See ATTRIBUTION.md.

Usage:
    python3 scripts/fetch_osm.py
"""

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# Target area: Jiyugaoka Station +/- 350 m (see docs/area-definition.md)
BBOX = (35.60436, 139.66513, 35.61064, 139.67287)  # S, W, N, E

OVERPASS_INSTANCES = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

QUERY_TEMPLATE = """\
[out:json][timeout:120][bbox:{s},{w},{n},{e}];
(
  way["building"];
  relation["building"];
  way["highway"];
  way["railway"~"^(rail|light_rail|platform)$"];
  way["leisure"~"^(park|garden)$"];
  way["landuse"~"^(grass|forest|village_green|recreation_ground)$"];
  way["natural"="water"];
  way["waterway"];
  node["shop"];
  node["amenity"];
  node["railway"="station"];
);
out body;
>;
out skel qt;
"""

OUT_DIR = Path(__file__).resolve().parent.parent / "data" / "raw" / "osm"
RETRY_DELAYS = [5, 15, 30, 60]


def fetch(url: str, query: str) -> dict:
    data = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={"User-Agent": "jiyugaoka-digital-twin/0.1 (open data pipeline)"},
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        return json.loads(resp.read().decode())


def main() -> int:
    query = QUERY_TEMPLATE.format(s=BBOX[0], w=BBOX[1], n=BBOX[2], e=BBOX[3])
    result = None
    used_instance = None

    for attempt, delay in enumerate([0] + RETRY_DELAYS):
        if delay:
            print(f"retrying in {delay}s ...", file=sys.stderr)
            time.sleep(delay)
        instance = OVERPASS_INSTANCES[attempt % len(OVERPASS_INSTANCES)]
        print(f"fetching from {instance} ...", file=sys.stderr)
        try:
            result = fetch(instance, query)
            used_instance = instance
            break
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            print(f"  failed: {e}", file=sys.stderr)

    if result is None:
        print("ERROR: all Overpass instances failed", file=sys.stderr)
        return 1

    n_elements = len(result.get("elements", []))
    if n_elements < 100:
        print(f"ERROR: suspiciously few elements ({n_elements})", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "osm_raw.json").write_text(json.dumps(result, ensure_ascii=False))
    meta = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "source": "OpenStreetMap via Overpass API",
        "instance": used_instance,
        "license": "ODbL 1.0 — (c) OpenStreetMap contributors — https://www.openstreetmap.org/copyright",
        "bbox_swne": BBOX,
        "query": query,
        "element_count": n_elements,
    }
    (OUT_DIR / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    print(f"OK: {n_elements} elements -> {OUT_DIR / 'osm_raw.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
