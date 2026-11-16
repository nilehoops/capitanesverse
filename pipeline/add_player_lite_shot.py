import re

with open("player.html", encoding="utf-8") as f:
    h = f.read()

if 'id="liteShotCard"' not in h:
    h = h.replace(
        '<div class="compare-section" id="compareSection"></div>',
        '<div id="liteShotCard" style="margin:14px 0;"></div>\n        <div class="compare-section" id="compareSection"></div>'
    )

lite_widget = '''<script>
(async function initPlayerLiteShotChart() {
  const ZONES_CFG = {
    "Restricted Area":        { lx: 0,    ly: 18,  path: "M -40 -47.5 L -40 0 A 40 40 0 0 0 40 0 L 40 -47.5 Z" },
    "Paint (Non-RA)":         { lx: 0,    ly: 98,  path: "M -80 -47.5 L -80 142.5 L 80 142.5 L 80 -47.5 L 40 -47.5 L 40 0 A 40 40 0 0 1 -40 0 L -40 -47.5 Z" },
    "Left Baseline Mid":      { lx: -145, ly: 20,  path: "M -220 -47.5 L -80 -47.5 L -80 85 L -220 85 Z" },
    "Right Baseline Mid":     { lx: 145,  ly: 20,  path: "M 80 -47.5 L 220 -47.5 L 220 85 L 80 85 Z" },
    "Left Elbow / Wing Mid":  { lx: -135, ly: 145, path: "M -220 85 L -80 85 L -80 142.5 L -75 225 L -165 170 A 237.5 237.5 0 0 1 -220 92.5 Z" },
    "Right Elbow / Wing Mid": { lx: 135,  ly: 145, path: "M 80 85 L 220 85 L 220 92.5 A 237.5 237.5 0 0 1 165 170 L 75 225 L 80 142.5 Z" },
    "Center Mid-Range":       { lx: 0,    ly: 190, path: "M -80 142.5 L 80 142.5 L 75 225 A 237.5 237.5 0 0 1 -75 225 Z" },
    "Left Corner 3":          { lx: -235, ly: 22,  path: "M -250 -47.5 L -220 -47.5 L -220 92.5 L -250 92.5 Z" },
    "Right Corner 3":         { lx: 235,  ly: 22,  path: "M 220 -47.5 L 250 -47.5 L 250 92.5 L 220 92.5 Z" },
    "Left Wing 3":            { lx: -175, ly: 255, path: "M -250 92.5 L -220 92.5 A 237.5 237.5 0 0 0 -165 170 L -85 222 L -115 422.5 L -250 422.5 Z" },
    "Right Wing 3":           { lx: 175,  ly: 255, path: "M 220 92.5 L 250 92.5 L 250 422.5 L 115 422.5 L 85 222 L 165 170 A 237.5 237.5 0 0 0 220 92.5 Z" },
    "Center / Top 3":         { lx: 0,    ly: 300, path: "M -85 222 A 237.5 237.5 0 0 0 85 222 L 115 422.5 L -115 422.5 Z" }
  };

  function getHeat(diff) {
    if (diff >= 5) return { fill: '#D81F2A', txt: '#FFFFFF' };
    if (diff >= 2) return { fill: '#F07D7B', txt: '#111111' };
    if (diff > -2) return { fill: '#EAECEF', txt: '#111111' };
    if (diff > -5) return { fill: '#7BAFD4', txt: '#111111' };
    return { fill: '#004B8D', txt: '#FFFFFF' };
  }

  const params = new URLSearchParams(window.location.search);
  const qName = params.get('name');
  const qId = params.get('id');

  const [d27, d26, idxResp] = await Promise.all([
    fetch('data/league_lite_shots_2026-27.json?v=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('data/league_lite_shots_2025-26.json?v=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('data/players_index.json?v=' + Date.now()).then(r => r.ok ? r.json() : []).catch(() => [])
  ]);

  let targetName = (qName || '').trim();
  if (!targetName && qId) {
    const arr = Array.isArray(idxResp) ? idxResp : Object.values(idxResp);
    const hit = arr.find(p => String(p.id) === String(qId));
    if (hit) targetName = hit.name;
  }
  if (!targetName) {
    const h1 = document.querySelector('#app h1, #app .player-name');
    if (h1) targetName = h1.textContent.trim();
  }
  if (!targetName) return;

  const findIn = (ds) => ds?.players?.find(p => p.name.toLowerCase() === targetName.toLowerCase());
  const p27 = findIn(d27);
  const p26 = findIn(d26);
  if (!p27 && !p26) return;

  const appEl = document.getElementById('app');
  if (qName && appEl && (!appEl.innerHTML.trim() || appEl.textContent.includes('not found'))) {
    const pObj = p27 || p26;
    appEl.innerHTML = `<div style="max-width:1050px;margin:16px auto;padding:0 14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid var(--blue,#004B8D);padding-bottom:6px;margin-bottom:10px;">
        <div>
          <h1 style="margin:0;font-family:'Oswald',sans-serif;font-size:22px;color:var(--blue,#004B8D);">${pObj.name}</h1>
          <div style="font-size:12px;color:#555;font-weight:600;">${pObj.team} (${pObj.abbrev || 'G League'})</div>
        </div>
        <div style="font-family:'Oswald',sans-serif;font-size:11px;font-weight:700;display:flex;gap:10px;">
          <a href="team.html?team=${encodeURIComponent(pObj.abbrev || pObj.team)}" style="color:var(--blue,#004B8D);">Team Shot Profile</a>
          <a href="index.html" style="color:#666;">← Home</a>
        </div>
      </div>
      <div id="liteShotCard"></div>
    </div>`;
  }
  function renderSeason(szn) {
    const ds = szn === '2026-27' ? d27 : d26;
    const pObj = szn === '2026-27' ? p27 : p26;
    const host = document.getElementById('liteShotCard');
    if (!host || !ds || !pObj) return;

    const lgZ = ds.leagueZones || {};
    let totM = 0, totA = 0, m3 = 0, a3 = 0;
    Object.entries(pObj.zones).forEach(([z, [m, a]]) => {
      totM += m; totA += a;
      if (z.includes('3')) { m3 += m; a3 += a; }
    });
    const m2 = totM - m3, a2 = totA - a3;
    const efg = totA ? (((totM + 0.5 * m3) / totA) * 100).toFixed(1) : '0.0';
    const threePar = totA ? ((a3 / totA) * 100).toFixed(1) : '0.0';

    let poly = '', lbl = '', rows = '';
    Object.entries(ZONES_CFG).forEach(([z, cfg]) => {
      const [m, a] = pObj.zones[z] ||;
      const [lm, la] = lgZ[z] ||;
      const pct = a > 0 ? (m / a) * 100 : 0;
      const lgPct = la > 0 ? (lm / la) * 100 : 40;
      const diff = a > 0 ? (pct - lgPct) : 0;
      const share = totA > 0 ? (a / totA) * 100 : 0;
      const c = a > 0 ? getHeat(diff) : { fill: '#F4F4F4', txt: '#888' };
      const isCorner = z.includes('Corner');

      poly += `<path d="${cfg.path}" fill="${c.fill}" stroke="#FFFFFF" stroke-width="1.5"/>`;
      lbl += `<g transform="translate(${cfg.lx},${cfg.ly})" pointer-events="none">
        <text x="0" y="-3" text-anchor="middle" font-family="Oswald,sans-serif" font-size="${isCorner ? 12 : 15}" font-weight="700" fill="${c.txt}">${a ? pct.toFixed(1)+'%' : '—'}</text>
        <text x="0" y="9" text-anchor="middle" font-family="Oswald,sans-serif" font-size="${isCorner ? 9 : 10.5}" font-weight="600" fill="${c.txt}">${isCorner ? share.toFixed(0)+'% sh' : m+'/'+a+' ('+share.toFixed(0)+'%)'}</text>
      </g>`;

      const dCol = diff >= 2 ? '#18AF4A' : (diff <= -2 ? '#D81F2A' : '#666');
      rows += `<tr>
        <td style="padding:2px 5px;border-bottom:1px solid #E2E5E9;font-weight:600;">${z}</td>
        <td style="padding:2px 5px;border-bottom:1px solid #E2E5E9;text-align:right;">${m}-${a}</td>
        <td style="padding:2px 5px;border-bottom:1px solid #E2E5E9;text-align:right;font-weight:700;">${a ? pct.toFixed(1)+'%' : '—'}</td>
        <td style="padding:2px 5px;border-bottom:1px solid #E2E5E9;text-align:right;">${share.toFixed(1)}%</td>
        <td style="padding:2px 5px;border-bottom:1px solid #E2E5E9;text-align:right;color:${dCol};font-weight:700;">${a ? (diff>=0?'+':'')+diff.toFixed(1)+'%' : '—'}</td>
      </tr>`;
    });

    const court = `<g fill="none" stroke="#222" stroke-width="1.5">
      <rect x="-250" y="-47.5" width="500" height="470"/>
      <rect x="-80" y="-47.5" width="160" height="190"/>
      <circle cx="0" cy="142.5" r="60"/>
      <path d="M -220 -47.5 L -220 92.5 A 237.5 237.5 0 0 0 220 92.5 L 220 -47.5"/>
      <circle cx="0" cy="0" r="7.5" stroke="#D81F2A" stroke-width="2"/>
    </g>`;

    const toggleHtml = (p27 && p26) ? `
      <select id="liteSznSel" style="font-family:'Lora',serif;font-size:11px;padding:1px 5px;border:1px solid #CCC;">
        <option value="2026-27" ${szn==='2026-27'?'selected':''}>2026-27</option>
        <option value="2025-26" ${szn==='2025-26'?'selected':''}>2025-26</option>
      </select>` : `<span style="font-size:11px;color:#666;">${szn}</span>`;

    host.innerHTML = `
      <div style="border:1px solid #D5D9DF;padding:10px 12px;background:#FFF;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <div style="font-family:'Oswald',sans-serif;font-weight:700;font-size:14px;color:#004B8D;">G League Shot Chart (${pObj.team})</div>
          ${toggleHtml}
        </div>
        <div style="font-size:11px;color:#444;font-weight:600;margin-bottom:8px;">
          FGM-FGA: ${totM}-${totA} (${totA ? ((totM/totA)*100).toFixed(1) : 0}%) · eFG%: ${efg}% · 2PT: ${m2}-${a2} (${a2 ? ((m2/a2)*100).toFixed(1) : 0}%) · 3PT: ${m3}-${a3} (${a3 ? ((m3/a3)*100).toFixed(1) : 0}%) · 3PAr: ${threePar}%
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;">
          <div style="flex:0 0 300px;max-width:100%;">
            <svg viewBox="-250 -47.5 500 470" style="width:100%;height:auto;display:block;border:1px solid #E2E5E9;background:#FAFAFA;">
              ${poly}${court}${lbl}
            </svg>
          </div>
          <div style="flex:1;min-width:260px;overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:10.5px;">
              <thead>
                <tr style="background:#F5F7FA;color:#666;font-family:'Oswald',sans-serif;">
                  <th style="padding:3px 5px;text-align:left;border-bottom:1px solid #E2E5E9;">Zone</th>
                  <th style="padding:3px 5px;text-align:right;border-bottom:1px solid #E2E5E9;">FGM-FGA</th>
                  <th style="padding:3px 5px;text-align:right;border-bottom:1px solid #E2E5E9;">FG%</th>
                  <th style="padding:3px 5px;text-align:right;border-bottom:1px solid #E2E5E9;">Share%</th>
                  <th style="padding:3px 5px;text-align:right;border-bottom:1px solid #E2E5E9;">vs LG</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      </div>`;

    const sel = document.getElementById('liteSznSel');
    if (sel) sel.addEventListener('change', () => renderSeason(sel.value));
  }

  renderSeason(p27 ? '2026-27' : '2025-26');
})();
</script>
</body>'''

if "initPlayerLiteShotChart" not in h:
    h = h.replace("</body>", lite_widget)

with open("player.html", "w", encoding="utf-8") as f:
    f.write(h)

for fn in ["index.html", "team.html"]:
    try:
        txt = open(fn, encoding="utf-8").read()
        txt = txt.replace("team.html?team=${encodeURIComponent(p.team || 'MXC')}", "player.html?name=${encodeURIComponent(p.name)}")
        txt = txt.replace("const href = pid ? `player.html?id=${encodeURIComponent(pid)}` : `shotcharts.html`;", "const href = pid ? `player.html?id=${encodeURIComponent(pid)}` : `player.html?name=${encodeURIComponent(p.name)}`;")
        open(fn, "w", encoding="utf-8").write(txt)
    except Exception:
        pass

print("Embedded 12-Zone Lite Shot Chart Card into player.html & linked all 2026-27 players!")
