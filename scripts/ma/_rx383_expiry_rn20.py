# -*- coding: utf-8 -*-
import json
import math

T = 20 / 252
SIG = 0.20


def phi(v):
    return 0.5 * (1.0 + math.erf(v / math.sqrt(2.0)))


def rn_call(x):
    s = SIG * math.sqrt(T)
    lnkf = math.log(1 + x / 100)
    return phi((lnkf + 0.5 * SIG * SIG * T) / s)


def rn_put(x):
    s = SIG * math.sqrt(T)
    lnkf = math.log(1 - x / 100)
    return phi(-(lnkf + 0.5 * SIG * SIG * T) / s)


rows = []
for x in range(0, 41):
    rows.append({"x": x, "call_rn": round(rn_call(x), 4), "put_rn": round(rn_put(x), 4)})
print(json.dumps(rows))
