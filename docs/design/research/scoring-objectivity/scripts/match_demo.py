"""決まった手順で（LLM を使わず）発話から (主語, 動詞, 目的語)・(物, 前置詞, 物) の組を取り出し、
場面のチェックリストの組と突き合わせる試作。本番の TypeScript で書ける規模かを見るためのもの。
使い方: python3 -I match_demo.py <scene.json> <parts_dir>
"""
import json, os, re, sys

scene = json.load(open(sys.argv[1])); parts_dir = sys.argv[2]
# 1) 場面の語彙: 部品の words（名詞・動詞）。同義語は部品ごとに一度だけ作る小さな辞書（ここでは手で数語）
SYN = {"kid": "child", "child": "child", "lady": "woman", "mother": "woman", "mom": "woman", "puppy": "dog",
       "look": "watch", "see": "watch", "examine": "check", "flowers": "flower", "trees": "tree"}
HYPER = {"girl": "child", "boy": "child", "woman": "person", "man": "person", "child": "person"}  # 上位語は「一部」
nouns, verbs = set(), set()
for it in scene["items"]:
    d = json.load(open(os.path.join(parts_dir, it["part"], "1.json")))
    for w in d["words"]:
        (nouns if w["pos"] == "noun" else verbs).add(w["word"])
nouns |= {"hand", "it", "her", "him", "he", "she", "they", "child", "person"}
# 配置から作る「場面で正しい組」: 部品ごとの (名詞, 動詞)。チェックリストに無い正しい描写（その他）を拾うため
layout_true = []
for it in scene["items"]:
    d = json.load(open(os.path.join(parts_dir, it["part"], "1.json")))
    ns = [w["word"] for w in d["words"] if w["pos"] == "noun"]; vs = [w["word"] for w in d["words"] if w["pos"] == "verb"]
    layout_true += [(ns[0], v, None) for v in vs] if ns else []
PREP = {"under", "on", "in", "next to", "behind", "in front of", "near", "across", "at"}
PRON = {"it", "her", "him", "he", "she", "they"}

def lemma(w):
    w = w.lower()
    cands = [w]
    for suf, rep in (("ing", ""), ("ing", "e"), ("s", ""), ("es", "")):
        if w.endswith(suf):
            b = w[: -len(suf)] + rep
            cands.append(b)
            if suf == "ing" and len(b) > 2 and b[-1] == b[-2]: cands.append(b[:-1])  # running -> run
    for c in cands:
        c = SYN.get(c, c)
        if c in verbs | nouns: return c
    return w

def clauses(text):
    t = text.lower().replace("next to", "next_to").replace("in front of", "in_front_of")
    # 句点・カンマ・接続詞で節に分ける。接続詞は節の頭に残す
    parts = re.split(r"[.!?,]|\s(?=(?:because|so|and|to)\s)", t)
    return [p.strip() for p in parts if p and p.strip()]

def extract(text):
    """節ごとに 1〜2 個の組を返す。規則は 4 つだけ（SPICE の元の解析器は規則 9 つ）"""
    out = []
    for c in clauses(text):
        link = None
        m = re.match(r"(because|so|and|to)\s+(.*)", c)
        if m: link, c = m.group(1), m.group(2)
        toks = [x.replace("_", " ") for x in re.findall(r"[a-z_']+", c)]
        lem = [lemma(x) for x in toks]
        # 規則 1: there is/are X PREP Y
        if lem[:1] == ["there"] and len(lem) > 2:
            ns = [w for w in lem if w in nouns]; ps = [w for w in lem if w in PREP]
            if ns: out.append((link, (ns[0], ps[0], ns[1]) if ps and len(ns) > 1 else (ns[0],)))
            continue
        # 規則 2: 主語 = 動詞より前の最初の名詞、動詞 = be の後の -ing（to の節は主語なし）
        vi = next((i for i, w in enumerate(lem) if w in verbs and (i == 0 or toks[i].endswith("ing") or link == "to")), None)
        subj = next((w for w in lem[: vi or 0] if w in nouns), None)
        if vi is None:
            ns = [w for w in lem if w in nouns]; ps = [w for w in lem if w in PREP]
            if len(ns) > 1 and ps: out.append((link, (ns[0], ps[0], ns[1])))  # 規則 3: X is PREP Y
            continue
        rest = lem[vi + 1 :]
        obj = next((w for j, w in enumerate(rest) if w in nouns and not (w in PRON and j + 1 < len(rest) and rest[j + 1] in nouns)), None)
        prep = next((w for w in rest if w in PREP), None)
        # 規則 4: 動詞の後の前置詞句は (動詞-前置詞, 名詞) として持つ
        out.append((link, (subj, lem[vi], obj) if obj and not prep else (subj, lem[vi] + ("-" + prep if prep else ""), obj)))
    return out

def same(a, b):
    """要素が一致=1、上位語どうし=0.25、代名詞・欠け=0.5（照応は解かない）、前置詞だけ違う=0.75"""
    if a == b: return 1.0
    if a is None or b is None or a in PRON or b in PRON: return 0.5
    if HYPER.get(a) == b or HYPER.get(b) == a or (HYPER.get(a) and HYPER.get(a) == HYPER.get(b)): return 0.25
    if a.split("-")[0] == b.split("-")[0]: return 0.75  # 動詞は同じで前置詞だけ違う
    return 0.0

def tuple_score(gold, cand):
    if len(cand) == 1 and len(gold) == 3: return 0.5 * same(gold[0], cand[0])  # 物だけ言えた（位置は無し）
    if len(gold) != len(cand): return 0.0
    s = [same(g, c) for g, c in zip(gold, cand)]
    return 0.0 if min(s) == 0 else sum(s) / len(s)

items = [(c["id"], c["kind"], extract(c["accept"])) for c in scene["checklist"]]
all_gold = [t for _, _, ex in items for _, t in ex]

def grade(answer):
    got = extract(answer)
    res = []
    for iid, kind, gold in items:
        best = []
        for _, g in gold:
            best.append(max((tuple_score(g, t) for _, t in got), default=0.0))
        sc = min(best) if kind in ("reason", "link") else best[0]
        # 理由・つながりの項目は、接続詞 because/so/to の節があることも条件にする
        if kind in ("reason", "link") and not any(l in ("because", "so", "to") for l, _ in got): sc = 0.0
        res.append((iid, "言えた" if sc >= 0.9 else "一部" if sc >= 0.5 else "-"))
    claims = [(t, max(tuple_score(g, t) for g in all_gold + layout_true)) for _, t in got]
    return got, res, claims

for ans in [
    "A girl is showing her hand. A boy is running. A dog is sitting.",
    "A kid is running on the grass. A lady is looking at the girl. There are flowers.",
    "A boy is watching the dog. The dog is running.",
    "A girl is showing her hand, so a woman is checking it to help her. A dog is watching the boy because the boy is running. There is a bench under the tree.",
]:
    got, res, claims = grade(ans)
    print("発話:", ans)
    print("  取り出した組:", [t for _, t in got])
    print("  項目:", res)
    print("  各描写の一致度:", [(t, round(s, 2)) for t, s in claims])
