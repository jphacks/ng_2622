# NICT JLE 4.1 の zip を展開せずに読み、SST のレベル・年齢・Stage 2（1 枚の絵の描写）の課題と語数を数える
import re, sys, zipfile, collections, statistics
zp = sys.argv[1]
z = zipfile.ZipFile(zp)
names = [n for n in z.namelist() if n.endswith('.txt')]
dirs = collections.Counter(n.split('/')[1] for n in names)
print('dirs', dict(dirs))
lv = collections.Counter(); age = collections.Counter(); task2 = collections.Counter()
words_by_lv = collections.defaultdict(list)
sample = None
for n in names:
    if '/LearnerOriginal/' not in n and '/LearnerOriginalAll/' not in n and 'Original' not in n:
        continue
    t = z.read(n).decode('utf-8', 'ignore')
    m = re.search(r'<SST_level>(\d+)</SST_level>', t)
    if not m: continue
    L = int(m.group(1)); lv[L] += 1
    a = re.search(r'<age>([^<]*)</age>', t); age[a.group(1) if a else '?'] += 1
    t2 = re.search(r'<SST_task2>([^<]*)</SST_task2>', t); task2[t2.group(1) if t2 else '?'] += 1
    s2 = re.search(r'<stage2>(.*?)</stage2>', t, re.S)
    if s2:
        task = re.search(r'<task>(.*?)</task>', s2.group(1), re.S)
        if task:
            b = ' '.join(re.findall(r'<B>(.*?)</B>', task.group(1), re.S))
            b = re.sub(r'<F>.*?</F>|<[^>]+>', ' ', b)
            w = re.findall(r"[A-Za-z']+", b)
            words_by_lv[L].append(len(w))
            if L == 4 and sample is None: sample = (n, b.strip()[:600])
print('files with level', sum(lv.values()))
print('SST level', sorted(lv.items()))
print('age', age.most_common(15))
print('task2 (picture description topics)', task2.most_common(20))
for L in sorted(words_by_lv):
    v = words_by_lv[L]
    print(f'level {L}: n={len(v)} stage2 learner words median={statistics.median(v)} mean={statistics.mean(v):.0f}')
print('sample', sample)
