# データパイプライン手順書

OSMデータの取得から `city.json`（ランタイム用都市データ）生成までの再現手順。

```
scripts/fetch_osm.py      Overpass API → data/raw/osm/osm_raw.json (+ meta)
        ↓
scripts/process_osm.mjs   座標変換(EPSG:6677→ローカル) / 分類 / 軽量化
        ↓
data/processed/city.json  （コミット対象・ODbL継承）
web/public/data/city.json （同一物のコピー。Webアプリが読む）
```

## 実行方法

### A. GitHub Actions（推奨）

ネットワーク制限のある環境でも実行できるよう、データ取得はCIで行える。

1. GitHubの Actions タブ → **fetch-data** workflow → Run workflow
2. workflowがOverpassから取得→変換→ `data/processed/` と `web/public/data/` への変更をコミット・プッシュする

### B. ローカル

```bash
python3 scripts/fetch_osm.py        # Overpass API（公共インスタンス）から取得
cd scripts && npm install && cd ..
node scripts/process_osm.mjs
```

## 取得対象（Overpassクエリ）

bbox = 35.60436, 139.66513, 35.61064, 139.67287（駅中心350m。[area-definition.md](area-definition.md)）

- 建物: `way[building]` / `relation[building]`（高さ: `height` → `building:levels`×3.2m → 既定8m）
- 道路: `way[highway]`（種別ごとの幅員でリボン化）
- 線路: `way[railway=rail|light_rail]`（`bridge`/`layer`タグで高架判定）、ホーム `railway=platform`
- 緑地: `leisure=park|garden`, `landuse=grass|forest|village_green`
- 水面: `natural=water`, `waterway=*`
- POI: `node[shop]`, `node[amenity]`, `node[railway=station]`（Phase 5のラベル用）

クエリ全文・取得日時は `data/processed/meta.json` に記録される（ODbL対応・再現性）。

## city.json スキーマ（v1）

```jsonc
{
  "meta": { "generated": "...", "origin": [35.6075, 139.669], "radius": 300, "license": "ODbL ..." },
  "buildings": [ { "f": [[x,z],...], "h": 12.8, "lv": 4, "n": "名称(任意)", "t": "retail" } ],
  "roads":     [ { "p": [[x,z],...], "w": 5.5, "t": "residential", "b": 0, "ly": 0 } ],
  "rails":     [ { "p": [[x,z],...], "el": 6, "n": "東急大井町線" } ],
  "platforms": [ { "f": [[x,z],...], "el": 0 } ],
  "green":     [ { "f": [[x,z],...] } ],
  "water":     [ { "f": [[x,z],...] } ],
  "pois":      [ { "x": 0, "z": 0, "n": "店名", "t": "cafe" } ]
}
```

- 座標はローカルメートル（x=東, z=南 ※Three.jsのZ軸に合わせ済み）、小数2桁（cm精度）に丸め
- 高さ `h` はメートル
- 道路幅 `w` は highway種別のデフォルト幅（`process_osm.mjs` 内の表を参照）

## 性能予算との関係

- `city.json` は **gzip後 1MB以下** を目標（超えたら座標精度・POI数を削る）
- 建物・道路はランタイムでマテリアル単位にメッシュ結合され、ドローコールは種別数程度（<20）になる
