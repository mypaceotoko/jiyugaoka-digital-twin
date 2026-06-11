# Jiyugaoka Digital Twin

**[🌏 Live Demo (GitHub Pages)](https://mypaceotoko.github.io/jiyugaoka-digital-twin/)** — works on iPhone / Android / desktop browsers.

Jiyugaoka Digital Twin is a 3D city simulation prototype that recreates the streetscape of Jiyugaoka, Tokyo using open city data such as Project PLATEAU and OpenStreetMap.

東京・自由が丘駅周辺の街並みを、オープンデータ（PLATEAU・OpenStreetMap・国土地理院）を使ってできるだけ正確に再現する3D都市シミュレーターです。**スマホ（iPhone/Android）のブラウザで見られること**を最重要条件としています。

## Features (current)

- 🏙 自由が丘駅 中心・半径300mの街並みを再現 — **建物はPLATEAU 3D都市モデル（LOD1）の実測フットプリント・高さ**、道路・線路・緑地はOSM
- 🪟 窓付きファサード（プロシージャルテクスチャ、夜は窓明かりが点灯）
- 🚶🚗🚌🚃 歩行者・車・路線バス・電車（東横線/大井町線）のアンビエントシミュレーション
- 🌳 街路樹・街灯などのストリートスケープ
- 📷 カメラ3モード: 俯瞰（オービット）／地上（バーチャルジョイスティックで歩行）／シネマティック
- 🌇 昼・夕・夜の環境プリセット切り替え＋⏩ タイムラプス（朝〜夜中まで太陽が動き、街が早送りで流れる）
- 💡 リアルタイム太陽光シャドウ・ACESトーンマッピング・空ドーム・店舗ファサード（夜は店明かり）
- 🛰 都市監視モード: 歩行者/車/電車の検知ボックス＋ID、店舗ラベル、モニタHUD
- 📱 スマホ最適化: メッシュ結合＋インスタンシング、pixelRatio制限＋自動性能ティア、PWA（オフラインキャッシュ・ホーム画面追加）

## Roadmap

| Phase | 内容 | 状態 |
|---|---|---|
| 0 | Research & Planning（計画書・エリア定義・ライセンス整備） | ✅ |
| 1 | Minimal Map Prototype（OSMベースの3D表示・Pages公開） | ✅ |
| 2 | Accurate City Foundation（PLATEAU LOD1建物への差し替え） | ✅ |
| 3 | Walkable City（地上視点・カメラ切替） | ✅ (基本実装) |
| 4 | Visual Enhancement（昼夕夜・街灯・植栽・ファサード） | 🔜 一部実装 |
| 5 | Simulation Layer（歩行者・車両・検知ラベルUI） | ✅ (基本実装) |
| 6 | Mobile Web Demo（PWA・最終最適化） | ✅ (基本実装) |

詳細は [docs/development-plan.md](docs/development-plan.md)（開発計画書）と [docs/roadmap.md](docs/roadmap.md) を参照。

## Architecture

```
[Data pipeline (GitHub Actions / local)]            [Runtime (browser)]
OSM Overpass API ──→ scripts/fetch_osm.py ──→ data/raw/osm/*.json (not committed)
PLATEAU CityGML ──→ scripts/fetch_plateau.py ──→ data/processed/plateau_buildings.json
                     scripts/process_osm.mjs ──→ web/public/data/city.json
                                                    Three.js + Vite + TypeScript
                                                    └→ GitHub Pages
```

- **Runtime**: [Three.js](https://threejs.org/) + [Vite](https://vitejs.dev/) + TypeScript（`web/`）
- **Data pipeline**: Python（取得）+ Node.js（座標変換・軽量化、`scripts/`）
- **座標系**: WGS84 → 平面直角座標系IX系（EPSG:6677）→ 駅中心原点のローカル座標（メートル）
- 詳細: [docs/data-pipeline.md](docs/data-pipeline.md) / [docs/area-definition.md](docs/area-definition.md)

## Development

```bash
# Web app
cd web
npm install
npm run dev      # local dev server
npm run build    # production build

# Data pipeline (requires network access to Overpass API)
python3 scripts/fetch_osm.py            # → data/raw/osm/
cd scripts && npm install && cd ..
node scripts/process_osm.mjs            # → data/processed/city.json + web/public/data/city.json
```

データ取得はGitHub Actionsの [`fetch-data` workflow](.github/workflows/fetch-data.yml)（手動トリガー）でも実行できます。

## Data Sources & Attribution

This project uses the following open data. 本プロジェクトは以下のオープンデータを利用しています。

- **OpenStreetMap** — © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licensed under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/). `data/processed/` および `web/public/data/` に含まれるOSM由来の加工データ（派生データベース）もODbLが適用されます。
- **Project PLATEAU** — 出典: 国土交通省 Project PLATEAU「[東京都23区 3D都市モデル](https://www.geospatial.jp/ckan/dataset/plateau-tokyo23ku)」（編集・加工して使用）。建物の形状・高さに利用
- **国土地理院 基盤地図情報**（地形導入時に利用予定）— 出典: [国土地理院](https://www.gsi.go.jp/kiban/)

詳細は [ATTRIBUTION.md](ATTRIBUTION.md) を参照してください。

## License

The **source code** in this repository is released under the [MIT License](LICENSE).

**Geodata** bundled in this repository (`data/processed/`, `web/public/data/`) is derived from the sources above and remains subject to their respective licenses (ODbL for OSM-derived data; CC BY 4.0-compatible terms for PLATEAU). See [ATTRIBUTION.md](ATTRIBUTION.md) and [NOTICE](NOTICE).
