# Jiyugaoka Digital Twin 開発計画書

東京・自由が丘駅周辺の街並みを、オープンデータ（PLATEAU・OpenStreetMap・国土地理院）に基づき正確に再現する3D都市シミュレーターの実装前開発計画書。

- 作成日: 2026-06-10
- 最重要条件: **スマホ（特にiPhone）のブラウザでちゃんと見られること**

---

## 1. 結論

**Web / Three.js 中心で進めるべき。Unityは採用しない（少なくともWebデモ達成までは）。**

推奨構成: **Three.js + Vite + TypeScript（静的Webアプリ）＋ オフラインのデータ前処理パイプライン（Python/Nodeスクリプト）＋ GitHub Pages公開**

理由（スマホ最重要の観点から）:

- **Unity WebGLはiPhoneで実用に耐えない可能性が高い。** iOS SafariのWebGLはメモリ上限が厳しく（実質1GB前後でタブクラッシュ）、Unity WebGLビルドは空シーンでも初期ダウンロードが数十MB、都市モデルを載せると50〜150MBになりがち。モバイルSafariはUnity公式でも長らく「サポート対象外〜実験的」扱いで、「スマホでちゃんと見れること」という最重要条件と正面衝突する。
- **Unity + iOS/Androidネイティブビルドは品質は最高だが、App Store配布の手間（年会費・審査）が個人開発の「URLを送れば見られる」気軽さを殺す。** GitHubで公開→Webで誰でも見られる、という目標とも相性が悪い。
- **Three.jsなら初期ロードを数MB台に抑えられる。** PLATEAU/OSMを事前に変換・軽量化した静的glTFを配信する構成にすれば、ランタイムは~150KB(gzip)のThree.js + 数MBの都市データで済み、iPhone Safariで安定動作する実績が豊富。
- **データ処理（CityGML→glTF）はランタイムから切り離してスクリプトで事前実行する。** これによりスマホ側の負荷は「最適化済みモデルを表示するだけ」になる。
- PLATEAU SDK for Unityは魅力的だが、それは「Unityに取り込むのが楽」なだけで、出口（iPhoneのWeb表示）の問題を解決しない。**入口の楽さより出口の確実さを優先する。**

補足:

- **MapLibre + Three.js** は地図UI寄りのプロダクトには良いが、「地上視点で歩ける」体験はMapLibreのカメラモデルと相性が悪く、本プロジェクトの中核要件（walkable）に合わない。周辺コンテキスト表示として将来併用する余地はある。
- **CesiumJS** はPLATEAUの3D Tiles配信をそのまま読めるのが強みだが、ランタイムが重く（初期ロード・メモリともThree.js比で大）、地上視点のゲーム的カメラや見た目のカスタマイズがやりにくい。半径300〜500mの固定エリアなら全球エンジンはオーバースペック。
- React Three Fiber は任意。UIが複雑化したら導入検討で良く、MVPはプレーンなThree.js + TypeScriptで十分（依存を減らしバンドルを軽く保つ）。

---

## 2. プロジェクト概要

### 目的

東京・自由が丘駅周辺の街並みを、オープンデータ（PLATEAU・OpenStreetMap・国土地理院）に基づき、建物の高さ・配置・道路形状ができるだけ現実に近い3D都市シミュレーターとして再現し、**スマホのブラウザで誰でも見られる形で公開**する。

### 最初のMVP（これが出たら勝ち、の最小形）

- 自由が丘駅を中心に**半径300m**の範囲
- 建物: PLATEAU LOD1（高さ付きの箱形状。実測ベースの正確な高さ・配置）
- 道路・線路・駅: OSMから生成した平面/リボンメッシュ
- カメラ: 俯瞰（オービット）のみ
- 昼の環境のみ
- GitHub Pagesで公開され、**iPhone Safariで30fps以上で表示できる**

### 最終完成イメージ

- 半径500m（商店街エリア全域＋九品仏川緑道）をカバー
- 地上視点で歩ける／俯瞰／シネマティックの3カメラモード
- 昼・夕・夜の環境切り替え
- 街灯・植栽・看板・店舗ファサードによる「自由が丘らしさ」
- 歩行者・車両のアンビエントシミュレーション、検知ラベル風・都市監視UI風のオーバーレイ演出
- PWA対応のモバイルWebデモとして公開

### 対象エリアの現実的な提案

