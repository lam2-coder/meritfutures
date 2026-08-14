"""
Full-lifecycle Monte Carlo for a futures prop firm.

Phase 1 (Evaluation): trader must hit a profit target inside drawdown / daily-loss
/ consistency / min-day rules.
Phase 2 (Funded): the SAME passers keep trading under FUNDED rules and must clear
a payout gauntlet -- winning-day count + dollar floor, a payout buffer / safety net,
a funded consistency rule, a minimum-days gate, per-request payout caps, a max number
of payouts -- before any cash leaves the firm.

Outputs the full funnel: buy -> pass eval -> ever get a payout -> $ paid.

Calibrated to public aggregates:
  * eval pass ~ 15-17% for Topstep/Apex-style rules
  * funded -> payout ~ 45% (FPFX)  ->  overall buyer-paid ~ 7%
  * average payout ~ 4% of nominal account size
Real per-rule causal data is proprietary; treat pass/payout rates as MODELLED estimates.
Relative movements between rule sets are the intended output.
"""

import numpy as np
import json

RNG = np.random.default_rng(7)
START = 100_000.0          # nominal; everything scales (size-invariant)
MAX_SLOTS = 12

# ----------------------------------------------------------------------------
def draw_population(n):
    win = np.clip(RNG.normal(0.503, 0.055, n), 0.30, 0.72)
    rr  = np.clip(RNG.normal(1.28, 0.30, n), 0.60, 3.00)
    risk = np.clip(RNG.lognormal(np.log(0.009), 0.50, n), 0.003, 0.05)
    tpd  = np.clip(RNG.poisson(4, n) + 1, 1, 10)
    tilt = RNG.uniform(0.0, 0.40, n)
    return dict(win=win, rr=rr, risk=risk*START, tpd=tpd, tilt=tilt)

def sim_day(pop, active, cost_R=0.04, cat_scale=1.0):
    """One trading day for `active` traders. Returns (day_pnl, intraday_low, intraday_high) in $."""
    n = active.size
    win, rr, base_risk, tpd, tilt = pop['win'], pop['rr'], pop['risk'], pop['tpd'], pop['tilt']
    run = np.zeros(n); lo = np.zeros(n); hi = np.zeros(n)
    cat = RNG.random(n) < np.minimum((0.015 + 0.06 * tilt) * cat_scale, 0.6)
    day_risk = np.where(cat, base_risk * RNG.uniform(3.0, 6.0, n), base_risk)
    cur = day_risk.copy()
    cost = cost_R * base_risk
    for slot in range(MAX_SLOTS):
        act = active & (slot < tpd)
        if not act.any():
            continue
        wins = RNG.random(n) < win
        pnl = np.where(wins, rr * cur, -cur) - cost
        pnl = np.where(act, pnl, 0.0)
        run += pnl; lo = np.minimum(lo, run); hi = np.maximum(hi, run)
        lost = act & ~wins
        bump = lost & (RNG.random(n) < tilt)
        cur = np.where(bump, np.minimum(cur * RNG.uniform(1.5, 2.5, n), 0.5 * START), cur)
        cur = np.where(act & wins, day_risk, cur)
    return run, lo, hi

# ----------------------------------------------------------------------------
def simulate_eval(pop, rules):
    n = pop['win'].size
    tgt = rules['target'] * START
    dd = rules['dd'] * START
    dll = rules['dll'] * START if rules['dll'] else None
    cons = rules['consistency']; min_days = rules['min_days']; max_days = rules['max_days']
    dd_type = rules['dd_type']

    bal = np.full(n, START); eod_peak = np.full(n, START); eq_peak = np.full(n, START)
    best_day = np.zeros(n); days = np.zeros(n, int)
    alive = np.ones(n, bool); passed = np.zeros(n, bool); reason = np.array(['none']*n, dtype=object)

    for _ in range(max_days):
        a = alive & ~passed
        if not a.any(): break
        run, lo, hi = sim_day(pop, a)
        if dll is not None:
            br = a & (lo <= -dll); reason[br] = 'daily_loss'; alive[br] = False; a = alive & ~passed
        new_bal = bal + run
        il = bal + lo; ih = bal + hi
        bal = np.where(a, new_bal, bal); days = np.where(a, days+1, days)
        best_day = np.where(a & (run > best_day), run, best_day)
        if dd_type == 'static':
            floor = np.full(n, START - dd); chk = np.where(a, il, bal)
        elif dd_type == 'trail_eod':
            eod_peak = np.where(a, np.maximum(eod_peak, bal), eod_peak); floor = eod_peak - dd
            chk = np.where(a, np.minimum(bal, il), bal)
        else:
            eq_peak = np.where(a, np.maximum(eq_peak, ih), eq_peak); floor = eq_peak - dd
            chk = np.where(a, il, bal)
        br = a & (chk <= floor); reason[br] = 'max_drawdown'; alive[br] = False; a = alive & ~passed
        hit = a & (bal - START >= tgt) & (days >= min_days)
        if cons and cons > 0:
            ok = best_day <= cons * np.maximum(bal - START, 1.0); newly = hit & ok
        else:
            newly = hit
        passed[newly] = True; reason[newly] = 'passed'

    return passed

