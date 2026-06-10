#!/usr/bin/env python3
"""Fetch PLATEAU CityGML building data (LOD1) for the Jiyugaoka target meshes.

Discovers the Tokyo 23-ku CityGML distribution on G空間情報センター (CKAN),
downloads the relevant archive, extracts the bldg GML files for meshes
53393523 / 53393533, and parses LOD1 footprints + measured heights into
data/processed/plateau_buildings.json (WGS84 rings; projection happens in
process_osm.mjs).

Source: 国土交通省 Project PLATEAU「東京都23区 3D都市モデル」
License: 政府標準利用規約2.0 (CC BY 4.0 compatible) — attribution required.

Intended to run on GitHub Actions (needs open internet + disk).
"""

import io
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from math import cos, hypot, radians
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "processed" / "plateau_buildings.json"
TMP = Path("/tmp/plateau")

TARGET_MESHES = ("53393523", "53393533")
SECONDARY_MESH = "533935"
CENTER = (35.6075, 139.6690)
CLIP_M = 400.0

CKAN_BASE = "https://www.geospatial.jp/ckan/api/3/action/package_show?id="
CANDIDATE_PACKAGES = [
    "plateau-tokyo23ku",
    "plateau-tokyo23ku-citygml-2023",
    "plateau-tokyo23ku-citygml-2022",
    "plateau-tokyo23ku-citygml-2020",
]

NS_GML = "http://www.opengis.net/gml"
NS_BLDG_2 = "http://www.opengis.net/citygml/building/2.0"
NS_BLDG_1 = "http://www.opengis.net/citygml/building/1.0"


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "jiyugaoka-digital-twin/0.1"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


def discover_resources() -> list[dict]:
    resources = []
    for pkg in CANDIDATE_PACKAGES:
        try:
            data = get_json(CKAN_BASE + pkg)
            if data.get("success"):
                rs = data["result"].get("resources", [])
                log(f"package {pkg}: {len(rs)} resources")
                for r in rs:
                    log(f"  - {r.get('name')!r} fmt={r.get('format')} size={r.get('size')} url={r.get('url')}")
                    resources.append(r)
        except Exception as e:
            log(f"package {pkg}: {e}")
    return resources


def pick_archives(resources: list[dict]) -> list[dict]:
    """Prefer per-secondary-mesh archives; fall back to whole-city CityGML."""
    def is_zip(r):
        return ".zip" in str(r.get("url", "")).lower()

    by_mesh = [r for r in resources if is_zip(r) and SECONDARY_MESH in (str(r.get("name", "")) + str(r.get("url", "")))]
    if by_mesh:
        log(f"picked {len(by_mesh)} mesh-level archive(s)")
        return by_mesh[:2]

    citygml = [
        r for r in resources
        if is_zip(r) and re.search(r"citygml", str(r.get("name", "")) + str(r.get("url", "")), re.I)
    ]
    if citygml:
        # prefer ones that look like the operational release
        citygml.sort(key=lambda r: (0 if "op" in str(r.get("url", "")).lower() else 1, len(str(r.get("url", "")))))
        log(f"picked whole-city CityGML archive: {citygml[0].get('url')}")
        return citygml[:1]

    log("ERROR: no candidate archive found; see resource list above")
    return []


