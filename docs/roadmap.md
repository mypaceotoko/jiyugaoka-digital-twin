# Roadmap

開発計画書（[development-plan.md](development-plan.md) §10）のフェーズ別ロードマップの実行状況を管理する。

## Phase 0: Research & Planning ✅

- [x] 開発計画書（docs/development-plan.md）
- [x] 対象エリア・メッシュコード・ローカル原点の正式定義（docs/area-definition.md）
- [x] ライセンス・クレジット整備（LICENSE / ATTRIBUTION.md / NOTICE）
- [x] PLATEAU取り込み手順書（docs/plateau-import.md）
- [x] Overpassクエリ設計（scripts/fetch_osm.py）

## Phase 1: Minimal Map Prototype ✅

- [x] OSM取得スクリプト（scripts/fetch_osm.py、GitHub Actionsからも実行可）
- [x] 座標変換＆軽量化パイプライン（scripts/process_osm.mjs → city.json）
- [x] Vite + Three.js + TypeScript アプリ（web/）
- [x] OSM建物押し出し・道路リボン・線路・緑地の3D表示
- [x] クレジット表示UI（© OpenStreetMap contributors）
- [x] GitHub Pages 自動デプロイ

## Phase 2: Accurate City Foundation ✅（基本実装）

- [x] PLATEAU CityGML（東京23区 13100、メッシュ53393523/53393533）のCI自動取得（scripts/fetch_plateau.py）
- [x] LOD1建物への差し替え（実測フットプリント＋measuredHeight。OSM建物はフォールバック、名称・種別はOSMから転写）
- [ ] 航空写真との重ね合わせによる配置検証
- [ ] （任意）基盤地図情報5m DEMによる地形

## Phase 3: Walkable City ✅（基本実装）

- [x] 地上視点（バーチャルジョイスティック＋ドラッグ視点）
- [x] 俯瞰（オービット）
- [x] シネマティックカメラ（自動周回）
- [ ] カメラと建物の衝突判定（改善）

## Phase 4: Visual Enhancement 🔜（一部実装）

- [x] 昼・夕・夜の環境プリセット
- [x] 夜の街灯表現（グロー＋ポール）・窓明かり（プロシージャルテクスチャ）
- [x] 街路樹・街灯ポール（インスタンシング）
- [ ] ベンチ等のストリートファニチャー
- [ ] 商店街ファサード（メインストリート1本から）
- [ ] 九品仏川緑道の作り込み

## Phase 5: Simulation Layer 🔜（一部実装）

- [x] 歩行者エージェント（OSM歩道ネットワーク上、約130人）
- [x] 車両（道路ネットワーク上、約30台）
- [x] 電車（東横線・大井町線の線形上を走行）
- [ ] 検知ラベル・都市監視UI風オーバーレイ（POIデータはcity.jsonに格納済み）

## Phase 6: Mobile Web Demo 🔜

- [ ] 性能予算の最終達成（初期転送10MB以下・30fps、実機計測）
- [ ] PWA化（Service Workerによるデータキャッシュ）
- [ ] OGP・シェア導線・スクリーンショット・デモ動画
