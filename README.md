# Hiroshima Kart — 広島グランプリ

国土交通省 **PLATEAU** の 3D 都市モデル（広島市 2024 年度, CityGML）を使った、広島の街を走るマリオカート風レースゲームです。ブラウザ (three.js) で動作します。

## コース

広島駅 → 銀山町 → 八丁堀 → 紙屋町 → 原爆ドーム前 → 十日市 → 寺町 → 横川駅 → 新白島 → 城北 → 広島駅北口 →（広島駅へ）

1 周 約 7.3 km、2 周勝負。

**走行線は PLATEAU の道路データ (tran) の上を通ります。** `data/course.json` に置いた制御点どうしを、道路面をラスタライズしたグリッド上で A* 探索してつなぎ (`tools/build_course.mjs`)、道路の中央寄りを通るように重み付けしています。結果は `data/course_path.json` に 2m 間隔の閉ループとして書き出され、ゲームはこれをそのまま走行線として使います。制御点が道路の中心から外れていると経路が往復することがあるため、往復区間は自動で除去し、スタート地点は直線的な場所へ回しています。現在の経路は 99.6% が道路面の上にあります。

`tools/build_course.mjs` は確認用に `data/course_map.png`（道路網＋経路＋制御点）も書き出します。

`course.json` の制御点に `elevated: true` を付けると、その区間が実在しない新設の高架道路（高さ 13m、桁・壁高欄・橋脚つき）になります。現在のコースでは使っていません。

## コースを地図で見る

`tools/export_course_geo.mjs` が完成したコースを地図用に書き出します。

| ファイル | 用途 |
| --- | --- |
| `public/course-map.html` | OpenStreetMap / 地理院地図 / 空中写真に重ねて表示する単体ページ |
| `public/course.geojson` | geojson.io、QGIS など |
| `public/course.kml` | Google マイマップ、Google Earth |
| `public/course.gpx` | GPX トラック |

開発サーバー起動中なら http://localhost:5180/course-map.html で見られます。Google マイマップに読み込む場合は、マイマップで「インポート」から `public/course.kml` を選んでください。

## 使用している PLATEAU データ

| 地物 | 用途 |
| --- | --- |
| 建築物モデル `bldg` (LOD2) | コース沿いの 1,386 棟。**PLATEAU の実写テクスチャ**（航空写真由来）をそのまま使用 |
| 建築物モデル `bldg` (LOD1 Solid) | LOD2 の範囲外。高さ・用途からプロシージャル生成した壁面テクスチャを貼付 |
| 交通（道路）モデル `tran` (LOD1) | 地面テクスチャに道路面を描画 |
| 地形モデル `dem` (LOD1 TIN) | 5m グリッドの標高マップ。DEM に無い領域・低標高部を河川として扱い、橋を自動生成 |

出典: 国土交通省 PLATEAU「3D都市モデル（Project PLATEAU）広島市（2024年度）」(CC BY 4.0)

### LOD2 の実写テクスチャについて

PLATEAU の LOD2 は 1 棟につき 1 枚のテクスチャ画像（512〜2048px）を持ちます。対象 1,386 棟をそのまま読むと 90MB を超えるため、4096px のアトラス 6 枚（計約 15MB）に詰め直し、UV をアトラス座標へ変換しています（`tools/build_lod2_atlas.mjs`）。

このデータは航空写真から作られているため、**上空から見えない壁面が単色のベタ塗り（灰色またはほぼ黒）で埋められています**。そのまま貼ると真っ黒な壁になるので、アトラス生成時に「完全に同一の RGB が広い面積を占める」領域だけを検出し、コンクリート調の合成テクスチャへ差し替えています。写真が写っている部分は加工していません。

## 実在の鉄道・軌道（走行します）

| 路線 | 表現 |
| --- | --- |
| 広島電鉄 本線・横川線 | 実際の停留場 17 か所の座標で敷設。コース中央を軌道が走り、**電車に接触するとスピン**します |
| JR 山陽本線（広島 - 新白島 - 横川） | 盛土上の複線。227系風の 4 両編成が走行 |
| 山陽新幹線（広島駅） | 高架橋・防音壁・橋脚つき。N700系風の 6 両編成が走行 |

線路の座標は `data/rail.json` にあります。停留場・駅の位置は実在の座標、駅間の線形は概略値です。概略値ゆえにコースと重なる箇所が残るため、コース上に来る橋脚は描かないようにしています。