| 段階 | 範囲 | 理由 |
|---|---|---|
| MVP (Phase 1-2) | **駅中心 半径300m** | 自由が丘は低層高密度で、300mでも建物1,500〜2,500棟規模。これ以上はスマホ最適化前に破綻しやすい。商店街の主要部（正面口〜サンセットアレイ〜九品仏川緑道の一部）は300mに収まる |
| 拡張 (Phase 4以降) | 半径500m | 緑道全域・学園通り・熊野神社あたりまで。LOD/タイル分割導入後に拡張 |

中心座標の目安: 自由が丘駅 **35.6075N, 139.6690E**（地域メッシュ: 2次メッシュ 533935 付近、Phase 0で正確な3次メッシュ一覧を確定）。
行政区域は駅北側が**目黒区（13110）自由が丘**、駅南側が**世田谷区（13112）奥沢**にまたがる点に注意（PLATEAUデータは両区分が必要）。

---

## 3. 推奨技術構成

```
[オフライン前処理]                         [ランタイム（ブラウザ）]
PLATEAU CityGML (目黒区・世田谷区)   ┐
OSM Overpass (道路/線路/駅/POI)      ├→ scripts/ (Python/Node)     → Three.js + Vite + TS
国土地理院 5m DEM (必要時)           ┘   ・エリア切り出し              ・glTF/GeoJSONロード
                                          ・EPSG:6677へ投影             ・カメラ3モード
                                          ・ローカル原点オフセット       ・昼夕夜プリセット
                                          ・glTF化 + Draco/meshopt圧縮  → GitHub Pages (Actions自動デプロイ)
                                          ・GeoJSON簡略化
```

- **ランタイム**: Three.js + Vite + TypeScript。UIは素のHTML/CSS（必要になったらR3F/React検討）
- **前処理**: Python（plateaukit / citygml-tools / PLATEAU GIS Converter のいずれかをPhase 0で検証して採用）+ Node（gltfpack, gltf-transform）
- **座標系**: WGS84 → 平面直角座標系 第IX系（EPSG:6677、東京）→ 駅中心を原点とするローカルENU座標（メートル単位）
- **配信**: 変換済み静的アセット（glTF + GeoJSON）をリポジトリ or GitHub Releasesに置き、GitHub Pagesで配信
- **代替ショートカット（保険）**: PLATEAU公式の3D Tiles配信を `3DTilesRendererJS`（NASA-AMMOS製、Three.js用）で直接読む方式。自前変換が難航した場合のPhase 1のフォールバックとして温存

---

## 4. 技術比較表

| 観点 | 1. Unity+WebGL | 2. Unity+ネイティブ | 3. Three.js/Vite ⭐ | 4. MapLibre+Three | 5. CesiumJS | 6. PlayCanvas等 |
|---|---|---|---|---|---|---|
| スマホ表示の安定性 | ✗ iOS Safariでクラッシュ・非対応リスク大 | ◎ 最高（だがWebでない） | ◎ 軽量・実績豊富 | ◎ 安定 | △ メモリ・ロード重い | ○ |
| 自由が丘の3D再現しやすさ | ◎ エディタで作り込み容易 | ◎ | ○ コードベースだが十分 | △ 地図表現寄り、歩行視点が苦手 | △ 全球前提でローカル演出しにくい | ○ |
| PLATEAU取り込み | ◎ 公式SDKあり | ◎ | ○ 事前変換が必要（公式変換ツールあり） | △ 3D Tiles/MVT経由 | ◎ 3D Tiles直読み | △ |
| OSM取り込み | △ 自前実装 | △ | ○ GeoJSON→メッシュ生成（定番手法） | ◎ ベクタタイルそのまま | ○ | △ |
| 開発難易度 | 中（ビルド地獄あり） | 中〜高 | 中 | 中 | 中〜高 | 中 |
| GitHub公開との相性 | △ ビルド成果物が巨大、LFS必須級 | △ | ◎ 全部テキスト+小アセット | ◎ | ○ | ○ |
| Webデモ公開との相性 | △ Pages配信は可能だが重い | ✗ 不可 | ◎ Pagesに最適 | ◎ | ○ | ◎ |
| 歩行者・車両シミュ拡張 | ◎ NavMesh等が強力 | ◎ | ○ 自前実装（経路はOSMから取れる） | △ | △ | ○ |
| 個人開発の現実性 | △ iOS検証の徒労リスク | △ 配布コスト | ◎ | ○ | △ | △ コミュニティ小 |