def simulate_funded(pop, idx, fr, horizon=32):
    """
    pop: full population; idx: boolean mask of funded traders (eval passers).
    fr: funded rules dict:
      dd, dd_type, dll, target(unused), consistency, min_days, winning_days,
      winning_floor (frac of start), buffer (frac of start), payout_cap (frac of start; 0=none),
      max_payouts (0=inf), split, post_payout_reset (bool: floor jumps to post-payout balance)
    Returns per-funded arrays: reached(bool), n_payouts, gross_withdrawn, firm_cost.
    """
    n = pop['win'].size
    dd = fr['dd'] * START
    dll = fr['dll'] * START if fr['dll'] else None
    cons = fr['consistency']; min_days = fr['min_days']
    wd_need = fr['winning_days']; wd_floor = fr['winning_floor'] * START
    buffer = fr['buffer'] * START
    cap = fr['payout_cap'] * START if fr['payout_cap'] else None
    max_po = fr['max_payouts']; split = fr['split']; reset = fr['post_payout_reset']
    dd_type = fr['dd_type']
    payout_gap = fr.get('payout_gap', 5)   # min trading days between payouts (cadence)
    denial = fr.get('denial_rate', 0.0)   # Merit: no-denial brand promise; competitors modeled same   # share of eligible requests denied (rule violations)
    riskup = fr.get('riskup', 1.25)         # post-first-payout risk escalation (house-money effect)

    bal = np.full(n, START); eod_peak = np.full(n, START); eq_peak = np.full(n, START)
    base = np.full(n, START)             # baseline since last payout
    best_since = np.zeros(n)             # best positive day since last payout
    win_days = np.zeros(n, int); days = np.zeros(n, int)
    n_po = np.zeros(n, int); gross = np.zeros(n); firm = np.zeros(n)
    alive = idx.copy(); reached = np.zeros(n, bool)
    last_po = np.full(n, -999)            # trading day of last payout (for cadence gate)

    for day in range(horizon):
        a = alive.copy()
        if not a.any(): break
        run, lo, hi = sim_day(pop, a, cat_scale=4.0)
        m = np.where(n_po >= 1, riskup, 1.0)
        run = run*m; lo = lo*m; hi = hi*m
        if dll is not None:
            br = a & (lo <= -dll); alive[br] = False; a = alive.copy()
        new_bal = bal + run; il = bal + lo; ih = bal + hi
        bal = np.where(a, new_bal, bal); days = np.where(a, days+1, days)
        win_days = np.where(a & (run >= wd_floor), win_days+1, win_days)
        best_since = np.where(a & (run > best_since), run, best_since)
        # drawdown floor (trails to safety net = start+buffer, then fixed)
        if dd_type == 'static':
            floor = np.full(n, START - dd); chk = np.where(a, il, bal)
        elif dd_type == 'trail_eod':
            cappk = np.minimum(bal, START + dd)         # safety net: stops trailing at start+dd -> floor locks at start
            eod_peak = np.where(a, np.maximum(eod_peak, cappk), eod_peak); floor = eod_peak - dd
            chk = np.where(a, np.minimum(bal, il), bal)
        else:
            cappk = np.minimum(ih, START + dd)
            eq_peak = np.where(a, np.maximum(eq_peak, cappk), eq_peak); floor = eq_peak - dd
            chk = np.where(a, il, bal)
        br = a & (chk <= floor); alive[br] = False; a = alive.copy()

        # payout eligibility
        profit_since = bal - base
        avail = bal - (START + buffer)                 # withdrawable above the buffer
        cons_ok = np.ones(n, bool) if not cons else (best_since <= cons * np.maximum(profit_since, 1.0))
        elig = (a & (days >= min_days) & (win_days >= wd_need) & (avail > 0) & cons_ok
                & (day - last_po >= payout_gap))
        if max_po:
            elig &= (n_po < max_po)
        if elig.any():
            req = np.where(elig, avail, 0.0)
            if cap is not None:
                req = np.minimum(req, cap)
            take = elig & (req > 0)
            den = take & (RNG.random(n) < denial)
            take = take & ~den
            last_po = np.where(den, day, last_po)   # denied: resubmit next cycle
            gross = np.where(take, gross + req, gross)
            firm = np.where(take, firm + split * req, firm)   # firm cash outflow = trader's split
            n_po = np.where(take, n_po + 1, n_po)
            last_po = np.where(take, day, last_po)
            reached = np.where(take, True, reached)
            bal = np.where(take, bal - req, bal)              # cash leaves the account
            base = np.where(take, bal, base)                  # reset baseline
            best_since = np.where(take, 0.0, best_since)
            win_days = np.where(take, 0, win_days)
            if reset:  # Topstep-style: floor jumps up to post-payout balance (no cushion)
                eod_peak = np.where(take, bal, eod_peak)
                eq_peak = np.where(take, bal, eq_peak)
            # graduate after max payouts
            if max_po:
                done = take & (n_po >= max_po); alive[done] = False

    funded_n = int(idx.sum())
    sub = idx
    return dict(
        funded_n=funded_n,
        reached_rate=float(reached[sub].mean()) if funded_n else 0.0,
        avg_payouts_per_payer=float(n_po[reached].mean()) if reached.any() else 0.0,
        avg_gross_per_payer=float(gross[reached].mean()) if reached.any() else 0.0,   # $ on 100k nominal
        avg_firmcost_per_payer=float(firm[reached].mean()) if reached.any() else 0.0,
        avg_firmcost_per_funded=float(firm[sub].mean()) if funded_n else 0.0,
    )

