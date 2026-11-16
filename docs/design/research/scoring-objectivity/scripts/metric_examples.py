# 手計算できる規模の例: QWK・一致率・RMSE・Pearson と、件数ごとの信頼区間の幅
import math
human   = [1, 2, 2, 3, 3, 1, 2, 3]
machine = [1, 2, 3, 3, 2, 1, 2, 3]
k = 3; n = len(human)
O = [[0]*k for _ in range(k)]
for h, m in zip(human, machine): O[h-1][m-1] += 1
rh = [sum(O[i]) for i in range(k)]; cm = [sum(O[i][j] for i in range(k)) for j in range(k)]
E = [[rh[i]*cm[j]/n for j in range(k)] for i in range(k)]
W = [[(i-j)**2/(k-1)**2 for j in range(k)] for i in range(k)]
num = sum(W[i][j]*O[i][j] for i in range(k) for j in range(k)); den = sum(W[i][j]*E[i][j] for i in range(k) for j in range(k))
print('O', O, 'row', rh, 'col', cm)
print('E', [[round(x,3) for x in r] for r in E])
print('sum wO', num, 'sum wE', round(den,4), 'QWK', round(1-num/den,4))
exact = sum(h==m for h,m in zip(human,machine))/n; adj = sum(abs(h-m)<=1 for h,m in zip(human,machine))/n
rmse = math.sqrt(sum((h-m)**2 for h,m in zip(human,machine))/n)
mh = sum(human)/n; mm = sum(machine)/n
cov = sum((h-mh)*(m-mm) for h,m in zip(human,machine)); sh = math.sqrt(sum((h-mh)**2 for h in human)); sm = math.sqrt(sum((m-mm)**2 for m in machine))
print('exact', exact, 'adjacent', adj, 'RMSE', round(rmse,3), 'Pearson', round(cov/(sh*sm),3))
sdp = math.sqrt(((sh**2)/(n-1) + (sm**2)/(n-1))/2); print('SMD', round((mm-mh)/sdp,3))
# Fisher z の 95% 信頼区間
for r in (0.7, 0.8):
    for N in (20, 30, 50, 100, 200):
        z = math.atanh(r); se = 1/math.sqrt(N-3)
        print(f'r={r} n={N}: 95%CI [{math.tanh(z-1.96*se):.2f}, {math.tanh(z+1.96*se):.2f}]')
# 一致率の 95% 信頼区間（Wilson）
def wilson(p, N):
    zc = 1.96; d = 1+zc*zc/N; c = (p+zc*zc/(2*N))/d; h = zc*math.sqrt(p*(1-p)/N+zc*zc/(4*N*N))/d; return c-h, c+h
for N in (50, 100, 300, 1000):
    lo, hi = wilson(0.85, N); print(f'agree=0.85 n={N}: [{lo:.3f}, {hi:.3f}]')
# Spearman-Brown と希薄化
for r1 in (0.6, 0.7):
    print('single', r1, 'k=2', round(2*r1/(1+r1),3), 'k=3', round(3*r1/(1+2*r1),3))
print('ceiling sqrt(0.7*0.9)=', round(math.sqrt(0.7*0.9),3), 'sqrt(0.818*0.9)=', round(math.sqrt(0.818*0.9),3))
