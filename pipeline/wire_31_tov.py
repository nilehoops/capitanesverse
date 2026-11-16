import re

with open("js/shot-charts.js", encoding="utf-8") as f:
    js = f.read()

new_tov_card = '''function buildTurnoverCard(label, offTovs, defTovs, isIndividual, pid, playerShots, playerFts) {
  if ((!offTovs || !offTovs.length) && (!defTovs || !defTovs.length)) return '';

  const splitPassScore = (list) => {
    let pass = 0, scoring = 0;
    list.forEach(t => {
      const s = (t.sub || '').toLowerCase();
      if (s.includes('bad pass')) pass++;
      else scoring++;
    });
    return { tot: list.length, pass, scoring };
  };

  // Verified 558-game G League TM_TOV_PCT * full-season Passing/Scoring share
  const lgFf = _shotData?.leagueFourFactors || {};
  const passShare = lgFf.pass_share != null ? (lgFf.pass_share / 100) : 0.4358;
  const scoreShare = lgFf.score_share != null ? (lgFf.score_share / 100) : 0.5642;
  const lgTotTov = lgFf.tov_pct != null ? lgFf.tov_pct : 15.12;
  const LG_PASS_RATE = lgTotTov * passShare;
  const LG_SCORE_RATE = lgTotTov * scoreShare;

  const fmtLgDelta = (val, base) => {
    const d = val - base;
    const col = d >= 1.5 ? 'var(--red)' : (d <= -1.5 ? 'var(--green)' : 'var(--dim)');
    return `<span style="color:${col};font-weight:700;">${d >= 0 ? '+' : ''}${d.toFixed(1)}% vs LG</span>`;
  };

  if (isIndividual && pid) {
    const pTovs = offTovs.filter(t => t.pid === pid);
    if (!pTovs.length) return '';

    const pShots = playerShots || [];
    const pFts = playerFts || [];
    const pFtTrips = pFts.filter(f => !f.and1 && f.val > 0).length / 2;
    const pUsed = Math.max(1, pShots.length + pFtTrips + pTovs.length);

    const pCat = splitPassScore(pTovs);
    const passRate = (pCat.pass / pUsed) * 100;
    const scoreRate = (pCat.scoring / pUsed) * 100;
    const totRate = (pCat.tot / pUsed) * 100;

    return `
      <div class="sc-card">
        <div class="sc-card-title" style="font-size:13px;">Passing vs. Scoring Turnovers (League-Relative) — ${label}</div>
        <div class="sc-card-sub">
          Total: <b>${pCat.tot}</b> TOVs across <b>${Math.round(pUsed)}</b> Plays Used (<b>${totRate.toFixed(1)}%</b> Indiv TOV% · ${fmtLgDelta(totRate, lgTotTov)})
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:10.5px;">
          <thead>
            <tr style="background:var(--surface);color:var(--muted);font-family:'Oswald',sans-serif;">
              <th style="padding:3px 5px;text-align:left;border-bottom:1px solid var(--border);">Category</th>
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">Count</th>
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">TOV Share</th>
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">Rate / Play</th>
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">LG Avg</th>
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">vs. League</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding:3px 5px;border-bottom:1px solid var(--border);font-weight:600;">Passing Turnovers</td>
              <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${pCat.pass}</td>
              <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${((pCat.pass / pCat.tot) * 100).toFixed(0)}%</td>
              <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;">${passRate.toFixed(1)}%</td>
              <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;color:var(--muted);">${LG_PASS_RATE.toFixed(1)}%</td>
              <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${fmtLgDelta(passRate, LG_PASS_RATE)}</td>
            </tr>
            <tr>
              <td style="padding:3px 5px;border-bottom:1px solid var(--border);font-weight:600;">Scoring Turnovers</td>
              <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${pCat.scoring}</td>
              <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${((pCat.scoring / pCat.tot) * 100).toFixed(0)}%</td>
              <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;">${scoreRate.toFixed(1)}%</td>
              <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;color:var(--muted);">${LG_SCORE_RATE.toFixed(1)}%</td>
              <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${fmtLgDelta(scoreRate, LG_SCORE_RATE)}</td>
            </tr>
          </tbody>
        </table>
      </div>`;
  }

  const mxc = splitPassScore(offTovs);
  const opp = splitPassScore(defTovs);

  return `
    <div class="sc-card">
      <div class="sc-card-title" style="font-size:13px;">Passing vs. Scoring Turnovers — ${label}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px;font-size:10.5px;">
        <div style="border:1px solid var(--border);padding:5px 7px;background:var(--surface);">
          <div style="font-family:'Oswald',sans-serif;font-weight:700;color:var(--red);margin-bottom:2px;">CAPITANES TOVs (${mxc.tot})</div>
          <div>Passing: <b>${mxc.pass}</b> (${mxc.tot ? ((mxc.pass / mxc.tot) * 100).toFixed(0) : 0}%) · Scoring: <b>${mxc.scoring}</b> (${mxc.tot ? ((mxc.scoring / mxc.tot) * 100).toFixed(0) : 0}%)</div>
        </div>
        <div style="border:1px solid var(--border);padding:5px 7px;background:var(--surface);">
          <div style="font-family:'Oswald',sans-serif;font-weight:700;color:var(--green);margin-bottom:2px;">FORCED OPP TOVs (${opp.tot})</div>
          <div>Passing: <b>${opp.pass}</b> (${opp.tot ? ((opp.pass / opp.tot) * 100).toFixed(0) : 0}%) · Scoring: <b>${opp.scoring}</b> (${opp.tot ? ((opp.scoring / opp.tot) * 100).toFixed(0) : 0}%)</div>
        </div>
      </div>
    </div>`;
}'''

start = js.find('function buildTurnoverCard(')
end = js.find('\nfunction ', start + 1)
if start != -1:
    js = js[:start] + new_tov_card + (js[end:] if end != -1 else '\n')
    js = js.replace(
        'buildTurnoverCard(playerName, baseTovs.filter(t => t.side === \'off\'), baseTovs.filter(t => t.side === \'def\'), pid !== null, pid)',
        'buildTurnoverCard(playerName, baseTovs.filter(t => t.side === \'off\'), baseTovs.filter(t => t.side === \'def\'), pid !== null, pid, sub, subFts)'
    )
    with open("js/shot-charts.js", "w", encoding="utf-8") as f:
        f.write(js)
    with open("shotcharts.html", encoding="utf-8") as f:
        h = f.read()
    h = re.sub(r'shot-charts\.js(\?v=\d+)?', 'shot-charts.js?v=47', h)
    with open("shotcharts.html", "w", encoding="utf-8") as f:
        f.write(h)
    print("Replaced buildTurnoverCard cleanly with 558-game benchmarks (v=47)!")
