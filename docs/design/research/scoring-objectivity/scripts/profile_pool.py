"""作り置きの場面の模範文（description）を、級ごとに決まった計算の指標で比べる。
使い方: python3 -I profile_pool.py <pool_dir> <cefrj.csv>
"""
import csv, glob, json, os, re, sys, statistics as st
from collections import Counter, defaultdict

pool_dir, cefr_csv = sys.argv[1], sys.argv[2]
ORDER = {"A1": 1, "A2": 2, "B1": 3, "B2": 4}
lex = {}
with open(cefr_csv, newline="") as f:
    for row in csv.DictReader(f):
        for hw in row["headword"].split("/"):
            hw = hw.strip().lower()
            lv = row["CEFR"].strip()
            if lv in ORDER and (hw not in lex or ORDER[lv] < ORDER[lex[hw]]):
                lex[hw] = lv
IRREG = {"is": "be", "are": "be", "was": "be", "were": "be", "has": "have", "her": "she", "his": "he",
         "them": "they", "their": "they", "him": "he", "its": "it", "children": "child", "people": "person",
         "men": "man", "women": "woman", "feet": "foot", "teeth": "tooth", "mice": "mouse", "fell": "fall",
         "ran": "run", "sat": "sit", "took": "take", "gave": "give", "left": "leave", "made": "make"}

def lemma(w):
    if w in IRREG: return IRREG[w]
    cands = [w] if w in lex else []
    for suf, rep in (("ies", "y"), ("es", ""), ("s", ""), ("ing", ""), ("ing", "e"), ("ed", ""), ("ed", "e"), ("d", "")):
        if w.endswith(suf):
            b = w[: -len(suf)] + rep
            if b in lex: cands.append(b)
            if suf == "ing" and len(b) > 2 and b[-1] == b[-2] and b[:-1] in lex: cands.append(b[:-1])  # running->run
    # 語形の候補のうち、いちばん易しい級の見出し語を使う（running は run の A1 として数える）
    return min(cands, key=lambda c: ORDER[lex[c]]) if cands else w

def mtld_one(tokens, thr=0.72):
    factors, types, n = 0.0, set(), 0
    for t in tokens:
        n += 1; types.add(t)
        if len(types) / n <= thr:
            factors += 1; types, n = set(), 0
    if n > 0:
        ttr = len(types) / n
        factors += (1 - ttr) / (1 - thr)  # 端数の因子
    return len(tokens) / factors if factors > 0 else float("inf")

def mtld(tokens):
    a, b = mtld_one(tokens), mtld_one(tokens[::-1])
    return (a + b) / 2

LINK = {"because", "so", "to", "when", "while", "and", "but"}
rows = defaultdict(list)
for f in sorted(glob.glob(os.path.join(pool_dir, "*.json"))):
    d = json.load(open(f))
    if "difficulty" not in d: continue
    text = d["description"]
    sents = [s for s in re.split(r"[.!?]", text) if s.strip()]
    toks = re.findall(r"[a-z']+", text.lower())
    lem = [lemma(t) for t in toks]
    lv = Counter(lex.get(l, "外") for l in lem)
    n = len(toks)
    rows[d["difficulty"]].append({
        "tokens": n,
        "mls": n / len(sents),
        "A1": lv["A1"] / n, "A2+": (lv["A2"] + lv["B1"] + lv["B2"]) / n, "外": lv["外"] / n,
        "because": toks.count("because"), "so": toks.count("so"),
        "to_inf": len(re.findall(r"\bto [a-z]+\b", text.lower())) - len(re.findall(r"\bnext to\b", text.lower())),
        "ttr": len(set(lem)) / n, "mtld": mtld(lem),
        "nonA1": sorted({l for l in lem if lex.get(l) not in (None, "A1")}),
    })
for k in ("eiken-3", "eiken-pre2", "eiken-2"):
    r = rows[k]
    def m(key): return st.mean(x[key] for x in r)
    def sd(key): return st.pstdev(x[key] for x in r)
    print(f"{k}: n={len(r)} 語数 {m('tokens'):.1f}±{sd('tokens'):.1f} 文の長さ {m('mls'):.1f} "
          f"A1の割合 {m('A1'):.2f} A2以上 {m('A2+'):.3f} 一覧外 {m('外'):.3f} because {m('because'):.2f} so {m('so'):.2f} "
          f"to不定詞 {m('to_inf'):.2f} TTR {m('ttr'):.2f}±{sd('ttr'):.2f} MTLD {m('mtld'):.1f}±{sd('mtld'):.1f}")
    allnon = Counter(w for x in r for w in x["nonA1"])
    print("   A1 でない語（上位）:", allnon.most_common(12))
