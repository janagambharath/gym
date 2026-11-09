import{d as E,e as w,v as h,s as z,n as L,t as M,g as T,f as P}from"./index-DYUtf5t4.js";const B={async mount(r,s){await f(r,s),E(r,()=>f(r,s,!0),15e3)}},a=P;let x=!1,v=null;const y=r=>r.id??`${r.punch_time||""}|${r.direction||""}|${r.biometric_user_id||""}`;let n=1,m=1,S=0,o=[];async function f(r,s,l=!1,c=!1){const b=s?.id;if(!b){r.innerHTML='<main class="rrr-page"><p>No member specified.</p></main>';return}!l&&!c&&(n=1,o=[],r.innerHTML='<div class="rrr-loading">Loading biometric records…</div>');const $=c?n+1:n;let e;if(l){const t=await Promise.all(Array.from({length:n},(i,g)=>w(`/api/mobile/v1/rrr/member/${b}/attendance?page=${g+1}&per_page=50`)));e=t.find(i=>!i.ok)||t[t.length-1],e.ok&&(o=h(t.flatMap(i=>i.data.events||[]),y),m=e.data.pagination?.total_pages??m)}else e=await w(`/api/mobile/v1/rrr/member/${b}/attendance?page=${$}&per_page=50`);if(!e.ok){if(l){x||(x=!0,z("Could not refresh the biometric records — showing the last loaded punches.","error"));const t=r.querySelector("#rrr-att-count");t&&v&&(t.textContent=`Showing ${o.length} of ${S} punches · last updated ${T(v)}`);return}if(c){z(e.error?.message||"Could not load more records.","error");return}r.innerHTML=`<main class="rrr-page rrr-detail">
      <header class="rrr-header"><button id="rrr-back" class="rrr-back-btn">← Member</button></header>
      <h1>Biometric Records</h1>
      <p>Could not load records: ${a(e.error?.message||"Unknown error")}</p>
      <button class="btn btn-primary" id="rrr-retry">Try Again</button>
    </main>`,r.querySelector("#rrr-back")?.addEventListener("click",()=>L.back()),r.querySelector("#rrr-retry")?.addEventListener("click",()=>f(r,s));return}x=!1,v=new Date;const d=e.data,k=d.member||{};l||(m=d.pagination?.total_pages??1,o=c?h([...o,...d.events||[]],y):h(d.events||[],y),c&&(n=$));const p=o,_=d.stats||{},u=_.total_punches??p.length;S=u,r.innerHTML=`<main class="rrr-page rrr-detail">
    <header class="rrr-header">
      <button id="rrr-back" class="rrr-back-btn">← Member</button>
      <div class="rrr-brand"><b>RRR</b><span>Biometric records</span></div>
    </header>
    
    <div class="rrr-att-hero">
      <h1>${a(k.name||"Member")}</h1>
      <p class="rrr-att-sub">Biometric ID ${a(k.enroll_number||"—")}</p>
      <div class="rrr-att-stats">
        <div class="rrr-stat">
          <span class="rrr-stat-num">${u}</span>
          <span class="rrr-stat-label">Total punches</span>
        </div>
        <div class="rrr-stat">
          <span class="rrr-stat-num">${_.last_30_days||0}</span>
          <span class="rrr-stat-label">Last 30 days</span>
        </div>
      </div>
    </div>

    ${p.length?`
    <div class="rrr-att-list">
      ${p.map(t=>{const i=M(t.punch_time),g=T(t.punch_time);return`<div class="rrr-att-item">
          <div class="rrr-att-icon">→</div>
          <div class="rrr-att-info">
            <div class="rrr-att-date">${i} <span class="rrr-att-time">${g}</span></div>
          <div class="rrr-att-meta">${[t.biometric_user_id?`ID ${a(t.biometric_user_id)}`:"",t.device_serial?a(t.device_serial):"",a(t.verify_method||t.source||"Entry")].filter(Boolean).join(" · ")}</div>
          </div>
          <span class="rrr-att-badge">${a(t.direction==="exit"?"Exit":"Entry")}</span>
        </div>`}).join("")}
    </div>
    <div style="text-align:center;padding:var(--sp-md)">
      <div id="rrr-att-count" style="font-size:var(--fs-sm);color:var(--muted);margin-bottom:var(--sp-sm)">Showing ${p.length} of ${u} punches</div>
      ${n<m?'<button class="btn btn-secondary" id="rrr-att-more">Load more</button>':""}
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
  </style>`,r.querySelector("#rrr-back")?.addEventListener("click",()=>L.back()),r.querySelector("#rrr-att-more")?.addEventListener("click",()=>{f(r,s,!1,!0)})}export{B as default};