# ----------------------------------------------------------------------------
# Rule sets
EVAL_BASE = dict(target=0.06, dd=0.05, dd_type='trail_eod', dll=0.02,
                 consistency=0.50, min_days=2, max_days=30)
FUND_BASE = dict(dd=0.05, dd_type='trail_eod', dll=0.0, target=0.0,
                 consistency=0.50, min_days=5, winning_days=5, winning_floor=0.003,
                 buffer=0.026, payout_cap=0.04, max_payouts=6, split=0.90,
                 post_payout_reset=True, payout_gap=5)
# buffer 0.026 = drawdown(0.025)+~$100 on 100k ; winning_floor 0.003 = $300/100k (~$150/50k)
# payout_cap 0.04 = $4000/100k (~$2000/50k). split 0.90 = firm pays 90% out (keeps 10%).

def funnel(pop, eval_rules, fund_rules):
    passed = simulate_eval(pop, eval_rules)
    f = simulate_funded(pop, passed, fund_rules)
    pr = float(passed.mean())
    f['eval_pass'] = pr
    f['overall_paid'] = pr * f['reached_rate']
    # scale $ outputs to a $50k-nominal reference for readability (START=100k -> /2)
    f['avg_payout_50k'] = f['avg_gross_per_payer'] / 2.0
    return f

def run_all(n=60000):
    pop = draw_population(n)
    out = {}
    out['baseline'] = funnel(pop, EVAL_BASE, FUND_BASE)

    # ---- FUNDED-PHASE SWEEPS (the new levers) ----
    passers = simulate_eval(pop, EVAL_BASE)   # reuse one eval pass for funded sweeps

    def fsweep(param, values, labelfmt):
        d = {}
        for v in values:
            fr = dict(FUND_BASE); fr[param] = v
            r = simulate_funded(pop, passers, fr)
            r['avg_payout_50k'] = r['avg_gross_per_payer'] / 2.0
            d[labelfmt(v)] = r
        return d

    out['f_dd_type'] = {}
    for t, lab in [('static','Static'),('trail_eod','Trailing (EOD)'),('trail_intraday','Trailing (intraday)')]:
        fr = dict(FUND_BASE); fr['dd_type'] = t
        r = simulate_funded(pop, passers, fr); r['avg_payout_50k'] = r['avg_gross_per_payer']/2.0
        out['f_dd_type'][lab] = r
    out['f_dd_size']   = fsweep('dd', [0.03,0.05,0.08,0.10], lambda v: f'{int(v*100)}%')
    out['f_consistency']= fsweep('consistency', [0.0,0.50,0.40,0.30,0.20], lambda v: 'None' if v==0 else f'{int(v*100)}%')
    out['f_min_days']  = fsweep('min_days', [0,3,5,8,10], lambda v: f'{v} days')
    out['f_winning_days']= fsweep('winning_days', [0,3,5,8], lambda v: f'{v} win-days')
    out['f_win_floor'] = {}
    for v,lab in [(0.0,'$0 (any green day)'),(0.0015,'$75/50k'),(0.003,'$150/50k'),(0.006,'$300/50k')]:
        fr=dict(FUND_BASE); fr['winning_floor']=v
        r=simulate_funded(pop, passers, fr); r['avg_payout_50k']=r['avg_gross_per_payer']/2.0
        out['f_win_floor'][lab]=r
    out['f_buffer']    = fsweep('buffer', [0.0,0.013,0.026,0.05], lambda v: {0.0:'None',0.013:'Half DD',0.026:'DD+$100',0.05:'2x DD'}[v])
    out['f_cap']       = fsweep('payout_cap', [0.0,0.02,0.04,0.10], lambda v: 'No cap' if v==0 else f'${int(v*50000)}/50k'.replace('50000','').replace('$','$')+ (f'${int(v*50000)}' if False else '') )
    # cleaner cap labels
    out['f_cap'] = {}
    for v,lab in [(0.0,'No cap'),(0.02,'$1k/50k'),(0.04,'$2k/50k'),(0.10,'$5k/50k')]:
        fr = dict(FUND_BASE); fr['payout_cap']=v
        r = simulate_funded(pop, passers, fr); r['avg_payout_50k']=r['avg_gross_per_payer']/2.0
        out['f_cap'][lab]=r
    out['f_split'] = {}
    for v,lab in [(1.0,'100% (Apex PA)'),(0.90,'90/10'),(0.80,'80/20')]:
        fr=dict(FUND_BASE); fr['split']=v
        r=simulate_funded(pop, passers, fr); r['avg_payout_50k']=r['avg_gross_per_payer']/2.0
        out['f_split'][lab]=r

    # ---- EVAL-PHASE SWEEPS (kept, + min days) ----
    def esweep(param, values, labelfmt):
        d={}
        for v in values:
            er=dict(EVAL_BASE); er[param]=v
            r=funnel(pop, er, FUND_BASE); d[labelfmt(v)]=r
        return d
    out['e_dd_type']={}
    for t,lab in [('static','Static'),('trail_eod','Trailing (EOD)'),('trail_intraday','Trailing (intraday)')]:
        er=dict(EVAL_BASE); er['dd_type']=t; out['e_dd_type'][lab]=funnel(pop,er,FUND_BASE)
    out['e_dd_size']=esweep('dd',[0.03,0.05,0.08,0.10], lambda v:f'{int(v*100)}%')
    out['e_dll']={}
    for v,lab in [(0.0,'None'),(0.02,'2%'),(0.03,'3%'),(0.05,'5%')]:
        er=dict(EVAL_BASE); er['dll']=v; out['e_dll'][lab]=funnel(pop,er,FUND_BASE)
    out['e_consistency']=esweep('consistency',[0.0,0.50,0.40,0.30,0.20], lambda v:'None' if v==0 else f'{int(v*100)}%')
    out['e_min_days']=esweep('min_days',[0,1,2,5,10], lambda v:f'{v} days')
    out['e_target']=esweep('target',[0.06,0.08,0.10], lambda v:f'{int(v*100)}%')

    # ---- REAL FIRM-STYLE COMPOSITES (eval + funded together) ----
    out['firms']={}
    firms = {
        'Apex-style': (
            dict(target=0.06, dd=0.05, dd_type='trail_intraday', dll=0.0, consistency=0.30, min_days=1, max_days=30),
            dict(FUND_BASE, dd=0.05, dd_type='trail_intraday', consistency=0.50, min_days=5, winning_days=5,
                 winning_floor=0.004, buffer=0.026, payout_cap=0.04, max_payouts=6, split=1.0, post_payout_reset=False)),
        'Topstep-style': (
            dict(target=0.06, dd=0.05, dd_type='trail_eod', dll=0.02, consistency=0.50, min_days=2, max_days=30),
            dict(FUND_BASE, dd=0.05, dd_type='trail_eod', consistency=0.0, min_days=0, winning_days=5,
                 winning_floor=0.003, buffer=0.0, payout_cap=0.04, max_payouts=0, split=0.90, post_payout_reset=True)),
        'TPT-style (PRO)': (
            dict(target=0.06, dd=0.05, dd_type='trail_eod', dll=0.0, consistency=0.50, min_days=5, max_days=30),
            dict(FUND_BASE, dd=0.05, dd_type='trail_intraday', consistency=0.50, min_days=5, winning_days=0,
                 winning_floor=0.0, buffer=0.04, payout_cap=0.06, max_payouts=0, split=0.80, post_payout_reset=False)),
        'MFF-style': (
            dict(target=0.06, dd=0.08, dd_type='trail_eod', dll=0.0, consistency=0.0, min_days=1, max_days=30),
            dict(FUND_BASE, dd=0.08, dd_type='trail_eod', consistency=0.30, min_days=0, winning_days=5,
                 winning_floor=0.003, buffer=0.02, payout_cap=0.05, max_payouts=0, split=0.90, post_payout_reset=False)),
    }
    for name,(er,fr) in firms.items():
        out['firms'][name]=funnel(pop, er, fr)

    return out

