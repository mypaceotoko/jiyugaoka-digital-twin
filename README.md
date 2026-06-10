# Jiyugaoka Digital Twin

Jiyugaoka Digital Twin is a 3D city simulation prototype that recreates the streetscape of Jiyugaoka, Tokyo using open city data such as Project PLATEAU and OpenStreetMap.

東京・自由が丘駅周辺の街並みを、オープンデータ（PLATEAU・OpenStreetMap・国土地理院）を使ってできるだけ正確に再現する3D都市シミュレーターのプロトタイプです。**スマホ（iPhone/Android）のブラウザで見られること**を最重要条件としています。

## Status

📋 **Planning phase** — implementation has not started yet.

開発計画書（技術選定・データ取得方針・ロードマップ・Issue一覧）はこちら:

➡️ **[docs/development-plan.md](docs/development-plan.md)**

計画の結論: **Three.js + Vite + TypeScript（Webアプリ）＋ オフラインのデータ前処理パイプライン＋ GitHub Pages公開**で進めます（Unity WebGLはiOS Safariでの安定性の問題から不採用）。

## Data Sources & Attribution

This project will use the following open data. 本プロジェクトは以下のオープンデータを利用予定です。

- **Project PLATEAU** (3D City Model, MLIT Japan) — 出典: 国土交通省 Project PLATEAU「東京都23区 3D都市モデル」（編集・加工して使用）
  https://www.mlit.go.jp/plateau/
- **OpenStreetMap** — © OpenStreetMap contributors, licensed under [ODbL 1.0](https://www.openstreetmap.org/copyright)
- **国土地理院（GSI）基盤地図情報** — 出典: 国土地理院
  https://www.gsi.go.jp/kiban/

The code in this repository will be released under the MIT License. Bundled/processed geodata remains subject to the licenses of its original sources (CC BY 4.0-compatible terms for PLATEAU, ODbL for OSM-derived data). Details will be maintained in `ATTRIBUTION.md`.
