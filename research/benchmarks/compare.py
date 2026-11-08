"""Compare NeuroMove MCSE implementations (TypeScript) with reference implementations.

Usage (from website/):
  COORD_BENCH_OUT=../research/benchmarks/ts-outputs.json npx vitest run src/lab/coord/bench.node.test.ts
  python -I ../research/benchmarks/compare.py ../research/benchmarks/ts-outputs.json ../research/benchmarks/results.json

Reference package versions are recorded in the output.
"""
import json
import platform
import sys
import time

import ahrs
import numpy as np
import scipy
import sklearn
import tslearn
from ahrs.filters import Madgwick
from scipy.cluster.hierarchy import fcluster, linkage
from sklearn.metrics import adjusted_rand_score
from sklearn.mixture import GaussianMixture
from tslearn.metrics import dtw as ts_dtw

d = json.load(open(sys.argv[1]))
res = {"versions": {"python": platform.python_version(), "numpy": np.__version__, "scipy": scipy.__version__,
                    "scikit-learn": sklearn.__version__, "tslearn": tslearn.__version__, "ahrs": ahrs.__version__}}

# SVD — the TS side decomposes X exactly as given (callers centre it)
X = np.array(d["svd"]["X"])
t = time.perf_counter()
U, s, Vt = np.linalg.svd(X, full_matrices=False)
ms = (time.perf_counter() - t) * 1000
s_ts = np.array(d["svd"]["s"])
V_ts = np.array(d["svd"]["V3"])
cong = [abs(float(V_ts[:, k] @ Vt[k])) / (np.linalg.norm(V_ts[:, k]) * np.linalg.norm(Vt[k])) for k in range(3)]
res["svd"] = {"max_rel_singular_value_error": float(np.max(np.abs(s_ts - s) / s)), "loading_congruence_first3": cong,
              "ts_ms": d["svd"]["ms"], "numpy_ms": ms}

# Madgwick — same initial quaternion as the TS filter; ahrs updateIMU, gain 0.033, gyro in rad/s
g = np.radians(np.array(d["madgwick"]["gyro"]))
a = np.array(d["madgwick"]["acc"])
q_ts = np.array(d["madgwick"]["q"])
f = Madgwick(gain=0.033, frequency=100.0)
Q = np.zeros_like(q_ts)
Q[0] = q_ts[0]
t = time.perf_counter()
for i in range(1, len(g)):
    Q[i] = f.updateIMU(Q[i - 1], gyr=g[i], acc=a[i], dt=0.01)
ms = (time.perf_counter() - t) * 1000
ang = 2 * np.degrees(np.arccos(np.clip(np.abs(np.sum(Q * q_ts, axis=1)), 0, 1)))
res["madgwick"] = {"max_orientation_difference_deg": float(ang.max()), "median_deg": float(np.median(ang)),
                   "ts_ms": d["madgwick"]["ms"], "ahrs_ms": ms}

# DTW
free, band = [], []
t = time.perf_counter()
for p in d["dtw"]["pairs"]:
    A = np.array(p["a"])
    B = np.array(p["b"])
    free.append(ts_dtw(A, B))
    band.append(ts_dtw(A, B, global_constraint="sakoe_chiba", sakoe_chiba_radius=5))
ms = (time.perf_counter() - t) * 1000
eq = [ts_dtw(np.array(p["a"]), np.array(p["b"]), global_constraint="sakoe_chiba", sakoe_chiba_radius=5) for p in d["dtw"]["equal"]]
res["dtw_equal_length_banded"] = {"max_abs_diff_sakoe_chiba_r5": float(np.max(np.abs(np.array(eq) - np.array([p["d"] for p in d["dtw"]["equal"]])))),
                                  "note": "unequal lengths: tslearn widens the unscaled diagonal by |n-m| (width = |n-m| + r); NeuroMove uses the slope-scaled diagonal +- r. MCSE applies DTW to equal-length (101-sample) curves only."}
res["dtw"] = {"max_abs_diff_unconstrained": float(np.max(np.abs(np.array(free) - np.array(d["dtw"]["free"])))),
              "max_abs_diff_sakoe_chiba_r5": float(np.max(np.abs(np.array(band) - np.array(d["dtw"]["banded"])))),
              "ts_banded_first5": d["dtw"]["banded"][:5], "tslearn_banded_first5": band[:5],
              "ts_ms_unconstrained": d["dtw"]["ms"], "tslearn_ms_both": ms}

# GMM (diag) — sklearn's BIC uses the same parameter count as the TS implementation for 'diag'
Z = np.array(d["gmm"]["Z"])
bic, ll = [], []
lab = None
t = time.perf_counter()
for K in [1, 2, 3, 4]:
    gm = GaussianMixture(n_components=K, covariance_type="diag", n_init=8, reg_covar=1e-9, max_iter=500, tol=1e-8,
                         random_state=0).fit(Z)
    bic.append(float(gm.bic(Z)))
    ll.append(float(gm.score(Z) * len(Z)))
    if K == 3:
        lab = gm.predict(Z)
ms = (time.perf_counter() - t) * 1000
res["gmm"] = {"sklearn_bic": bic, "ts_bic": d["gmm"]["bic"],
              "max_abs_loglik_diff": float(np.max(np.abs(np.array(ll) - np.array(d["gmm"]["logLik"])))),
              "ari_labels_K3_vs_sklearn": float(adjusted_rand_score(lab, d["gmm"]["labels3"])),
              "bic_argmin_ts": int(np.argmin(d["gmm"]["bic"]) + 1), "bic_argmin_sklearn": int(np.argmin(bic) + 1),
              "ts_ms": d["gmm"]["ms"], "sklearn_ms": ms}

# Ward
lw = fcluster(linkage(Z, method="ward"), 3, criterion="maxclust")
res["ward"] = {"ari_vs_scipy": float(adjusted_rand_score(lw, d["ward"]["labels3"]))}

# ARI
res["ari"] = {"abs_diff_vs_sklearn": abs(float(adjusted_rand_score(d["ari"]["a"], d["ari"]["b"])) - d["ari"]["value"])}

json.dump(res, open(sys.argv[2], "w"), indent=1)
print(json.dumps(res, indent=1))
