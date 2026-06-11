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

- [x] 昼・夕・夜の環境プリセット＋連続時刻補間（タイムラプス対応の太陽軌道・空ドーム）
- [x] リアルタイム太陽光シャドウ（PCFSoft、自動性能ティアで劣化制御）・ACESトーンマッピング・環境マップ
- [x] 夜の街灯表現（グロー＋ポール）・窓明かり・店舗ファサードの店明かり
- [x] 街路樹・街灯ポール・屋上設備・歩道・センターライン（インスタンシング/結合）
- [ ] ベンチ等のストリートファニチャー
- [ ] 商店街ファサード（メインストリート1本から）
- [x] 九品仏川緑道の作り込み（レンガ舗装・桜並木・舞う花びら・ベンチ・プランター・ボラード・ラベル）

## Phase 5: Simulation Layer ✅（基本実装）

- [x] 歩行者エージェント（OSM歩道ネットワーク上、約130人）
- [x] 車両（道路ネットワーク上、約30台）
- [x] 路線バス（主要道路を走行、大型車体）
- [x] 電車（東横線・大井町線の線形上を走行）
- [x] タイムラプスモード（1日約70秒、エージェント7倍速、時計表示）
- [x] 検知ラベル・都市監視UI風オーバーレイ（🛰ボタンでON/OFF。歩行者/車/電車の検知枠＋ID、近傍店舗ラベル、モニタHUD）

## Phase 6: Mobile Web Demo ✅（基本実装）

- [x] PWA化（manifest + Service Worker のstale-while-revalidateキャッシュ、ホーム画面追加対応）
- [x] OGP・アイコン（プロシージャル生成の夜景スカイライン）
- [x] 低速端末向け自動劣化（持続的低fps時にpixelRatioを段階的に削減）
- [ ] 実機での最終計測記録・スクリーンショット・デモ動画