**結論: 3のThree.js/Vite構成を主軸に、5（PLATEAU 3D Tiles配信 + 3DTilesRendererJS）を変換難航時の保険とする。**
将来「ハイエンド展示用」が必要になった時点で、同じ前処理済みglTF資産をUnityに持ち込むハイブリッドも可能（資産が無駄にならない）。

---

## 5. データソース方針

| 対象 | データソース | 取得物 | 理由 |
|---|---|---|---|
| **建物**（形状・高さ・配置） | **PLATEAU 東京都23区 3D都市モデル**（G空間情報センター） | 目黒区・世田谷区のCityGML（bldg）LOD1。LOD2が当該エリアで提供されていればPhase 4で部分採用 | 高さが航空測量ベースで正確。OSMの`building:levels`推定より圧倒的に信頼できる |
| **道路・路地** | **OSM (Overpass API)** | `highway=*`（primary〜footway/serviceまで。細い路地は`footway`/`service`/`pedestrian`） | 自由が丘の路地はOSMの整備が細かい。PLATEAUの道路（tran）はLOD1だと面情報が粗い場合があるためOSM優先、Phase 0で両者を比較して良い方を採用 |
| **線路・駅** | **OSM** | `railway=rail`（東横線・大井町線）、`railway=station/platform`、駅舎は`building=train_station` | 高架・地上の別（`bridge`/`layer`タグ）も取れる。東横線の高架表現に必要 |
| **店舗・施設POI** | **OSM** | `shop=*`, `amenity=*` の名称・位置 | Phase 4の看板・ラベル、Phase 5の監視UI風ラベルの元データ |
| **地形** | **国土地理院 基盤地図情報 数値標高モデル（5m DEM）** | 該当メッシュのDEM | 自由が丘は駅周辺が谷地形（九品仏川暗渠沿い）で微妙な高低差がある。**MVPでは平面で開始**し、Phase 2でDEM反映を判断 |
| **背景地図（任意）** | 地理院タイル | 俯瞰時の周辺コンテキスト用テクスチャ | 必須ではない。使う場合は出典表記 |

使い分けの原則: **「立体物の正確さはPLATEAU、ネットワーク（道・線路）と意味情報（店・施設）はOSM、標高は地理院」**。

注意点:

- PLATEAUのCityGMLは区単位で巨大（数GB級）。**3次メッシュ単位のファイル分割**を利用し、対象メッシュ（533935-23周辺の数枚）だけダウンロードする。
- Overpass APIの公共インスタンスはレート制限あり。**取得結果は `data/raw/` にキャッシュし、リポジトリの再現性は「取得スクリプト＋取得日時の記録」で担保**する（生データの再取得を毎回しない）。

### 主要データソースURL

- Project PLATEAU: https://www.mlit.go.jp/plateau/
- 東京都23区 3D都市モデル: https://www.geospatial.jp/ckan/dataset/plateau-tokyo23ku
- PLATEAU関連GitHub: https://github.com/Project-PLATEAU
- OpenStreetMap: https://www.openstreetmap.org/
- Overpass API: https://overpass-api.de/ ／ Overpass Turbo: https://overpass-turbo.eu/
- 国土地理院 基盤地図情報: https://www.gsi.go.jp/kiban/
- 地理院地図: https://maps.gsi.go.jp/

---

## 6. データ処理フロー