def download(url: str, dest: Path) -> None:
    log(f"downloading {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "jiyugaoka-digital-twin/0.1"})
    with urllib.request.urlopen(req, timeout=300) as r, open(dest, "wb") as f:
        total = 0
        while chunk := r.read(1 << 20):
            f.write(chunk)
            total += len(chunk)
            if total % (200 << 20) < (1 << 20):
                log(f"  {total >> 20} MB ...")
    log(f"  done: {dest.stat().st_size >> 20} MB")


def gml_members(zf: zipfile.ZipFile) -> list[str]:
    pat = re.compile(r"(^|/)bldg/.*(" + "|".join(TARGET_MESHES) + r").*\.gml$")
    return [n for n in zf.namelist() if pat.search(n)]


def nested_zip_members(zf: zipfile.ZipFile) -> list[str]:
    """Some distributions nest per-ward/per-mesh zips inside the archive."""
    pat = re.compile(r"\.zip$", re.I)
    return [n for n in zf.namelist() if pat.search(n)]


def parse_poslist(text: str) -> list[tuple[float, float, float]]:
    vals = [float(v) for v in text.split()]
    return [(vals[i], vals[i + 1], vals[i + 2] if len(vals) % 3 == 0 else 0.0)
            for i in range(0, len(vals) - 2, 3)]


def local_m(lat: float, lon: float) -> tuple[float, float]:
    dy = (lat - CENTER[0]) * 111320.0
    dx = (lon - CENTER[1]) * 111320.0 * cos(radians(CENTER[0]))
    return dx, dy


def parse_buildings(data: bytes, out: list[dict]) -> int:
    count = 0
    bldg_tags = {f"{{{NS_BLDG_2}}}Building", f"{{{NS_BLDG_1}}}Building"}
    context = ET.iterparse(io.BytesIO(data), events=("end",))
    for _event, elem in context:
        if elem.tag not in bldg_tags:
            continue
        ns_b = elem.tag[1:].split("}")[0]
        height = None
        ht = elem.find(f".//{{{ns_b}}}measuredHeight")
        if ht is not None and ht.text:
            try:
                height = float(ht.text)
            except ValueError:
                height = None

        ring: list[tuple[float, float]] | None = None
        # prefer LOD0 roof edge / footprint (same shape as the LOD1 prism)
        for tag in ("lod0RoofEdge", "lod0FootPrint"):
            el = elem.find(f".//{{{ns_b}}}{tag}")
            if el is not None:
                pl = el.find(f".//{{{NS_GML}}}posList")
                if pl is not None and pl.text:
                    ring = [(p[0], p[1]) for p in parse_poslist(pl.text)]
                    break
        zmin = zmax = None
        if ring is None or height is None:
            polys = []
            for pl in elem.findall(f".//{{{NS_GML}}}posList"):
                if pl.text:
                    polys.append(parse_poslist(pl.text))
            if polys:
                zs = [p[2] for poly in polys for p in poly]
                zmin, zmax = min(zs), max(zs)
                if ring is None:
                    for poly in polys:
                        if all(abs(p[2] - zmin) < 0.05 for p in poly):
                            ring = [(p[0], p[1]) for p in poly]
                            break
        if height is None and zmin is not None and zmax is not None:
            height = zmax - zmin

        if ring and len(ring) >= 4 and height and height > 1.5:
            if ring[0] == ring[-1]:
                ring = ring[:-1]
            cx = sum(p[0] for p in ring) / len(ring)
            cy = sum(p[1] for p in ring) / len(ring)
            if hypot(*local_m(cx, cy)) <= CLIP_M:
                out.append({
                    "ring": [[round(p[0], 7), round(p[1], 7)] for p in ring],
                    "h": round(height, 2),
                })
                count += 1
        elem.clear()
    return count


def main() -> int:
    TMP.mkdir(parents=True, exist_ok=True)
    resources = discover_resources()
    if not resources:
        log("ERROR: CKAN discovery failed entirely")
        return 1
    archives = pick_archives(resources)
    if not archives:
        return 1

    buildings: list[dict] = []
    sources = []
    for res in archives:
        url = res["url"]
        sources.append(url)
        dest = TMP / Path(url).name
        if not dest.exists():
            download(url, dest)
        with zipfile.ZipFile(dest) as zf:
            members = gml_members(zf)
            log(f"{dest.name}: {len(members)} target bldg gml file(s)")
            if not members:
                nested = nested_zip_members(zf)
                log(f"  nested zips: {len(nested)}")
                cand = [n for n in nested if SECONDARY_MESH in n or "13100" in n or "tokyo" in n.lower()]
                for n in (cand or nested):
                    log(f"  scanning nested {n}")
                    with zf.open(n) as fh:
                        inner_bytes = fh.read()
                    with zipfile.ZipFile(io.BytesIO(inner_bytes)) as inner:
                        for m in gml_members(inner):
                            log(f"    parsing {m}")
                            c = parse_buildings(inner.read(m), buildings)
                            log(f"    -> {c} buildings in range")
            for m in members:
                log(f"  parsing {m}")
                c = parse_buildings(zf.read(m), buildings)
                log(f"  -> {c} buildings in range")
        dest.unlink(missing_ok=True)  # free runner disk before next archive

    log(f"total buildings within {CLIP_M} m: {len(buildings)}")
    if len(buildings) < 300:
        log("ERROR: too few buildings parsed — check archive selection above")
        return 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "meta": {
            "generated": datetime.now(timezone.utc).isoformat(),
            "source": "国土交通省 Project PLATEAU 東京都23区 3D都市モデル (CityGML LOD1)",
            "license": "政府標準利用規約2.0 / CC BY 4.0 compatible — 出典: 国土交通省 Project PLATEAU (編集・加工して使用)",
            "archives": sources,
            "meshes": list(TARGET_MESHES),
            "count": len(buildings),
        },
        "buildings": buildings,
    }, ensure_ascii=False))
    log(f"wrote {OUT} ({OUT.stat().st_size >> 10} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