# ----------------------------------------------------------------------------
# Run EVERY real firm plan through the model (eval plans + instant plans)
# ----------------------------------------------------------------------------
ED = dict(target=0.06, dd=0.05, dd_type='trail_eod', dll=0.0, consistency=0.0, min_days=1, max_days=30)
FD = dict(FUND_BASE, consistency=0.0, min_days=0, buffer=0.02, payout_cap=0.04)

FIRM_PLANS = [
 dict(firm='Apex', plan='Intraday', struct='Eval+Activation', price=131, disc=0.55, act=79, rebuys=4.0, maxacc=20,
      ev=dict(ED, dd_type='trail_intraday', consistency=0.30, min_days=1),
      fd=dict(FD, dd_type='trail_intraday', consistency=0.50, min_days=5, winning_days=5, winning_floor=0.004, buffer=0.05, payout_cap=0.044, max_payouts=6, split=1.0)),
 dict(firm='Apex', plan='EOD', struct='Eval+Activation', price=197, disc=0.55, act=99, rebuys=4.0, maxacc=20,
      ev=dict(ED, dd_type='trail_eod', consistency=0.30, min_days=1),
      fd=dict(FD, dd_type='trail_eod', consistency=0.50, min_days=5, winning_days=5, winning_floor=0.005, buffer=0.05, payout_cap=0.044, max_payouts=6, split=1.0)),
 dict(firm='Topstep', plan='Standard', struct='Subscription', price=165, disc=0.45, act=0, rebuys=3.2, maxacc=5,
      ev=dict(ED, dd=0.04, dll=0.02, consistency=0.50, min_days=2),
      fd=dict(FD, dd=0.04, consistency=0.0, winning_days=5, winning_floor=0.003, buffer=0.0, payout_cap=0.04, split=0.90, post_payout_reset=True)),
 dict(firm='Topstep', plan='Consistency', struct='Subscription', price=165, disc=0.45, act=0, rebuys=3.2, maxacc=5,
      ev=dict(ED, dd=0.04, dll=0.02, consistency=0.50, min_days=2),
      fd=dict(FD, dd=0.04, consistency=0.40, min_days=3, winning_days=0, buffer=0.0, payout_cap=0.12, split=0.90, post_payout_reset=True)),
 dict(firm='Take Profit Trader', plan='PRO', struct='Eval, no activation', price=150, disc=0.35, act=0, rebuys=3.0, maxacc=10,
      ev=dict(ED, dd=0.04, consistency=0.50, min_days=5),
      fd=dict(FD, dd=0.04, dd_type='trail_intraday', consistency=0.50, winning_days=0, winning_floor=0.0, buffer=0.04, payout_cap=0.0, split=0.80)),
 dict(firm='MyFundedFutures', plan='Expert', struct='Eval, no activation', price=130, disc=0.25, act=0, rebuys=3.0, maxacc=10,
      ev=dict(ED, dd=0.04, dll=0.02, consistency=0.0, min_days=1),
      fd=dict(FD, dd=0.04, consistency=0.0, winning_days=5, winning_floor=0.003, buffer=0.02, payout_cap=0.05, split=0.90)),
 dict(firm='MyFundedFutures', plan='Flex', struct='Eval, no activation', price=100, disc=0.25, act=0, rebuys=3.2, maxacc=10,
      ev=dict(ED, dd=0.08, consistency=0.0, min_days=1),
      fd=dict(FD, dd=0.08, consistency=0.30, winning_days=5, winning_floor=0.003, buffer=0.02, payout_cap=0.05, split=0.90)),
 dict(firm='Tradeify', plan='Growth', struct='Eval, no activation', price=145, disc=0.45, act=0, rebuys=3.2, maxacc=5,
      ev=dict(ED, dd=0.04, consistency=0.0, min_days=1),
      fd=dict(FD, dd=0.04, consistency=0.35, winning_days=5, winning_floor=0.003, buffer=0.02, payout_cap=0.04, split=0.90)),
 dict(firm='Tradeify', plan='Select', struct='Eval, no activation', price=165, disc=0.45, act=0, rebuys=3.0, maxacc=5,
      ev=dict(ED, dd=0.04, consistency=0.40, min_days=3),
      fd=dict(FD, dd=0.04, consistency=0.0, winning_days=5, winning_floor=0.003, buffer=0.02, payout_cap=0.05, split=0.90)),
 dict(firm='Tradeify', plan='Lightning', struct='Instant funding', price=492, disc=0.15, act=0, rebuys=1.6, maxacc=5, instant=True,
      fd=dict(FD, dd=0.04, consistency=0.25, winning_days=0, winning_floor=0.0, buffer=0.02, payout_cap=0.04, split=0.90)),
 dict(firm='TradeDay', plan='Quick Pay', struct='Subscription', price=124, disc=0.45, act=0, rebuys=3.2, maxacc=6,
      ev=dict(ED, dd=0.04, dd_type='trail_intraday', consistency=0.30, min_days=5),
      fd=dict(FD, dd=0.04, dd_type='trail_intraday', consistency=0.0, winning_days=0, winning_floor=0.0, buffer=0.0, payout_cap=0.10, split=0.80)),
 dict(firm='TradeDay', plan='Fast Pass', struct='Subscription', price=124, disc=0.45, act=0, rebuys=3.0, maxacc=6,
      ev=dict(ED, dd=0.04, consistency=0.45, min_days=3),
      fd=dict(FD, dd=0.04, consistency=0.0, min_days=5, winning_days=5, winning_floor=0.003, buffer=0.0, payout_cap=0.05, split=0.90)),
 dict(firm='TopOne', plan='Elite Challenge', struct='Subscription', price=218, disc=0.45, act=0, rebuys=3.0, maxacc=20,
      ev=dict(ED, dd=0.05, consistency=0.0, min_days=1),
      fd=dict(FD, dd=0.05, consistency=0.25, min_days=5, winning_days=5, winning_floor=0.003, buffer=0.02, payout_cap=0.05, split=0.90)),
 dict(firm='TopOne', plan='S2F PRO', struct='Instant funding', price=550, disc=0.25, act=0, rebuys=1.6, maxacc=20, instant=True,
      fd=dict(FD, dd=0.05, dd_type='trail_intraday', consistency=0.40, min_days=10, winning_days=10, winning_floor=0.003, buffer=0.02, payout_cap=0.05, split=0.80)),
 dict(firm='Lucid Trading', plan='LucidPro', struct='Eval, no activation', price=120, disc=0.25, act=0, rebuys=3.0, maxacc=5,
      ev=dict(ED, dd=0.05, consistency=0.0, min_days=1),
      fd=dict(FD, dd=0.05, consistency=0.40, winning_days=5, winning_floor=0.003, buffer=0.05, payout_cap=0.04, split=0.90)),
 dict(firm='Lucid Trading', plan='LucidFlex', struct='Eval, no activation', price=150, disc=0.25, act=0, rebuys=2.8, maxacc=10,
      ev=dict(ED, dd=0.05, consistency=0.50, min_days=1),
      fd=dict(FD, dd=0.05, consistency=0.0, winning_days=5, winning_floor=0.003, buffer=0.02, payout_cap=0.04, split=0.90)),
 dict(firm='Lucid Trading', plan='LucidDirect', struct='Instant funding', price=400, disc=0.18, act=0, rebuys=1.6, maxacc=10, instant=True,
      fd=dict(FD, dd=0.05, dd_type='trail_intraday', consistency=0.20, winning_days=5, winning_floor=0.003, buffer=0.05, payout_cap=0.04, split=0.80, payout_gap=5)),
 dict(firm='MyFundedFutures', plan='Rapid EOD', struct='Eval, no activation', price=126, disc=0.20, act=0, rebuys=2.2, maxacc=3,
      ev=dict(ED, dd=0.04, dd_type='trail_eod', consistency=0.30, min_days=4),
      fd=dict(FD, dd=0.04, dd_type='trail_eod', consistency=0.0, min_days=0, winning_days=0, winning_floor=0.0,
              buffer=0.042, payout_cap=0.0, max_payouts=6, split=0.90, payout_gap=1)),
 dict(firm='FundedNext', plan='Rapid Daily', struct='Eval, no activation', price=150, disc=0.50, act=0, rebuys=2.0, maxacc=5,
      ev=dict(ED, dd=0.04, dd_type='trail_eod', dll=0.02, consistency=0.0, min_days=0),
      fd=dict(FD, dd=0.04, dd_type='trail_eod', dll=0.02, consistency=0.0, min_days=0, winning_days=0, winning_floor=0.0,
              buffer=0.02, payout_cap=0.024, max_payouts=0, split=0.90, payout_gap=1)),
 dict(firm='Bulenox', plan='Option 1', struct='Sub + activation', price=167, disc=0.0, act=0, rebuys=2.5, maxacc=11,
      ev=dict(ED, dd=0.05, dd_type='trail_intraday', consistency=0.0, min_days=0),
      fd=dict(FD, dd=0.05, dd_type='trail_intraday', consistency=0.40, min_days=10, winning_days=0, winning_floor=0.0,
              buffer=0.0, payout_cap=0.03, max_payouts=0, split=0.95, payout_gap=10)),
 dict(firm='The5ers', plan='Day Trade', struct='Eval, no activation', price=80, disc=0.20, act=0, rebuys=2.2, maxacc=5,
      ev=dict(ED, dd=0.04, consistency=0.0, min_days=1),
      fd=dict(FD, dd=0.04, consistency=0.0, min_days=0, winning_days=0, winning_floor=0.0, buffer=0.02, payout_cap=0.03, split=0.80, payout_gap=14)),
 dict(firm='E8 Futures', plan='Zero Starter', struct='Eval, no activation', price=116, disc=0.0, act=0, rebuys=2.3, maxacc=3,
      ev=dict(ED, dd=0.03, consistency=0.0, min_days=3),
      fd=dict(FD, dd=0.03, consistency=0.25, min_days=0, winning_days=0, winning_floor=0.0, buffer=0.02, payout_cap=0.02, split=0.80, payout_gap=1)),
 dict(firm='BluSky', plan='Propel', struct='Subscription', price=112, disc=0.0, act=0, rebuys=2.8, maxacc=3,
      ev=dict(ED, dd=0.04, consistency=0.0, min_days=3),
      fd=dict(FD, dd=0.04, consistency=0.30, min_days=0, winning_days=0, winning_floor=0.0, buffer=0.02, payout_cap=0.05, split=0.90, payout_gap=1)),
 dict(firm='Legends Trading', plan='Elite', struct='Eval, no activation', price=121, disc=0.0, act=0, rebuys=2.0, maxacc=5,
      ev=dict(ED, dd=0.044, consistency=0.0, min_days=3),
      fd=dict(FD, dd=0.044, consistency=0.30, min_days=0, winning_days=5, winning_floor=0.003, buffer=0.02, payout_cap=0.04, split=0.90, payout_gap=5)),
 dict(firm='Phidias', plan='Fundamental', struct='Eval, no activation', price=116, disc=0.0, act=0, rebuys=2.0, maxacc=5,
      ev=dict(ED, dd=0.05, dd_type='trail_intraday', target=0.08, consistency=0.0, min_days=3),
      fd=dict(FD, dd=0.05, dd_type='trail_intraday', consistency=0.30, min_days=0, winning_days=0, winning_floor=0.0, buffer=0.02, payout_cap=0.04, split=0.80, payout_gap=10)),
 dict(firm='Day Traders', plan='Static', struct='Eval + activation', price=20, disc=0.0, act=99, rebuys=2.5, maxacc=15,
      ev=dict(ED, dd=0.02, dd_type='static', target=0.075, consistency=0.0, min_days=2),
      fd=dict(FD, dd=0.02, dd_type='static', consistency=0.25, min_days=0, winning_days=0, winning_floor=0.0, buffer=0.02, payout_cap=0.04, split=1.0, payout_gap=8)),
]

