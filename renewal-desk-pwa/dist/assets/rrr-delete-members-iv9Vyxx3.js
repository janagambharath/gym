import{f as b,n as g,g as x}from"./index-rYiQ1GM-.js";const v={async mount(r){await m(r)}},l=x;async function m(r){r.innerHTML='<div class="rrr-loading">Loading members…</div>';const s=await b("/api/mobile/v1/members?page=1&page_size=500");if(!s.ok){r.innerHTML='<main class="rrr-page"><h1>Failed to load</h1><button onclick="history.back()">Back</button></main>';return}const c=s.data.members||[];r.innerHTML=`<main class="rrr-page rrr-detail">
    <header class="rrr-header">
      <button id="rrr-back" class="rrr-back-btn">← Back</button>
      <div class="rrr-brand"><b>RRR</b><span>Terminal members</span></div>
    </header>
    
    <div class="rrr-del-hero">
      <h1>Delete Members</h1>
      <p>Select members to permanently delete from Renewal Desk. This removes them from the app. They'll also be removed from the terminal.</p>
    </div>
    
    <div class="rrr-del-toolbar">
      <label class="rrr-select-all">
        <input type="checkbox" id="rrr-select-all">
        <span>Select all (${c.length})</span>
      </label>
      <span id="rrr-selected-count" class="rrr-count">0 selected</span>
    </div>
    
    <div class="rrr-del-list" id="rrr-member-list">
      ${c.map(e=>`
        <label class="rrr-del-item">
          <input type="checkbox" class="rrr-del-check" value="${e.id}" data-enroll="${l(e.device_enroll_number||"")}">
          <div class="rrr-del-info">
            <div class="rrr-del-name">${l(e.full_name||e.first_name||"Unknown")}</div>
            <div class="rrr-del-meta">ID ${l(e.device_enroll_number||"")} · ${l(e.status||"")} ${e.membership_end?"· ends "+l(e.membership_end):""}</div>
          </div>
          ${e.status==="expired"?'<span class="rrr-expired-badge">EXPIRED</span>':""}
        </label>
      `).join("")||'<p class="rrr-no-data">No members with terminal enroll numbers.</p>'}
    </div>
    
    <div class="rrr-del-footer">
      <button id="rrr-delete-btn" class="rrr-delete-btn" disabled>🗑️ Delete Selected</button>
    </div>
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
  </style>`,r.querySelector("#rrr-back")?.addEventListener("click",()=>g.back());const o=r.querySelector("#rrr-select-all"),a=r.querySelectorAll(".rrr-del-check"),f=r.querySelector("#rrr-selected-count"),t=r.querySelector("#rrr-delete-btn");function p(){const e=r.querySelectorAll(".rrr-del-check:checked").length;f.textContent=`${e} selected`,t.disabled=e===0,t.textContent=e?`🗑️ Delete ${e} from Terminal`:"🗑️ Delete Selected",o.checked=e===a.length&&e>0,o.indeterminate=e>0&&e<a.length}o?.addEventListener("change",()=>{a.forEach(e=>e.checked=o.checked),p()}),a.forEach(e=>e.addEventListener("change",p)),t?.addEventListener("click",async()=>{const e=[...r.querySelectorAll(".rrr-del-check:checked")].map(i=>i.value);if(!e.length||!confirm(`Permanently delete ${e.length} member(s) from Renewal Desk? This cannot be undone.`))return;t.disabled=!0,t.textContent="Deleting...";const h=r.querySelector("#rrr-del-result");let d=0,n=0;for(const i of e)try{(await b(`/api/mobile/v1/members/${i}/deactivate`,{method:"POST"})).ok?d++:n++}catch{n++}h.innerHTML=`<p style="padding:16px;text-align:center;font-weight:600;color:${n?"#d97706":"#16a34a"};">
      ${n?`✓ ${d} deleted, ⚠ ${n} failed`:`✓ All ${d} deleted`}
    </p>`,setTimeout(()=>m(r),2e3)})}export{v as default};