## 実在ランドマーク

**原爆ドーム**（旧広島県産業奨励館）を実際の位置・向きで再現しています。中央の円筒（階段室）の上に楕円ドームの鉄骨を組み、崩落した両翼を高さの差で表現しました。PLATEAU 側の同じ建物は重複するため除外しています（`src/landmarks.ts`）。

## セットアップ

```bash
npm install
npm run data:download   # PLATEAU CityGML を data/citygml/ にダウンロード (約 700MB + DEM 490MB)
npm run data:convert    # public/data/ にゲーム用データを生成
npm run dev             # http://localhost:5180/
```

`public/data/` に生成済みデータが含まれていれば、`npm run dev` だけで遊べます。

## 操作

| キー | 操作 |
| --- | --- |
| ↑ / W | アクセル |
| ↓ / S | ブレーキ・バック |
| ← → / A D | ハンドル |
| Shift / Space | ドリフト（離すとミニターボ） |
| Ctrl / Enter / X | アイテム使用 |
| B | 後方視点 |
| C | カメラ切替 |
| M | ミュート |

アイテム: キノコ（加速）、バナナ（後方に設置）、ミドリこうら（前方に発射・壁で反射）、スター（無敵）。コインを取ると最高速が少し上がります。

## 開発用デバッグ

URL パラメータでカウントダウン無しに任意地点から開始できます。

```
http://localhost:5180/?debug=1&wp=7&cam=3      # 経由地 7 から俯瞰カメラで開始
http://localhost:5180/?debug=1&idx=2000&cam=0  # スプラインのサンプル番号 2000 から
http://localhost:5180/?debug=1&ai=1&steps=60   # プレイヤーも AI 操作 + 物理を 60 倍速 (低速環境での検証用)
http://localhost:5180/?debug=1&photo=34.39564,132.45362,14,75,200  # 指定した緯度経度を撮影
```

`norail=1` `nolod2=1` `nobldg=1` `nodome=1` `noshadow=1` `lod2basic=1` で要素を切り分けられます。

`cam` は 0: 追従, 1: 遠め, 2: ボンネット, 3: 俯瞰。`tools/shots.mjs` と `tools/airace.mjs` は Playwright (SwiftShader) でこれらを自動実行します。

## 構成

```
data/course.json           コースの制御点 (緯度経度・高架フラグ)
data/course_path.json      道路上を通る走行線 (build_course.mjs が生成)
data/rail.json             鉄道・軌道・ランドマークの実在位置
tools/download_plateau.mjs PLATEAU CityGML ダウンロード
tools/convert_citygml.mjs  CityGML → buildings.json / roads.json / terrain.bin (LOD1)
tools/convert_lod2.mjs     CityGML → lod2.bin / lod2.json (LOD2 実写テクスチャ)
tools/download_lod2_tex.mjs LOD2 テクスチャ画像のダウンロード
tools/build_lod2_atlas.mjs テクスチャアトラス生成 (ベタ塗り面の補正込み)
tools/build_course.mjs     走行線を PLATEAU の道路面の上に載せる (A* 探索)
tools/export_course_geo.mjs コースを GeoJSON / KML / GPX / OSM 地図ページへ書き出す
tools/screenshot.mjs       Playwright による動作確認スクリーンショット
tools/shots.mjs            任意地点のスクリーンショット
tools/airace.mjs           全 AI による高速レース検証
tools/probe_scene.mjs      画面前方の物体をレイキャストで特定
tools/probe_uv.mjs         UV とアトラス参照先の特定
tools/check_trains.mjs     車両が走行しているかの確認
src/geo.ts        座標変換 (等距円筒近似, 原点 = 広島駅南口)
src/terrain.ts    地形メッシュ + 地面テクスチャ (道路・河川)
src/buildings.ts  LOD1 建物メッシュ (テクスチャ 6 種)
src/textures.ts   プロシージャルテクスチャ
src/track.ts      スプライン・路面・高架・欄干・看板・最寄点検索
src/lod2.ts       LOD2 実写テクスチャ建物の読み込み
src/rail.ts       広電・JR・新幹線の線路と走行車両
src/landmarks.ts  原爆ドーム
src/kart.ts       カート物理・モデル・AI
src/items.ts      アイテムボックス・コイン・バナナ・甲羅
src/hud.ts        HUD・ミニマップ
src/audio.ts      WebAudio 効果音
src/main.ts       シーン構築・レース進行
```