```
Step 0  対象エリア確定
        中心(35.6075, 139.6690)・半径300mのバウンディングボックスと、
        重なるPLATEAU 3次メッシュコード一覧を docs/area-definition.md に固定

Step 1  建物データ取得（PLATEAU）
        G空間情報センターから目黒区・世田谷区のCityGML(bldg)の該当メッシュをDL → data/raw/plateau/

Step 2  道路・線路・駅データ取得（OSM）
        Overpass APIクエリをスクリプト化（scripts/fetch_osm.py）→ GeoJSONで data/raw/osm/ に保存
        クエリ・取得日をメタファイルに記録（ODbL対応・再現性）

Step 3  座標系の変換
        WGS84 → EPSG:6677（平面直角座標系IX系）→ 駅中心原点のローカル座標（m）
        ※ Three.jsはY-up・右手系。Z軸反転に注意。変換ロジックは前処理側に集約し、
          ランタイムには「メートル単位のローカル座標」しか持ち込まない

Step 4  3Dモデル化
        建物: CityGML LOD1 → 変換ツール（plateaukit / citygml-tools / PLATEAU GIS Converter
              をPhase 0で比較検証）→ 半径でクリップ → glTF
        道路: OSMポリライン → 幅員（highway種別ごとのデフォルト幅）でリボンメッシュ生成
        線路: 同上＋高架部はOSMタグから高さオフセット
        駅・ホーム: OSMポリゴンを押し出し

Step 5  軽量化
        gltf-transform / gltfpack で: 重複頂点マージ → メッシュ結合（マテリアル単位）
        → meshopt/Draco圧縮 → 目標: 建物glTF合計 5MB以下（圧縮後）

Step 6  テクスチャ/マテリアル適用
        MVPはフラットシェーディング＋頂点AO（ベイク）のみ。テクスチャなしで開始
        Phase 4でKTX2圧縮テクスチャ・ファサード表現を追加

Step 7  スマホ向け最適化（§9参照）

Step 8  Web公開
        GitHub Actions: push → Viteビルド → GitHub Pagesデプロイ
        データが100MB近くなったらGit LFSではなくGitHub Releasesにアセットを逃がす
```

---

## 7. GitHubリポジトリ構成案

```
jiyugaoka-digital-twin/
├── README.md              # 概要・スクショ・デモURL・クレジット（英日併記）
├── LICENSE                # MIT（自作コード部分）
├── ATTRIBUTION.md         # PLATEAU / OSM / 地理院の出典・ライセンス詳細
├── NOTICE                 # 第三者ライブラリのライセンス一覧
├── docs/
│   ├── development-plan.md    # 本計画書
│   ├── area-definition.md     # 対象エリア・メッシュコード・原点座標の正式定義
│   ├── data-pipeline.md       # 前処理手順（再現手順書）
│   ├── plateau-import.md      # PLATEAU変換ツールの検証記録
│   └── roadmap.md             # フェーズ別ロードマップ（Issue連動）
├── scripts/               # 前処理（Python + Node）
│   ├── fetch_osm.py
│   ├── clip_plateau.py
│   ├── build_meshes.mjs       # GeoJSON→道路リボン等の生成
│   └── optimize_gltf.mjs
├── data/
│   ├── raw/               # .gitignore（PLATEAU CityGML原本・Overpass生データ）
│   └── processed/         # コミット対象（クリップ・圧縮済みglTF/GeoJSON、小容量のみ）
├── web/                   # Viteアプリ本体
│   ├── index.html
│   ├── public/            # 配信アセット（data/processedからコピー or シンボリック）
│   └── src/
│       ├── scene/         # シーン構築・ローダー
│       ├── camera/        # ground / aerial / cinematic
│       ├── environment/   # 昼夕夜プリセット
│       ├── sim/           # Phase 5: 歩行者・車両・ラベル
│       └── ui/            # HUD・クレジット表示
└── .github/workflows/deploy.yml   # Pages自動デプロイ
```

- `unity/` は**作らない**（採用しないため）。将来ハイブリッド化する場合に追加
- 生データ（数百MB〜GB）は絶対にコミットしない。`data/raw/` はgitignore＋取得スクリプトで再現

---

## 8. ライセンス・クレジット方針

| データ | ライセンス | 必要な表記 |
|---|---|---|
| PLATEAU | 政府標準利用規約2.0準拠（CC BY 4.0互換）の公開データ | 「出典: 国土交通省 Project PLATEAU『東京都23区 3D都市モデル』」＋編集加工した旨。READMEとWebデモ画面内クレジットの両方に記載 |
| OSM | **ODbL 1.0** | 「© OpenStreetMap contributors」をWebデモ画面に常時表示（またはクレジットボタン1タップで表示）。READMEにodbl/copyrightページへのリンク。**抽出・加工したOSMデータ（data/processed内のGeoJSON等）は派生データベースとなりODbL継承**——リポジトリで公開する場合はその旨をATTRIBUTION.mdに明記 |
| 地理院（DEM・タイル） | 測量法＋政府標準利用規約 | 「出典: 国土地理院（基盤地図情報 数値標高モデル）」。基本は出典明記で利用可。刊行物相当の利用になる場合の承認申請要否はPhase 2のDEM採用時に確認 |
| 自作コード | MIT | LICENSEファイル |

注意点:

