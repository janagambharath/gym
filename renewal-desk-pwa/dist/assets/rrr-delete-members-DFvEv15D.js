import{e as S,s as _,n as T,w as q,f as C}from"./index-ClFlXszA.js";let c=1,L=0,z=1,g="",m=[],E=new Set,h=[];const R={async mount(r){await d(r)}},n=C;async function d(r,o=!1){o||(c=1,m=[],r.innerHTML='<div class="rrr-loading">Loading members…</div>');const y=o?c+1:c,i=await S(`/api/mobile/v1/members?page=${y}&page_size=50${g?`&q=${encodeURIComponent(g)}`:""}`);if(!i.ok){if(o){_(i.error?.message||"Could not load more members.","error");return}r.innerHTML=`<main class="rrr-page"><h1>Could not load members</h1><p>${n(i.error?.message||"Check your connection and try again.")}</p><button class="rrr-btn" id="rrr-retry">Try again</button> <button class="rrr-btn rrr-btn-outline" id="rrr-back">Back</button></main>`,r.querySelector("#rrr-retry")?.addEventListener("click",()=>d(r)),r.querySelector("#rrr-back")?.addEventListener("click",()=>T.back());return}L=i.data.pagination?.total??0,z=i.data.pagination?.total_pages??1,o&&(c=y),m=o?q([...m,...i.data.members||[]],e=>e.id):q(i.data.members||[],e=>e.id);const f=m;r.innerHTML=`<main class="rrr-page rrr-detail">
    <header class="rrr-header">
      <button id="rrr-back" class="rrr-back-btn">← Back</button>
      <div class="rrr-brand"><b>RRR</b><span>Terminal members</span></div>
    </header>
    
    <div class="rrr-del-hero">
      <h1>Deactivate Members</h1>
      <p>Select members to deactivate in Renewal Desk. Deactivation ends their membership and blocks terminal access — their records are kept, not permanently deleted. To permanently erase a member, use the admin panel.</p>
    </div>
    <div style="margin-bottom:var(--sp-md)"><input class="form-input" id="rrr-del-search" type="search" placeholder="Search by name or phone…" value="${n(g)}" style="width:100%"></div>
    <div style="font-size:var(--fs-sm);color:var(--muted);margin-bottom:var(--sp-sm)">Showing ${f.length} of ${L} members</div>
    
    <div class="rrr-del-toolbar">
      <label class="rrr-select-all">
        <input type="checkbox" id="rrr-select-all">
        <span>Select all (${f.length})</span>
      </label>
      <span id="rrr-selected-count" class="rrr-count">0 selected</span>
    </div>
    
    <div class="rrr-del-list" id="rrr-member-list">
      ${f.map(e=>`
        <label class="rrr-del-item">
          <input type="checkbox" class="rrr-del-check" value="${e.id}" data-enroll="${n(e.device_enroll_number||"")}" ${E.has(String(e.id))?"checked":""}>
          <div class="rrr-del-info">
            <div class="rrr-del-name">${n(e.full_name||e.first_name||"Unknown")}</div>
            <div class="rrr-del-meta">ID ${n(e.device_enroll_number||"")} · ${n(e.status||"")} ${e.membership_end?"· ends "+n(e.membership_end):""}</div>
          </div>
          ${e.status==="expired"?'<span class="rrr-expired-badge">EXPIRED</span>':""}
        </label>
      `).join("")||'<p class="rrr-no-data">No members with terminal enroll numbers.</p>'}
    </div>
    
    <div class="rrr-del-footer">
      <button id="rrr-delete-btn" class="rrr-delete-btn" disabled>🗑️ Deactivate Selected</button>
    </div>
    ${c<z?'<div style="text-align:center;padding:var(--sp-md)"><button class="btn btn-secondary" id="rrr-del-more">Load more members</button></div>':""}
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
  </style>`,r.querySelector("#rrr-back")?.addEventListener("click",()=>T.back());let k;r.querySelector("#rrr-del-search")?.addEventListener("input",e=>{clearTimeout(k),k=setTimeout(()=>{g=e.target.value.trim(),d(r)},400)}),r.querySelector("#rrr-del-more")?.addEventListener("click",()=>{d(r,!0)});const p=r.querySelector("#rrr-select-all"),b=r.querySelectorAll(".rrr-del-check"),D=r.querySelector("#rrr-selected-count"),s=r.querySelector("#rrr-delete-btn");function v(){const e=r.querySelectorAll(".rrr-del-check:checked").length;D.textContent=`${e} selected`,s.disabled=e===0,s.textContent=e?`🗑️ Deactivate ${e} member${e===1?"":"s"}`:"🗑️ Deactivate Selected",p.checked=e===b.length&&e>0,p.indeterminate=e>0&&e<b.length}if(p?.addEventListener("change",()=>{b.forEach(e=>e.checked=p.checked),v()}),b.forEach(e=>e.addEventListener("change",v)),v(),h.length){const e=r.querySelector("#rrr-del-result");e&&(e.innerHTML=`<div style="padding:16px;font-weight:600;color:#d97706;text-align:center">⚠ ${h.length} failed — still selected below<div style="text-align:left;font-weight:400;margin-top:var(--sp-sm)">${h.map(u=>`<div style="font-size:var(--fs-sm);margin-top:4px">• ${n(u.name)} — ${n(u.reason)}</div>`).join("")}</div></div>`)}s?.addEventListener("click",async()=>{const e=[...r.querySelectorAll(".rrr-del-check:checked")].map(a=>a.value);if(!e.length||!confirm(`Deactivate ${e.length} member(s)? Their membership ends and terminal access is blocked. Records are kept.`))return;s.disabled=!0,s.textContent="Deactivating...";const u=r.querySelector("#rrr-del-result");let x=0;const t=[];for(const a of e){const $=m.find(l=>String(l.id)===String(a)),w=$?.full_name||$?.first_name||`Member ${a}`;try{const l=await S(`/api/mobile/v1/members/${a}/deactivate`,{method:"POST"});l.ok?x++:t.push({id:a,name:w,reason:l.error?.message||"Failed"})}catch(l){t.push({id:a,name:w,reason:l?.message||"Request failed"})}}E=new Set(t.map(a=>String(a.id))),h=t,u.innerHTML=`<div style="padding:16px;font-weight:600;color:${t.length?"#d97706":"#16a34a"};text-align:center">
      ${t.length?`✓ ${x} deactivated, ⚠ ${t.length} failed`:`✓ All ${x} deactivated`}
      ${t.length?`<div style="text-align:left;font-weight:400;margin-top:var(--sp-sm)">${t.map(a=>`<div style="font-size:var(--fs-sm);margin-top:4px">• ${n(a.name)} — ${n(a.reason)}</div>`).join("")}</div><div style="font-size:var(--fs-sm);font-weight:400;margin-top:var(--sp-sm)">Failed members stay selected below — fix the cause and tap Deactivate again.</div>`:""}
    </div>`,t.length?(s.disabled=!1,s.textContent=`🗑️ Deactivate ${t.length} member${t.length===1?"":"s"}`,setTimeout(()=>d(r),1500)):setTimeout(()=>d(r),2e3)})}export{R as default};
