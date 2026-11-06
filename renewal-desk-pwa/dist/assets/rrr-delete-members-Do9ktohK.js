import{g as v,n as S,j as T}from"./index-Ca8zdeLr.js";let o=1,x=0,k=1,s="",c=[];const z={async mount(r){await p(r)}},t=T;async function p(r,m=!1){m||(o=1,c=[],r.innerHTML='<div class="rrr-loading">Loading members…</div>');const a=await v(`/api/mobile/v1/members?page=${o}&page_size=50${s?`&q=${encodeURIComponent(s)}`:""}`);if(!a.ok){if(m)return;r.innerHTML='<main class="rrr-page"><h1>Failed to load</h1><button onclick="history.back()">Back</button></main>';return}x=a.data.pagination?.total??0,k=a.data.pagination?.total_pages??1,c=m?[...c,...a.data.members||[]]:a.data.members||[];const b=c;r.innerHTML=`<main class="rrr-page rrr-detail">
    <header class="rrr-header">
      <button id="rrr-back" class="rrr-back-btn">← Back</button>
      <div class="rrr-brand"><b>RRR</b><span>Terminal members</span></div>
    </header>
    
    <div class="rrr-del-hero">
      <h1>Deactivate Members</h1>
      <p>Select members to deactivate in Renewal Desk. Deactivation ends their membership and blocks terminal access — their records are kept, not permanently deleted. To permanently erase a member, use the admin panel.</p>
    </div>
    <div style="margin-bottom:var(--sp-md)"><input class="form-input" id="rrr-del-search" type="search" placeholder="Search by name or phone…" value="${t(s)}" style="width:100%"></div>
    <div style="font-size:var(--fs-sm);color:var(--muted);margin-bottom:var(--sp-sm)">Showing ${b.length} of ${x} members</div>
    
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
          <input type="checkbox" class="rrr-del-check" value="${e.id}" data-enroll="${t(e.device_enroll_number||"")}">
          <div class="rrr-del-info">
            <div class="rrr-del-name">${t(e.full_name||e.first_name||"Unknown")}</div>
            <div class="rrr-del-meta">ID ${t(e.device_enroll_number||"")} · ${t(e.status||"")} ${e.membership_end?"· ends "+t(e.membership_end):""}</div>
          </div>
          ${e.status==="expired"?'<span class="rrr-expired-badge">EXPIRED</span>':""}
        </label>
      `).join("")||'<p class="rrr-no-data">No members with terminal enroll numbers.</p>'}
    </div>
    
    <div class="rrr-del-footer">
      <button id="rrr-delete-btn" class="rrr-delete-btn" disabled>🗑️ Deactivate Selected</button>
    </div>
    ${o<k?'<div style="text-align:center;padding:var(--sp-md)"><button class="btn btn-secondary" id="rrr-del-more">Load more members</button></div>':""}
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
  </style>`,r.querySelector("#rrr-back")?.addEventListener("click",()=>S.back());let f;r.querySelector("#rrr-del-search")?.addEventListener("input",e=>{clearTimeout(f),f=setTimeout(()=>{s=e.target.value.trim(),p(r)},400)}),r.querySelector("#rrr-del-more")?.addEventListener("click",()=>{o++,p(r,!0)});const i=r.querySelector("#rrr-select-all"),d=r.querySelectorAll(".rrr-del-check"),y=r.querySelector("#rrr-selected-count"),n=r.querySelector("#rrr-delete-btn");function g(){const e=r.querySelectorAll(".rrr-del-check:checked").length;y.textContent=`${e} selected`,n.disabled=e===0,n.textContent=e?`🗑️ Deactivate ${e} member${e===1?"":"s"}`:"🗑️ Deactivate Selected",i.checked=e===d.length&&e>0,i.indeterminate=e>0&&e<d.length}i?.addEventListener("change",()=>{d.forEach(e=>e.checked=i.checked),g()}),d.forEach(e=>e.addEventListener("change",g)),n?.addEventListener("click",async()=>{const e=[...r.querySelectorAll(".rrr-del-check:checked")].map(h=>h.value);if(!e.length||!confirm(`Deactivate ${e.length} member(s)? Their membership ends and terminal access is blocked. Records are kept.`))return;n.disabled=!0,n.textContent="Deactivating...";const $=r.querySelector("#rrr-del-result");let u=0,l=0;for(const h of e)try{(await v(`/api/mobile/v1/members/${h}/deactivate`,{method:"POST"})).ok?u++:l++}catch{l++}$.innerHTML=`<p style="padding:16px;text-align:center;font-weight:600;color:${l?"#d97706":"#16a34a"};">
      ${l?`✓ ${u} deactivated, ⚠ ${l} failed`:`✓ All ${u} deactivated`}
    </p>`,setTimeout(()=>p(r),2e3)})}export{z as default};