- **コード（MIT）とデータ（CC BY / ODbL）のライセンスは別物**としてREADMEで明確に分離する（「This repository's code is MIT. Bundled geodata is subject to…」）
- ODbLで最も間違えやすいのは「画面表記だけして派生データのライセンス継承を忘れる」こと。`data/processed/` にOSM由来データを含めるなら、そのディレクトリのREADMEにODbL継承を明記
- Phase 4で実在店舗の看板・ロゴを再現する場合、**商標・意匠は別問題**。ロゴの忠実再現は避け、雰囲気の再現（色・形のデフォルメ）に留める方針を先に決めておく

---

## 9. スマホ最適化方針

**性能予算（iPhone SE級を下限ターゲット）:**

- 初期転送量: **合計10MB以下**（理想5MB）
- ドローコール: **100以下**
- 三角形: **30万以下**
- 目標30fps

具体策:

1. **メッシュ結合が最重要**: 建物2,000棟を1棟1メッシュにしない。マテリアル単位で結合し数ドローコールに（建物色分けは頂点カラーで）
2. **meshopt + Draco圧縮**、テクスチャは導入時からKTX2(Basis)
3. **`renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`** ＋ 低ティア端末では1.5に制限（初回フレーム時間で簡易判定）
4. **ライティングはベイク前提**: リアルタイムシャドウなし（夜モードのみ局所ライト数個）。AOは前処理で頂点カラーにベイク。昼夕夜は環境マップ＋フォグ＋マテリアル色のプリセット切替で表現（ライト再計算しない）
5. **描画距離制限＋フォグ**: 地上視点では遠景をフォグでカット。半径500mに拡張する際はタイル分割＋距離ベースの表示切替（簡易LOD）
6. **初期表示は俯瞰の固定アングル**にして、操作開始までに全データのパース完了を隠す（ローディング演出）
7. **iOS Safari固有**: メモリ確保は起動時一括（逐次growthでクラッシュしやすい）、`WebGL2`前提でOKだがコンテキストロスト時のリロード導線を用意、ホーム画面追加用メタタグ
8. **PWA化**はPhase 6で検討（Service Workerで都市データをキャッシュ→2回目以降の起動が爆速になりデモ映えする）
9. 毎フェーズ終わりに**実機計測**（iPhone実機＋Chrome DevToolsのCPUスロットリング）をDefinition of Doneに含める

---

## 10. フェーズ別ロードマップ

想定時間は「個人開発・週5〜10時間」前提の正味作業時間。

| Phase | 内容 | 主な成果物 | 難易度 | 想定時間 |
|---|---|---|---|---|
| **0: Research & Planning** | 対象メッシュ確定、PLATEAU該当データの存在・LOD確認、変換ツール3候補の比較検証、Overpassクエリ作成 | `docs/area-definition.md`, `docs/plateau-import.md`, 検証ログ | ★★☆ | 10–15h |
| **1: Minimal Map Prototype** | Vite+Three.js雛形、OSM建物フットプリント押し出しによる仮3D表示（PLATEAUを待たずにOSMだけで先に動かす）、道路リボン、Pages公開 | 俯瞰で見られる仮の自由が丘（URL付き） | ★★☆ | 15–25h |
| **2: Accurate City Foundation** | PLATEAU LOD1建物への差し替え、線路・駅・高架、座標精度検証（航空写真と重ね比較）、（任意）DEM | 建物の高さ・配置が実測ベースの自由が丘 | ★★★ | 30–50h |
| **3: Walkable City** | 地上視点（仮想ジョイスティック/タッチ操作）、俯瞰・シネマティック切替、カメラ衝突 | 3カメラモードで歩ける街 | ★★☆ | 20–30h |
| **4: Visual Enhancement** | 昼夕夜プリセット、街灯・植栽・ベンチ、商店街の店舗ファサード（代表的な通りから）、九品仏川緑道 | 「自由が丘らしさ」のあるビジュアル | ★★★★（作り込み次第で無限） | 40–80h |
| **5: Simulation Layer** | OSM歩道ネットワーク上の歩行者エージェント、道路上の車両、検知ラベル・都市監視UI風オーバーレイ | アンビエントに動く街＋演出UI | ★★★★ | 40h– |
| **6: Mobile Web Demo** | 性能予算の最終達成、PWA化、OGP/シェア導線、README整備・スクショ・デモ動画 | 公開デモ（正式リリース） | ★★☆ | 15–25h |

