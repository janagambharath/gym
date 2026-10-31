import{f,n as l,g as x}from"./index-aURVZMHD.js";const u={async mount(r,a){await g(r,a)}},t=x;async function g(r,a){const o=a?.id;if(!o){r.innerHTML='<main class="rrr-page"><p>No member specified.</p></main>';return}r.innerHTML='<div class="rrr-loading">Loading biometric records…</div>';const s=await f(`/api/mobile/v1/rrr/member/${o}/attendance?page=1&per_page=50`);if(!s.ok){r.innerHTML=`<main class="rrr-page rrr-detail">
      <header class="rrr-header"><button id="rrr-back" class="rrr-back-btn">← Member</button></header>
      <h1>Biometric Records</h1>
      <p>Could not load records: ${t(s.error?.message||"Unknown error")}</p>
    </main>`,r.querySelector("#rrr-back")?.addEventListener("click",()=>l.back());return}const n=s.data,c=n.member||{},i=n.events||[],d=n.stats||{};r.innerHTML=`<main class="rrr-page rrr-detail">
    <header class="rrr-header">
      <button id="rrr-back" class="rrr-back-btn">← Member</button>
      <div class="rrr-brand"><b>RRR</b><span>Biometric records</span></div>
    </header>
    
    <div class="rrr-att-hero">
      <h1>${t(c.name||"Member")}</h1>
      <p class="rrr-att-sub">Biometric ID ${t(c.enroll_number||"—")}</p>
      <div class="rrr-att-stats">
        <div class="rrr-stat">
          <span class="rrr-stat-num">${d.total_punches||i.length}</span>
          <span class="rrr-stat-label">Total punches</span>
        </div>
        <div class="rrr-stat">
          <span class="rrr-stat-num">${d.last_30_days||0}</span>
          <span class="rrr-stat-label">Last 30 days</span>
        </div>
      </div>
    </div>

    ${i.length?`
    <div class="rrr-att-list">
      ${i.map(e=>{const p=new Date(e.punch_time),m=p.toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}),b=p.toLocaleTimeString("en-IN",{hour:"numeric",minute:"2-digit",hour12:!0});return`<div class="rrr-att-item">
          <div class="rrr-att-icon">→</div>
          <div class="rrr-att-info">
            <div class="rrr-att-date">${m} <span class="rrr-att-time">${b}</span></div>
            <div class="rrr-att-meta">${t(e.device_serial||"")} · ${t(e.verify_method||"Entry")}</div>
          </div>
          <span class="rrr-att-badge">${t(e.direction==="exit"?"Exit":"Entry")}</span>
        </div>`}).join("")}
    </div>`:`
    <div class="rrr-empty-state">
      <div class="rrr-empty-icon">⌁</div>
      <h2>No punches yet</h2>
      <p>This member hasn't punched on the biometric terminal yet.</p>
    </div>`}
  </main>
  <style>
    .rrr-att-hero { margin-bottom: 20px; }
    .rrr-att-hero h1 { font-size: 24px; font-weight: 800; margin: 0 0 4px 0; }
    .rrr-att-sub { color: #64748b; font-size: 14px; margin: 0 0 16px 0; }
    .rrr-att-stats { display: flex; gap: 12px; }
    .rrr-stat { background: #f1f5f9; border-radius: 12px; padding: 12px 20px; text-align: center; min-width: 100px; }
    .rrr-stat-num { display: block; font-size: 24px; font-weight: 800; color: #0f172a; }
    .rrr-stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
    .rrr-back-btn { background: none; border: none; color: #3b82f6; font-size: 15px; font-weight: 600; cursor: pointer; padding: 8px 0; }
    .rrr-att-list { display: flex; flex-direction: column; }
    .rrr-att-item { display: flex; align-items: center; gap: 12px; padding: 14px 4px; border-bottom: 1px solid #f1f5f9; }
    .rrr-att-icon { width: 40px; height: 40px; background: #dcfce7; color: #16a34a; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; flex-shrink: 0; }
    .rrr-att-info { flex: 1; }
    .rrr-att-date { font-weight: 600; font-size: 14px; }
    .rrr-att-time { color: #64748b; font-weight: 400; }
    .rrr-att-meta { font-size: 12px; color: #94a3b8; margin-top: 2px; }
    .rrr-att-badge { background: #dcfce7; color: #16a34a; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 12px; }
    .rrr-empty-state { text-align: center; padding: 48px 24px; }
    .rrr-empty-icon { width: 64px; height: 64px; background: #f1f5f9; color: #94a3b8; font-size: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; }
    .rrr-empty-state h2 { font-size: 18px; margin: 0 0 8px 0; }
    .rrr-empty-state p { color: #64748b; font-size: 14px; margin: 0; }
  </style>`,r.querySelector("#rrr-back")?.addEventListener("click",()=>l.back())}export{u as default};