# Mark the real daily-payout plans with a 1-day cadence (TradeDay Quick Pay, Tradeify Select, TPT)
for _p in FIRM_PLANS:
    if (_p['firm'], _p['plan']) in [('TradeDay','Quick Pay'), ('Tradeify','Select'), ('Take Profit Trader','PRO')]:
        _p['fd']['payout_gap'] = 1

# ---------------------------------------------------------------------------
# OUR FIRM — recommended competitive plans (priced at the market floor, tuned to stay profitable)
# Design logic: attractive/loose EVAL to convert customers + TIGHT funded liability
# (payout cap + funded consistency + sensible cadence) to keep firm $/funded low.
# ---------------------------------------------------------------------------
OUR_PLANS = [
 dict(firm='OUR FIRM', plan='Core EOD (eval)', struct='Eval, no activation', price=99, disc=0.20, act=0, rebuys=3.0, maxacc=10,
      ev=dict(ED, dd=0.05, dd_type='trail_eod', consistency=0.0, min_days=1),
      fd=dict(FD, dd=0.05, dd_type='trail_eod', consistency=0.30, min_days=0, winning_days=5, winning_floor=0.003,
              buffer=0.02, payout_cap=0.03, max_payouts=8, split=0.90, payout_gap=5)),
 dict(firm='OUR FIRM', plan='Rapid Daily (eval)', struct='Eval, no activation', price=110, disc=0.20, act=0, rebuys=2.8, maxacc=5,
      ev=dict(ED, dd=0.05, dd_type='trail_eod', consistency=0.30, min_days=2),
      fd=dict(FD, dd=0.05, dd_type='trail_eod', consistency=0.40, min_days=5, winning_days=5, winning_floor=0.003,
              buffer=0.02, payout_cap=0.02, max_payouts=8, split=0.90, payout_gap=1)),
 dict(firm='OUR FIRM', plan='Direct (instant)', struct='Instant funding', price=379, disc=0.20, act=0, rebuys=1.6, maxacc=5, instant=True,
      fd=dict(FD, dd=0.04, dd_type='trail_eod', consistency=0.25, min_days=5, winning_days=5, winning_floor=0.003,
              buffer=0.03, payout_cap=0.03, max_payouts=6, split=0.90, payout_gap=5)),
]
FIRM_PLANS = FIRM_PLANS + OUR_PLANS

