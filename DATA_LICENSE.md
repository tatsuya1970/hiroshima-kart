# データのライセンス

このリポジトリは、**コード**と**データ**で異なるライセンスが適用されます。

| 対象 | ライセンス |
| --- | --- |
| ソースコード（`src/`, `tools/`, `index.html`, 設定ファイル） | MIT（[LICENSE](LICENSE)） |
| 3D 都市データ（`public/data/`, `data/`） | CC BY 4.0（下記） |

## 3D 都市データについて

`public/data/` および `data/` に含まれるデータは、以下を加工して作成したものです。

> 出典: 国土交通省「3D都市モデル（Project PLATEAU）広島市（2024年度）」
> https://www.mlit.go.jp/plateau/
> ライセンス: クリエイティブ・コモンズ 表示 4.0 国際 (CC BY 4.0)
> https://creativecommons.org/licenses/by/4.0/deed.ja

加工内容:

| ファイル | 元データ | 加工 |
| --- | --- | --- |
| `public/data/lod2.bin`, `lod2.json` | 建築物モデル `bldg` (LOD2) | CityGML から頂点・UV を抽出し、テクスチャアトラスの座標系へ変換 |
| `public/data/lod2_atlas_*.jpg` | 建築物モデル `bldg` (LOD2) のテクスチャ | 1,386 棟分の個別画像を 4096px のアトラス 6 枚へ再配置。航空写真に写らずベタ塗りになっている壁面のみ合成テクスチャへ差し替え |
| `public/data/buildings.json` | 建築物モデル `bldg` (LOD1 Solid) | フットプリントと高さを抽出 |
| `public/data/roads.json` | 交通（道路）モデル `tran` (LOD1) | 道路面ポリゴンを抽出 |
| `public/data/terrain.bin`, `terrain.json` | 地形モデル `dem` (LOD1 TIN) | 5m グリッドの標高マップへリサンプル |
| `data/course_path.json` | 交通（道路）モデル `tran` (LOD1) | 道路面上を A* 探索して得た走行線 |
| `public/course.geojson`, `.kml`, `.gpx` | 同上 | 走行線を地図用フォーマットへ書き出し |

CC BY 4.0 は再配布・改変・商用利用を許諾しています。本リポジトリのデータを利用する場合は、上記の出典表示を継承してください。

## PLATEAU 由来ではない要素

以下はこのリポジトリの独自実装であり、MIT ライセンスの対象です。

- 原爆ドームのモデル（`src/landmarks.ts`）— 実在の位置・向きを参照した独自モデリング
- 広島電鉄・JR 山陽本線・山陽新幹線の線路と車両（`src/rail.ts`, `data/rail.json`）— 停留場・駅の座標は実在の値、線形は概略値
- プロシージャルテクスチャ（`src/textures.ts`）
- カート物理・アイテム・HUD・効果音

## 商標について

本作品は任天堂株式会社とは一切関係がなく、同社が承認・後援するものでもありません。
`マリオカート` は任天堂株式会社の登録商標です。
