# PLATEAU取り込み検証手順（Phase 2）

自由が丘エリア（メッシュ 53393523 / 53393533、[area-definition.md](area-definition.md) 参照）の
PLATEAU CityGML建物データをglTFへ変換するための検証手順書。

> **注**: PLATEAUの配布元（G空間情報センター）は大容量zip配布のため、
> この作業はローカルマシンまたはGitHub Actions上で行う。

## 0. 対象データ

- データセット: [東京都23区 3D都市モデル](https://www.geospatial.jp/ckan/dataset/plateau-tokyo23ku)
  - 目黒区（13110）・世田谷区（13112）の **CityGML（bldg）** を取得
  - 最新年度版を優先（LOD2の提供範囲・年度はダウンロードページで要確認）
- 必要ファイル: `53393523_bldg_*.gml`, `53393533_bldg_*.gml`（区zip内の `udx/bldg/` 配下）

## 1. 候補ツール比較（Issue #4）

| ツール | 形態 | 検証コマンド例 | 確認ポイント |
|---|---|---|---|
| [plateaukit](https://github.com/ozekik/plateaukit) | Python (pip) | `pip install plateaukit[all]` → `plateaukit export-geojson` 等 | メッシュ単位の抽出可否、属性(高さ)の保持、出力サイズ |
| [citygml-tools](https://github.com/citygml4j/citygml-tools) | Java CLI | `citygml-tools to-cityjson 53393523_bldg.gml` → CityJSONを自前でglTF化 | CityJSON経由の精度、Java環境の手間 |
| [PLATEAU GIS Converter](https://github.com/Project-PLATEAU/PLATEAU-GIS-Converter) | GUI/CLI (公式) | GUIで対象GMLを選択 → glTF/3D Tiles/GeoJSON出力 | 公式サポート、LOD選択、出力座標系 |

**評価基準**: ①手数の少なさ ②高さ・footprintの正確さ ③出力サイズ ④CI自動化のしやすさ

## 2. 検証手順

1. 区zipから対象メッシュの `bldg` GMLのみ取り出す（zip全体は展開しない。`unzip -j <zip> "*udx/bldg/53393523*"`）
2. 各ツールでLOD1ソリッドをエクスポート
3. 出力座標系を確認（CityGMLはEPSG:6697＝JGD2011地理座標+標高。EPSG:6677へ投影 → 駅原点オフセット。[area-definition.md](area-definition.md) の定義に合わせる）
4. 半径300mでクリップ（建物重心で判定）
5. `gltf-transform` で結合・meshopt圧縮: `npx @gltf-transform/cli optimize in.glb out.glb --compress meshopt`
6. 検証ビューア（web/）で読み込み、以下を目視確認:
   - 駅ビル・商店街の建物高さが現実と整合するか
   - OSM道路リボンと建物の位置ズレがないか（許容: 1m未満）

## 3. 受け入れ基準（Issue #10）

- [ ] 53393523 / 53393533 の建物がglTF化され、圧縮後合計5MB以下
- [ ] 駅・ロータリー・緑道沿いでOSM道路との位置整合を確認
- [ ] `ATTRIBUTION.md` にPLATEAU出典を「利用中」として更新
- [ ] 変換手順が再現可能な形で本書に追記されている

## 4. フォールバック

変換が難航した場合は、PLATEAU公式の3D Tiles配信
（[plateau-streaming-tutorial](https://github.com/Project-PLATEAU/plateau-streaming-tutorial)）を
[3DTilesRendererJS](https://github.com/NASA-AMMOS/3DTilesRendererJS) でThree.jsに直接読み込む方式に切り替える。
（トレードオフ: 通信量・スマホ負荷が増えるため、最終的には静的glTF化が望ましい）