def run_firm_plans(n=50000):
    pop = draw_population(n)
    all_mask = np.ones(n, bool)
    results = []
    for p in FIRM_PLANS:
        if p.get('instant'):
            f = simulate_funded(pop, all_mask, p['fd'])
            eval_pass = 1.0; reached = f['reached_rate']; funded_rate = 1.0
            firm_cost_50k = f['avg_firmcost_per_funded'] / 2.0
            payout50 = (f['avg_gross_per_payer']/max(f['avg_payouts_per_payer'],1e-9))/2.0
        else:
            passed = simulate_eval(pop, p['ev'])
            f = simulate_funded(pop, passed, p['fd'])
            eval_pass = float(passed.mean()); reached = f['reached_rate']; funded_rate = eval_pass
            firm_cost_50k = f['avg_firmcost_per_funded'] / 2.0
            payout50 = (f['avg_gross_per_payer']/max(f['avg_payouts_per_payer'],1e-9))/2.0
        results.append(dict(firm=p['firm'], plan=p['plan'], struct=p['struct'],
                            price=p['price'], disc=p['disc'], act=p['act'], rebuys=p['rebuys'], maxacc=p['maxacc'],
                            eval_pass=eval_pass, reached=reached, funded_rate=funded_rate,
                            firm_cost_50k=firm_cost_50k, payout50=payout50,
                            # expose key rules for the rules table
                            ev_dd=p.get('ev',{}).get('dd', p['fd']['dd']),
                            ev_ddt=p.get('ev',{}).get('dd_type','—' if p.get('instant') else 'trail_eod'),
                            ev_cons=p.get('ev',{}).get('consistency', None),
                            ev_min=p.get('ev',{}).get('min_days', None),
                            fd_ddt=p['fd']['dd_type'], fd_cons=p['fd']['consistency'],
                            fd_min=p['fd']['min_days'], fd_win=p['fd']['winning_days'],
                            fd_floor=p['fd']['winning_floor'], fd_buf=p['fd']['buffer'],
                            fd_cap=p['fd']['payout_cap'], fd_split=p['fd']['split'],
                            fd_gap=p['fd'].get('payout_gap', 5), fd_maxpo=p['fd']['max_payouts']))
    return results