※ Phase 1で「OSMのみで先に動かす」のが本計画の肝。PLATEAU変換は個人開発最大の沼ポイントなので、Phase 0-1と並行して切り分ける。

---

## 11. 最初に作るべきGitHub Issue（14件）

> Labels体系: `phase:0`〜`phase:6` / `type:docs` `type:pipeline` `type:web` `type:opt` / `priority:high|mid|low`

1. **リポジトリ初期セットアップ（README・LICENSE・ATTRIBUTION）**
   - Description: README正式版（概要・コンセプト・クレジット）、MIT LICENSE、ATTRIBUTION.md雛形を作成
   - Labels: `phase:0` `type:docs` / Priority: High
   - Acceptance Criteria: 3ファイルがmainにあり、PLATEAU/OSM/地理院の出典記載がある
2. **対象エリアの正式定義**
   - Description: 中心座標・半径300m・該当PLATEAU 3次メッシュコード一覧・ローカル原点を `docs/area-definition.md` に固定
   - Labels: `phase:0` `type:docs` / Priority: High
   - Acceptance Criteria: メッシュコード一覧と原点座標（EPSG:6677値）が文書化されている
3. **PLATEAUデータ調査: 自由が丘エリアのLOD・年度の確認**
   - Description: 目黒区・世田谷区の最新データセットで該当メッシュのLOD1/LOD2提供状況とファイルサイズを確認
   - Labels: `phase:0` `type:pipeline` / Priority: High
   - Acceptance Criteria: 採用データセット（年度・LOD・URL）が `docs/plateau-import.md` に記録されている
4. **CityGML変換ツールの比較検証（plateaukit / citygml-tools / PLATEAU GIS Converter）**
   - Description: 1メッシュ分を3ツールでglTF化し、手数・出力品質・サイズを比較して採用を決定
   - Labels: `phase:0` `type:pipeline` / Priority: High
   - Acceptance Criteria: 比較表と採用決定が文書化され、1メッシュのglTFが出力できている
5. **Overpassクエリ設計＆OSM取得スクリプト**
   - Description: 対象bboxの道路・線路・駅・建物・POIを取得する `scripts/fetch_osm.py` を作成。結果と取得日時を保存
   - Labels: `phase:0` `type:pipeline` / Priority: High
   - Acceptance Criteria: 1コマンドでGeoJSON一式が `data/raw/osm/` に生成される
6. **Vite + Three.js + TS 雛形とGitHub Pagesデプロイ**
   - Description: 空シーン（地面＋ライト＋オービットカメラ）をActionsでPagesに自動デプロイ
   - Labels: `phase:1` `type:web` / Priority: High
   - Acceptance Criteria: 公開URLでiPhone Safari表示確認済み
7. **座標変換ユーティリティ（WGS84→EPSG:6677→ローカル）**
   - Description: 前処理側の変換関数＋既知地点でのユニットテスト
   - Labels: `phase:1` `type:pipeline` / Priority: High
   - Acceptance Criteria: 駅・主要交差点の変換誤差が1m未満
8. **OSM建物フットプリント押し出しによる仮3D表示**
   - Description: GeoJSON→押し出しメッシュ（高さは`building:levels`×3.2m、無指定は8m）→結合→glTF→表示
   - Labels: `phase:1` `type:web` / Priority: High
   - Acceptance Criteria: 半径300mの建物が俯瞰表示され、初期ロード10MB以下
9. **道路・線路リボンメッシュ生成**
   - Description: highway種別ごとの幅員でリボン生成。線路は枕木風マテリアル＋高架オフセット
   - Labels: `phase:1` `type:pipeline` / Priority: Mid
   - Acceptance Criteria: 駅前ロータリー・東横線高架・大井町線が視認できる
10. **PLATEAU LOD1建物への差し替え**
    - Description: Issue 4の採用ツールでパイプライン化し、OSM建物をPLATEAU建物に置換。航空写真と重ねて配置検証
    - Labels: `phase:2` `type:pipeline` / Priority: High
    - Acceptance Criteria: 建物高さが現実準拠になり、駅ビル等のランドマークで目視検証済み
11. **カメラ3モード（地上/俯瞰/シネマティック）**
    - Description: タッチ対応の地上移動、オービット俯瞰、定点パスのシネマティック、UI切替
    - Labels: `phase:3` `type:web` / Priority: Mid
    - Acceptance Criteria: スマホのタッチ操作だけで3モードを行き来できる
