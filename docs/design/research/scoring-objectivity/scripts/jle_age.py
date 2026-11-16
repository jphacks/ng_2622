# NICT JLE 4.1 の zip を展開せずに読み、年齢の区分と、題ごとの SST のレベルを数える
# 使い方: python3 -I jle_age.py <NICT_JLE の zip>
import re, sys, zipfile, collections
z = zipfile.ZipFile(sys.argv[1])
ages = collections.Counter(); cat = collections.Counter(); per_topic_lv = collections.defaultdict(collections.Counter)
native_topics = collections.Counter()
for n in z.namelist():
    if not n.endswith('.txt'): continue
    t = z.read(n).decode('utf-8','ignore')
    if '/Native/' in n:
        t2 = re.search(r'<SST_task2>([^<]*)</SST_task2>', t); native_topics[t2.group(1) if t2 else '?'] += 1; continue
    if '/LearnerOriginal/' not in n: continue
    a = re.search(r'<age>([^<]*)</age>', t); a = a.group(1) if a else ''
    try:
        x = int(a); b = '<=15' if x <= 15 else '16-18' if x <= 18 else '19-22' if x <= 22 else '23-30' if x <= 30 else '31+'
    except: b = 'unknown'
    ages[b] += 1
    c = re.search(r'<category>([^<]*)</category>', t); cat[c.group(1) if c else '?'] += 1
    t2 = re.search(r'<SST_task2>([^<]*)</SST_task2>', t); L = int(re.search(r'<SST_level>(\d+)</SST_level>', t).group(1))
    per_topic_lv[t2.group(1) if t2 else '?'][L] += 1
print('age bins', ages)
print('category', cat.most_common(10))
for k, v in per_topic_lv.items(): print(k, sorted(v.items()))
print('native task2', native_topics)