# =================== PORTFOLIO RISK ENGINE (VaR / ruin) ===================
def portfolio_risk():
    """Firm-level payout distribution with CORRELATED traders (Gaussian copula common factor)
    + 18-month ruin probability by starting capital. All inputs editable here."""
    from statistics import NormalDist
    R = np.random.default_rng(11)
    # --- inputs (grounded in Merit baseline; edit freely) ---
    signups_mo   = 500      # eval sales / month at baseline
    pass_rate    = 0.16     # blended eval pass
    funded_life  = 2.2      # avg active months per funded acct
    p_pay_mo     = 0.30     # P(an active funded acct takes >=1 payout in a month)
    pay_mu, pay_sd, pay_cap = 850.0, 700.0, 1500.0   # Merit payout size ($), capped
    fee_per_signup = 220.0  # conservative cash collected per signup (lifetime haircut)
    fixed_mo     = 33000.0  # fixed opex
    growth       = 0.08     # monthly signup growth in ruin sim
    months       = 18
    sims         = 8000
    F0 = int(round(signups_mo * pass_rate * funded_life))     # funded stock ~176
    th = NormalDist().inv_cdf(p_pay_mo)
    out = {'inputs': dict(signups_mo=signups_mo, pass_rate=pass_rate, funded_life=funded_life,
                          p_pay_mo=p_pay_mo, pay_mu=pay_mu, pay_sd=pay_sd, pay_cap=pay_cap,
                          fee_per_signup=fee_per_signup, fixed_mo=fixed_mo, growth=growth,
                          months=months, funded_stock=F0), 'stats': {}, 'ruin': {}}
    def month_payouts(nsims, F, rho):
        Z = R.standard_normal((nsims, 1))
        X = np.sqrt(rho) * Z + np.sqrt(1 - rho) * R.standard_normal((nsims, F))
        pays = X < th
        sizes = np.minimum(np.abs(R.normal(pay_mu, pay_sd, (nsims, F))), pay_cap)
        return (pays * sizes).sum(axis=1)
    # t-copula stress (nu=4): Gaussian copulas have ZERO tail dependence and understate joint tails
    def month_payouts_t(nsims, F, rho, nu=4):
        Z = R.standard_normal((nsims, 1)); E = R.standard_normal((nsims, F))
        W = R.chisquare(nu, (nsims, 1)) / nu
        Xt = (np.sqrt(rho) * Z + np.sqrt(1 - rho) * E) / np.sqrt(W)
        from statistics import NormalDist as _ND
        # threshold st marginal P(pay)=p_pay_mo under t_nu: use empirical quantile
        th_t = np.quantile(Xt[:2000].ravel(), p_pay_mo)
        pays = Xt < th_t
        sizes = np.minimum(np.abs(R.normal(pay_mu, pay_sd, (nsims, F))), pay_cap)
        return (pays * sizes).sum(axis=1)
    tt = month_payouts_t(20000, F0, 0.15)
    v99t = np.percentile(tt, 99)
    out['tcopula'] = dict(mean=float(tt.mean()), var99=float(v99t),
                          cvar99=float(tt[tt >= v99t].mean()))
    for rho in (0.05, 0.15, 0.30):
        tot = month_payouts(20000, F0, rho)
        v95, v99, v999 = np.percentile(tot, [95, 99, 99.9])
        cvar99 = tot[tot >= v99].mean()
        out['stats'][str(rho)] = dict(mean=float(tot.mean()), sd=float(tot.std()),
            var95=float(v95), var99=float(v99), var999=float(v999), cvar99=float(cvar99),
            mult=float(cvar99 / tot.mean()))
    # --- ruin under REGIME scenarios (rho=0.30 conservative) ---
    # base: none | rev_shock: -40% fees mo 7-12 | juice: p_pay x1.5 & severity x1.2 mo 5-7 | combined: both
    rho = 0.30
    for scen in ('base', 'rev_shock', 'juice_wave', 'combined'):
        for cap0 in (150000, 250000, 350000, 500000, 750000):
            C = np.full(sims, float(cap0)); ruined = np.zeros(sims, bool)
            for m in range(months):
                g = (1 + growth) ** m
                Fm = int(round(F0 * g))
                juiced = scen in ('juice_wave', 'combined') and 4 <= m <= 6
                if juiced:
                    th_j = NormalDist().inv_cdf(min(p_pay_mo * 1.5, 0.95))
                    Z = R.standard_normal((sims, 1))
                    X = np.sqrt(rho) * Z + np.sqrt(1 - rho) * R.standard_normal((sims, Fm))
                    sizes = np.minimum(np.abs(R.normal(pay_mu * 1.2, pay_sd, (sims, Fm))), pay_cap)
                    po = ((X < th_j) * sizes).sum(axis=1)
                else:
                    po = month_payouts(sims, Fm, rho)
                fee = signups_mo * g * fee_per_signup
                if scen in ('rev_shock', 'combined') and 6 <= m <= 11:
                    fee *= 0.60
                C = C + fee - fixed_mo - po
                ruined |= (C < 0)
            out['ruin'][f'{scen}|{cap0}'] = float(ruined.mean())
    return out

if __name__ == '__main__':
    res = run_all()
    res['plans'] = run_firm_plans()
    res['risk'] = portfolio_risk()
    with open('/home/claude/mc_lifecycle.json','w') as f:
        json.dump(res, f, indent=2)
    def line(k,d):
        print(f"{k:26s} pass={d.get('eval_pass',0)*100:5.1f}%  funded->pay={d['reached_rate']*100:5.1f}%  "
              f"overall={d.get('overall_paid',0)*100:5.2f}%  avgPO/payer={d['avg_payouts_per_payer']:4.1f}  "
              f"avg$50k={d['avg_payout_50k']:7.0f}  firm$/funded={d['avg_firmcost_per_funded']:7.0f}")
    print('=== BASELINE ==='); line('baseline', res['baseline'])
    print('\n=== FIRM PLANS (run through model) ===')
    for p in res['plans']:
        print(f"{p['firm'][:14]:14s} {p['plan'][:16]:16s} {p['struct'][:20]:20s} "
              f"pass={p['eval_pass']*100:5.1f}%  f->p={p['reached']*100:5.1f}%  "
              f"firm$/f=${p['firm_cost_50k']:6.0f}  payout=${p['payout50']:5.0f}")