12. **昼・夕・夜の環境プリセット**
    - Description: 環境マップ・フォグ・マテリアルパラメータのプリセット切替（リアルタイムシャドウなし）
    - Labels: `phase:4` `type:web` / Priority: Mid
    - Acceptance Criteria: 切替がワンタップで、夜モードで街灯が点灯して見える
13. **クレジット表示UI**
    - Description: 画面隅の「©」から PLATEAU / © OpenStreetMap contributors / 地理院 を表示
    - Labels: `phase:1` `type:web` / Priority: High（公開URLを出す前に必須）
    - Acceptance Criteria: デモ画面からODbL等の表記に到達できる
14. **性能計測とデバイスティア対応**
    - Description: FPS/メモリHUD（デバッグ時のみ）、pixelRatio・フォグ距離の自動調整
    - Labels: `phase:6` `type:opt` / Priority: Mid
    - Acceptance Criteria: iPhone実機での計測値がIssueに記録され、性能予算（§9）を満たす

---

## 12. リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| PLATEAU CityGML変換の沼（ツール相性・座標ズレ・メモリ不足） | Phase 2が停滞 | Phase 1をOSMのみで先行完成させ依存を切る。保険としてPLATEAU公式3D Tiles配信＋3DTilesRendererJS直読みルートを確保 |
| iPhoneでのメモリ・性能不足 | 最重要条件の不達 | 性能予算を最初から数値で固定（§9）。毎フェーズ実機検証をDoDに含める。300m→500m拡張は最適化達成後のみ |
| データ容量がGitHubに収まらない | 公開・CI破綻 | raw生データは非コミット徹底。processedが肥大したらGitHub Releases配信へ移行 |
| Overpassレート制限・サーバ不調 | 取得スクリプト不安定 | 取得結果をキャッシュ、リトライ＋ミラーインスタンス対応 |
| Phase 4の作り込みが無限化 | 完成しない | 「代表的な1本の通り（メインストリート）だけ作り込む」を先に宣言。それ以外は量産マテリアル |
| 実在店舗の商標・意匠 | 公開時のトラブル | ロゴ忠実再現はしない方針をATTRIBUTION.mdに明記 |
| OSMデータの欠落・古さ（路地・建物） | 再現度低下 | 気づいた箇所はOSM本体に編集還元（コミュニティ的にも正道）。建物はPLATEAU優先なので影響は道路系のみ |

---

## 13. 次にClaudeへ投げるプロンプト案

1. **README正式版**: 「docs/development-plan.md の内容を踏まえ、README.mdを正式版に更新して。英語ベース＋日本語サマリ、デモURL欄（プレースホルダ）、スクリーンショット欄、PLATEAU/OSM/地理院のクレジット、コードMIT・データ別ライセンスの明記を含めて」
2. **エリア定義の確定**: 「自由が丘駅（35.6075, 139.6690）中心・半径300mに重なるPLATEAU 3次メッシュコードを計算し、EPSG:6677でのローカル原点座標とあわせて docs/area-definition.md を作って」
3. **Phase 1雛形**: 「web/ にVite+Three.js+TypeScriptの最小プロトタイプ（地面・ライト・オービットカメラ・FPS表示）を作り、GitHub ActionsでGitHub Pagesに自動デプロイされるようにして。初期バンドルはgzipで500KB以下に」
4. **OSM取得スクリプト**: 「docs/area-definition.md のbboxを使い、道路・線路・駅・建物・POIをOverpass APIから取得して data/raw/osm/ にGeoJSON保存する scripts/fetch_osm.py を作って。取得日時とクエリのメタ記録、リトライ、ODbL注記コメントも含めて」
5. **PLATEAU検証手順書**: 「目黒区・世田谷区のPLATEAU CityGMLから自由が丘の1メッシュをglTF化する手順を、plateaukit / citygml-tools / PLATEAU GIS Converter の3通りで検証する手順書 docs/plateau-import.md を作って。各ツールのインストール・実行コマンド・確認ポイントを含めて」
6. **建物押し出しパイプライン**: 「data/raw/osm/buildings.geojson から押し出し建物メッシュを生成し、マテリアル単位で結合してmeshopt圧縮glTFを出力する scripts/build_meshes.mjs を作って」
