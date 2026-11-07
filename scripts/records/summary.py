#!/usr/bin/env python3
"""利用実験の記録（GET /records）を取り、端末ごとの推移を表にする。

  入力  バックエンドの GET /records（Authorization: Bearer <RECORDS_TOKEN>）
  出力  標準出力に、端末ごとの「遊んだ日数・ラウンド数・語数と内容点の最初と最近」の表

最初と最近は、その端末の古い順の最初の N ラウンドと最後の N ラウンドの平均（N は --window、既定 3）。
ラウンドが 2N 未満の端末は、重ならないよう半分ずつに分ける。日付は日本時間で数える。
合言葉は ps に出ないよう、引数ではなく環境変数 RECORDS_TOKEN で渡す。

使い方: RECORDS_TOKEN=... python3 scripts/records/summary.py --url https://<バックエンド>
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone

JST = timezone(timedelta(hours=9))


def fetch_all(url: str, token: str) -> list[dict]:
    records: list[dict] = []
    after = 0
    while True:
        req = urllib.request.Request(
            f"{url.rstrip('/')}/records?after={after}&limit=1000",
            headers={"Authorization": f"Bearer {token}"},
        )
        with urllib.request.urlopen(req, timeout=30) as res:
            body = json.load(res)
        records.extend(body["records"])
        if body["next"] is None:
            return records
        after = body["next"]


def mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def fmt(value: float | None) -> str:
    return "-" if value is None else f"{value:.1f}"


def first_and_last(rows: list[dict], key: str, window: int) -> tuple[float | None, float | None]:
    n = min(window, len(rows) // 2) if len(rows) < 2 * window else window
    if n == 0:
        return mean([r[key] for r in rows]), None
    return mean([r[key] for r in rows[:n]]), mean([r[key] for r in rows[-n:]])


def summarize(records: list[dict], window: int) -> list[dict]:
    by_device: dict[str, list[dict]] = defaultdict(list)
    for r in records:
        by_device[r["deviceId"]].append(r)
    rows = []
    for device, items in by_device.items():
        items.sort(key=lambda r: r["id"])
        days = {datetime.fromisoformat(r["createdAt"].replace("Z", "+00:00")).astimezone(JST).date() for r in items}
        words_first, words_last = first_and_last(items, "words", window)
        content_first, content_last = first_and_last(items, "content", window)
        rows.append(
            {
                "device": device[:8],
                "days": len(days),
                "rounds": len(items),
                "from": min(days).isoformat(),
                "to": max(days).isoformat(),
                "words_first": words_first,
                "words_last": words_last,
                "content_first": content_first,
                "content_last": content_last,
            }
        )
    rows.sort(key=lambda r: (-r["days"], -r["rounds"]))
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", required=True, help="バックエンドの URL（例: http://localhost:8787）")
    parser.add_argument("--window", type=int, default=3, help="最初と最近に使うラウンドの数（既定 3）")
    args = parser.parse_args()
    token = os.environ.get("RECORDS_TOKEN")
    if not token:
        print("環境変数 RECORDS_TOKEN に合言葉を入れてください", file=sys.stderr)
        return 1

    records = fetch_all(args.url, token)
    rows = summarize(records, args.window)
    print(f"記録 {len(records)} 件、端末 {len(rows)} 台（最初と最近は各 {args.window} ラウンドの平均）\n")
    header = ["端末", "日数", "ラウンド", "期間", "語数 最初→最近", "内容点 最初→最近"]
    print(" | ".join(header))
    print(" | ".join("---" for _ in header))
    for r in rows:
        print(
            " | ".join(
                [
                    r["device"],
                    str(r["days"]),
                    str(r["rounds"]),
                    f"{r['from']}〜{r['to']}",
                    f"{fmt(r['words_first'])} → {fmt(r['words_last'])}",
                    f"{fmt(r['content_first'])} → {fmt(r['content_last'])}",
                ]
            )
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
