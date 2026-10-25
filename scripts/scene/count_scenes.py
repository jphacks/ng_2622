"""今の部品（backend/src/scenes/parts.json）で、AI が作れる場面が何通りあるかを数える。README の数字はこれで出す。

決まりは、AI に渡している生成の指示（backend/src/scenes/generate.ts）に合わせる:
- 地面（category ground）はちょうど 1 枚。室内の床は 4 種、屋外の地面は 6 種。
- 室内は背景の壁を 4 種から 1 枚置く。屋外は置かない。
- 室内では wall・window・clock を使わない。train は駅（platform_station）だけ。
- 置く部品の数（地面と壁を含む）は、かんたん 4〜6・ふつう 6〜10・むずかしい 10〜15。

数え方:
- 部品の選び方: 同じ部品は 1 場面に 1 回まで、順番は問わない（組み合わせ C）。
- 置き方まで: 地面と壁のほかの部品を、3×3 の区画のどこに・4 つの向き（camera・left・right・away）の
  どれで置くかも数える（1 個につき 36 通り）。on・between などの関係（11 種）と動きは数えない。
- 意味の通らない組み合わせ（室内の自転車など）も、上の決まりに反しなければ数える。

使い方: python3 scripts/scene/count_scenes.py
"""
from __future__ import annotations

import json
from math import comb
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INDOOR = ["floor_wood", "floor_tile", "floor_carpet", "floor_classroom"]
OUTDOOR = ["grass_patch", "sand_beach", "sidewalk_stone", "ground_dirt", "road_patch"]
STATION = "platform_station"
WALLS = ["wall_kitchen_tile", "wall_store_shelves", "wall_blackboard", "wall_window"]
NOT_INDOOR = ["wall", "window", "clock"]
LEVELS = {"かんたん": (4, 6), "ふつう": (6, 10), "むずかしい": (10, 15)}
# 地面と壁のほかの部品 1 個の置き方: 9 区画 × 4 向き
PLACES = 9 * 4


def main() -> None:
    parts = json.loads((ROOT / "backend/src/scenes/parts.json").read_text())
    ids = {p["id"]: p for p in parts}
    grounds = [i for i, p in ids.items() if p["category"] == "ground"]
    assert sorted(grounds) == sorted(INDOOR + OUTDOOR + [STATION]), grounds
    assert all(w in ids for w in WALLS + NOT_INDOOR + ["train"])

    rest = [i for i in ids if i not in grounds and i not in WALLS]
    station = len(rest)
    outdoor = len([i for i in rest if i != "train"])
    indoor = len([i for i in rest if i != "train" and i not in NOT_INDOOR])
    print(f"部品 {len(ids)} 個: 地面 {len(grounds)}、背景の壁 {len(WALLS)}、ほか {len(rest)}")
    print(f"ほかの部品のうち使えるもの: 屋外 {outdoor}、駅 {station}、室内 {indoor}")

    def count(n: int, place: bool) -> int:
        """地面と壁を含めて n 個の部品を置く場面の数"""
        out = comb(outdoor, n - 1) * (PLACES ** (n - 1) if place else 1)
        sta = comb(station, n - 1) * (PLACES ** (n - 1) if place else 1)
        ins = comb(indoor, n - 2) * (PLACES ** (n - 2) if place else 1)
        return len(OUTDOOR) * out + sta + len(INDOOR) * len(WALLS) * ins

    print()
    print("| 難易度 | 部品の数 | 部品の選び方 | 置き方まで |")
    print("| --- | --- | --- | --- |")
    for name, (lo, hi) in LEVELS.items():
        choose = sum(count(n, False) for n in range(lo, hi + 1))
        place = sum(count(n, True) for n in range(lo, hi + 1))
        print(f"| {name} | {lo}〜{hi} | {choose:,} | {place:.1e} |")

    print()
    print(f"例: 公園の地面に、ほかの部品を 3 個 → C({outdoor}, 3) = {comb(outdoor, 3):,} 通り、"
          f"置き方まで {comb(outdoor, 3):,} × {PLACES}^3 = {comb(outdoor, 3) * PLACES ** 3:,} 通り")


if __name__ == "__main__":
    main()
