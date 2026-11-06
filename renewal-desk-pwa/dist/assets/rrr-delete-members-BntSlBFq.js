import{g as x,s as q,v as k,n as z,j as E}from"./index-ByhK-z4i.js";let o=1,y=0,$=1,c="",p=[];const D={async mount(r){await m(r)}},a=E;async function m(r,n=!1){n||(o=1,p=[],r.innerHTML='<div class="rrr-loading">Loading members…</div>');const f=n?o+1:o,t=await x(`/api/mobile/v1/members?page=${f}&page_size=50${c?`&q=${encodeURIComponent(c)}`:""}`);if(!t.ok){if(n){q(t.error?.message||"Could not load more members.","error");return}r.innerHTML='<main class="rrr-page"><h1>Failed to load</h1><button onclick="history.back()">Back</button></main>';return}y=t.data.pagination?.total??0,$=t.data.pagination?.total_pages??1,n&&(o=f),p=n?k([...p,...t.data.members||[]],e=>e.id):k(t.data.members||[],e=>e.id);const b=p;r.innerHTML=`<main class="rrr-page rrr-detail">
    <header class="rrr-header">
      <button id="rrr-back" class="rrr-back-btn">← Back</button>
      <div class="rrr-brand"><b>RRR</b><span>Terminal members</span></div>
    </header>
    
    <div class="rrr-del-hero">
      <h1>Deactivate Members</h1>
      <p>Select members to deactivate in Renewal Desk. Deactivation ends their membership and blocks terminal access — their records are kept, not permanently deleted. To permanently erase a member, use the admin panel.</p>
    </div>
    <div style="margin-bottom:var(--sp-md)"><input class="form-input" id="rrr-del-search" type="search" placeholder="Search by name or phone…" value="${a(c)}" style="width:100%"></div>
    <div style="font-size:var(--fs-sm);color:var(--muted);margin-bottom:var(--sp-sm)">Showing ${b.length} of ${y} members</div>
    
    <div class="rrr-del-toolbar">
      <label class="rrr-select-all">
        <input type="checkbox" id="rrr-select-all">
        <span>Select all (${b.length})</span>
      </label>
      <span id="rrr-selected-count" class="rrr-count">0 selected</span>
    </div>
    
    <div class="rrr-del-list" id="rrr-member-list">
      ${b.map(e=>`
        <label class="rrr-del-item">
          <input type="checkbox" class="rrr-del-check" value="${e.id}" data-enroll="${a(e.device_enroll_number||"")}">
          <div class="rrr-del-info">
            <div class="rrr-del-name">${a(e.full_name||e.first_name||"Unknown")}</div>
            <div class="rrr-del-meta">ID ${a(e.device_enroll_number||"")} · ${a(e.status||"")} ${e.membership_end?"· ends "+a(e.membership_end):""}</div>
          </div>
          ${e.status==="expired"?'<span class="rrr-expired-badge">EXPIRED</span>':""}
        </label>
      `).join("")||'<p class="rrr-no-data">No members with terminal enroll numbers.</p>'}
    </div>
    
    <div class="rrr-del-footer">
      <button id="rrr-delete-btn" class="rrr-delete-btn" disabled>🗑️ Deactivate Selected</button>
    </div>
    ${o<$?'<div style="text-align:center;padding:var(--sp-md)"><button class="btn btn-secondary" id="rrr-del-more">Load more members</button></div>':""}
    <div id="rrr-del-result"></div>
  </main>
  <style>
    .rrr-del-hero h1 { font-size: 24px; font-weight: 800; margin: 0 0 8px 0; }
    .rrr-del-hero p { color: #64748b; font-size: 14px; margin: 0 0 16px 0; line-height: 1.5; }
    .rrr-del-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e2e8f0; margin-bottom: 8px; position: sticky; top: 0; background: #fff; z-index: 10; }
    .rrr-select-all { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; cursor: pointer; }
    .rrr-select-all input { width: 20px; height: 20px; accent-color: #dc2626; }
    .rrr-count { font-size: 13px; color: #64748b; }
    .rrr-del-list { display: flex; flex-direction: column; }
    .rrr-del-item { display: flex; align-items: center; gap: 12px; padding: 14px 4px; border-bottom: 1px solid #f1f5f9; cursor: pointer; }
    .rrr-del-item:active { background: #f8fafc; }
    .rrr-del-check { width: 22px; height: 22px; accent-color: #dc2626; flex-shrink: 0; }
    .rrr-del-info { flex: 1; min-width: 0; }
    .rrr-del-name { font-weight: 600; font-size: 15px; }
    .rrr-del-meta { font-size: 12px; color: #64748b; margin-top: 2px; }
    .rrr-expired-badge { background: #fee2e2; color: #b91c1c; font-size: 10px; font-weight: 800; padding: 4px 8px; border-radius: 6px; }
    .rrr-del-footer { position: sticky; bottom: 0; background: #fff; padding: 16px 0; border-top: 1px solid #e2e8f0; }
    .rrr-delete-btn { width: 100%; background: #dc2626; color: #fff; border: none; padding: 16px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; }
    .rrr-delete-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .rrr-back-btn { background: none; border: none; color: #3b82f6; font-size: 15px; font-weight: 600; cursor: pointer; }
  </style>`,r.querySelector("#rrr-back")?.addEventListener("click",()=>z.back());let g;r.querySelector("#rrr-del-search")?.addEventListener("input",e=>{clearTimeout(g),g=setTimeout(()=>{c=e.target.value.trim(),m(r)},400)}),r.querySelector("#rrr-del-more")?.addEventListener("click",()=>{m(r,!0)});const s=r.querySelector("#rrr-select-all"),d=r.querySelectorAll(".rrr-del-check"),w=r.querySelector("#rrr-selected-count"),l=r.querySelector("#rrr-delete-btn");function v(){const e=r.querySelectorAll(".rrr-del-check:checked").length;w.textContent=`${e} selected`,l.disabled=e===0,l.textContent=e?`🗑️ Deactivate ${e} member${e===1?"":"s"}`:"🗑️ Deactivate Selected",s.checked=e===d.length&&e>0,s.indeterminate=e>0&&e<d.length}s?.addEventListener("change",()=>{d.forEach(e=>e.checked=s.checked),v()}),d.forEach(e=>e.addEventListener("change",v)),l?.addEventListener("click",async()=>{const e=[...r.querySelectorAll(".rrr-del-check:checked")].map(h=>h.value);if(!e.length||!confirm(`Deactivate ${e.length} member(s)? Their membership ends and terminal access is blocked. Records are kept.`))return;l.disabled=!0,l.textContent="Deactivating...";const S=r.querySelector("#rrr-del-result");let u=0,i=0;for(const h of e)try{(await x(`/api/mobile/v1/members/${h}/deactivate`,{method:"POST"})).ok?u++:i++}catch{i++}S.innerHTML=`<p style="padding:16px;text-align:center;font-weight:600;color:${i?"#d97706":"#16a34a"};">
      ${i?`✓ ${u} deactivated, ⚠ ${i} failed`:`✓ All ${u} deactivated`}
    </p>`,setTimeout(()=>m(r),2e3)})}export{D as default};
