import{g as b,p as I,n as M,t as D,s as L,j as P}from"./index-D2dcDZYm.js";const B={async mount(e){await k(e)}},p=P;let s=[],x=[],l=new Map,h=null,S=null,c=1,v=0,g=1;function H(){const e=I()?.tenantId??null;e!==S&&(S=e,s=[],x=[],l=new Map,h=null,c=1,v=0,g=1)}async function k(e){H(),h=null,c=1,e.innerHTML='<div class="rrr-loading">Loading unmapped punches…</div>';const[t,r]=await Promise.all([b("/api/mobile/v1/rrr/mappings/unresolved?page=1&per_page=50"),b("/api/mobile/v1/members?page=1&page_size=50")]);if(!t.ok){e.innerHTML=`<main class="rrr-page"><h1>Couldn't load</h1><p>Check your connection and retry.</p><button id="rrr-retry" class="rrr-btn">Retry</button></main>`,e.querySelector("#rrr-retry")?.addEventListener("click",()=>k(e));return}x=r.ok?r.data.members||[]:[];const n=t.data.pagination||{};v=n.total??0,g=n.total_pages??1,c=n.page??1,s=(t.data.groups||[]).map(a=>({id:String(a.biometric_user_id),count:a.punch_count||0,latest:a.latest_punch_time}));const i=new Set(s.map(a=>a.id));for(const a of l.keys())i.has(a)||l.delete(a);z(e)}async function j(e){if(c>=g)return;const t=await b(`/api/mobile/v1/rrr/mappings/unresolved?page=${c+1}&per_page=50`);if(!t.ok)return;c=t.data.pagination?.page??c+1,g=t.data.pagination?.total_pages??g;const r=(t.data.groups||[]).map(n=>({id:String(n.biometric_user_id),count:n.punch_count||0,latest:n.latest_punch_time}));s=[...s,...r],z(e)}let $;async function A(e,t,r){const n=r.querySelector(`[data-results="${CSS.escape(t)}"]`);if(!n)return;const i=(e||"").trim(),a=await b(`/api/mobile/v1/members?page=1&page_size=20${i?`&q=${encodeURIComponent(i)}`:""}`),o=a.ok?a.data.members||[]:[];for(const d of o)x.some(f=>f.id===d.id)||x.push(d);n.innerHTML=q(o),C(r)}function z(e){const t=s.reduce((r,n)=>r+n.count,0);e.innerHTML=`<main class="rrr-page bulk-map-page">
    <header class="rrr-header">
      <button id="bm-back" class="bm-back">‹</button>
      <div class="bm-title">
        <h1>Link biometric IDs</h1>
        <p>${v||s.length} IDs · ${t} punches need a member</p>
      </div>
    </header>
    
    <div class="bm-hint">
      <span class="bm-hint-icon">💡</span>
      <p>Tap an ID, search the member name, tap to assign. Then hit <b>Link all</b> at the bottom.</p>
    </div>
    
    <div class="bm-list" id="bm-list">
      ${s.map(_).join("")}
    </div>
    <div style="padding:var(--sp-sm) 0;font-size:var(--fs-sm);color:var(--muted);text-align:center">Showing ${s.length} of ${v} unmapped IDs</div>
    ${c<g?'<div style="text-align:center;padding:var(--sp-md)"><button class="btn btn-secondary" id="bm-more">Load more IDs</button></div>':""}
    
    <div class="bm-footer" id="bm-footer" style="display:none">
      <div class="bm-footer-info"><span id="bm-count">0</span> ready to link</div>
      <button class="bm-link-all" id="bm-link-all">Link all →</button>
    </div>
    ${s.length?`<div class="bm-danger-row">
      <button class="bm-clear-all" id="bm-clear-all">Clear all unmapped entries</button>
    </div>`:""}
    
    <div class="bm-progress" id="bm-progress" style="display:none">
      <div class="bm-progress-bar"><div class="bm-progress-fill" id="bm-fill"></div></div>
      <p id="bm-progress-text">Linking…</p>
    </div>
  </main>
  <style>
    .bulk-map-page { padding-bottom: 110px; }
    .bm-back { background: #f1f5f9; border: none; width: 36px; height: 36px; border-radius: 50%; font-size: 22px; color: #334155; cursor: pointer; flex-shrink: 0; }
    .bm-title h1 { font-size: 22px; font-weight: 800; margin: 0; letter-spacing: -0.3px; }
    .bm-title p { font-size: 13px; color: #64748b; margin: 2px 0 0 0; }
    .bulk-map-page .rrr-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .bm-hint { display: flex; gap: 10px; background: #eff6ff; border-radius: 12px; padding: 12px 14px; margin-bottom: 16px; }
    .bm-hint-icon { font-size: 18px; flex-shrink: 0; }
    .bm-hint p { font-size: 13px; color: #1e40af; margin: 0; line-height: 1.5; }
    .bm-list { display: flex; flex-direction: column; gap: 10px; }
    .bm-card { background: #fff; border: 2px solid #e2e8f0; border-radius: 16px; padding: 14px 16px; cursor: pointer; transition: border-color 0.15s; }
    .bm-card:active { transform: scale(0.99); }
    .bm-card.ready { border-color: #10b981; background: #f0fdf4; }
    .bm-card-top { display: flex; align-items: center; justify-content: space-between; }
    .bm-id-wrap { display: flex; align-items: center; gap: 10px; }
    .bm-id-badge { background: #fef3c7; color: #92400e; font-weight: 800; font-size: 12px; padding: 5px 10px; border-radius: 16px; }
    .bm-id-num { font-size: 19px; font-weight: 800; }
    .bm-punches { font-size: 12px; color: #64748b; background: #f1f5f9; padding: 5px 10px; border-radius: 12px; font-weight: 600; }
    .bm-assigned { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 14px; }
    .bm-check { width: 22px; height: 22px; background: #10b981; color: #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; flex-shrink: 0; }
    .bm-member-name { font-weight: 700; color: #065f46; }
    .bm-change { font-size: 12px; color: #3b82f6; font-weight: 600; margin-left: auto; }
    .bm-tap-hint { margin-top: 8px; font-size: 13px; color: #94a3b8; }
    .bm-picker { margin-top: 12px; border-top: 1px solid #e2e8f0; padding-top: 12px; }
    .bm-search { width: 100%; padding: 12px; border: 1.5px solid #e2e8f0; border-radius: 10px; font-size: 15px; box-sizing: border-box; }
    .bm-search:focus { outline: none; border-color: #3b82f6; }
    .bm-results { max-height: 220px; overflow-y: auto; margin-top: 8px; border: 1px solid #e2e8f0; border-radius: 10px; }
    .bm-result { padding: 12px; border-bottom: 1px solid #f1f5f9; cursor: pointer; font-size: 14px; }
    .bm-result:last-child { border-bottom: none; }
    .bm-result:active { background: #eff6ff; }
    .bm-result-name { font-weight: 700; }
    .bm-result-phone { color: #64748b; font-size: 12px; margin-left: 6px; }
    .bm-no-results { padding: 16px; text-align: center; color: #94a3b8; font-size: 13px; }
    .bm-footer { position: fixed; bottom: 0; left: 0; right: 0; background: #fff; border-top: 1px solid #e2e8f0; padding: 14px 20px calc(14px + env(safe-area-inset-bottom)); display: flex; align-items: center; justify-content: space-between; box-shadow: 0 -2px 12px rgba(0,0,0,0.06); z-index: 10; }
    .bm-footer-info { font-size: 14px; font-weight: 700; color: #334155; }
    .bm-footer-info span { color: #10b981; font-size: 18px; }
    .bm-link-all { background: #10b981; color: #fff; border: none; padding: 14px 28px; border-radius: 12px; font-weight: 800; font-size: 15px; cursor: pointer; }
    .bm-link-all:disabled { opacity: 0.5; }
    .bm-link-all:active { transform: scale(0.97); }
    .bm-danger-row { padding: 16px; text-align: center; }
    .bm-clear-all { background: none; border: 1px solid #fca5a5; color: #dc2626; padding: 10px 20px; border-radius: 10px; font-weight: 600; font-size: 13px; cursor: pointer; }
    .bm-progress { position: fixed; bottom: 0; left: 0; right: 0; background: #fff; border-top: 1px solid #e2e8f0; padding: 20px; z-index: 11; }
    .bm-progress-bar { height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden; }
    .bm-progress-fill { height: 100%; background: #10b981; width: 0%; transition: width 0.3s; border-radius: 4px; }
    .bm-progress p { text-align: center; font-size: 13px; color: #64748b; margin: 10px 0 0 0; }
    .bm-save-one { width: 100%; margin-top: 10px; background: #10b981; color: #fff; border: none; padding: 11px; border-radius: 10px; font-weight: 700; font-size: 14px; cursor: pointer; }
    .bm-save-one:active { transform: scale(0.98); }
    .bm-save-one:disabled { opacity: 0.5; }
  </style>`,e.querySelector("#bm-back")?.addEventListener("click",()=>M.back()),e.querySelector("#bm-more")?.addEventListener("click",()=>j(e)),e.querySelector("#bm-link-all")?.addEventListener("click",()=>R(e)),e.querySelector("#bm-clear-all")?.addEventListener("click",async()=>{if(!confirm(`Delete ALL unmapped punch entries?

This cannot be undone. Mapped punches and members are safe.`)||!confirm("Final confirm: clear all unmapped entries?"))return;const r=await b("/api/mobile/v1/rrr/attendance/unmapped",{method:"DELETE"});r.ok?(alert(`Cleared ${r.data.deleted} unmapped entries.`),k(e)):alert("Failed: "+(r.data?.message||r.error||"unknown error"))}),e.querySelectorAll(".bm-card").forEach(r=>{r.addEventListener("click",n=>{n.target.closest(".bm-picker")||E(e,r.dataset.bid)})}),T(e),w(e)}function T(e){e.querySelectorAll("[data-save-one]").forEach(t=>{t.dataset.wired||(t.dataset.wired="1",t.addEventListener("click",async r=>{r.stopPropagation();const n=t.dataset.saveOne,i=l.get(n);if(!i)return;t.disabled=!0,t.textContent="Linking…";const a=await b("/api/mobile/v1/rrr/mappings/bulk-resolve",{method:"POST",body:{mappings:[{external_id:n,member_id:i.id}]}});if(a.ok&&a.data.linked===1)t.textContent="✓ Linked",l.delete(n),s=s.filter(o=>o.id!==n),setTimeout(()=>y(e),600);else{t.disabled=!1,t.textContent="Save link";const o=a?.data?.results?.find(d=>String(d.external_id)===String(n))?.error;L(o||a?.error?.message||"Could not link — try again.","error")}}))})}function _(e){const t=l.get(e.id),r=h===e.id,n=e.latest?D(e.latest):"";return`<div class="bm-card ${t?"ready":""}" data-bid="${p(e.id)}">
    <div class="bm-card-top">
      <div class="bm-id-wrap">
        <span class="bm-id-badge">BIOMETRIC</span>
        <span class="bm-id-num">ID ${p(e.id)}</span>
      </div>
      <span class="bm-punches">${e.count} punches · ${n}</span>
    </div>
    ${t?`
    <div class="bm-assigned">
      <span class="bm-check">✓</span>
      <span class="bm-member-name">${p(t.full_name)}</span>
      <span class="bm-change">change</span>
    </div>
    <button class="bm-save-one" data-save-one="${p(e.id)}">Save link</button>`:`
    <div class="bm-tap-hint">Tap to assign a member →</div>`}
    ${r?O(e.id):""}
  </div>`}function O(e){return`<div class="bm-picker" data-picker="${p(e)}">
    <input class="bm-search" data-search="${p(e)}" type="search" placeholder="Type member name…" autocomplete="off">
    <div class="bm-results" data-results="${p(e)}">${q(x.slice(0,20))}</div>
  </div>`}function q(e){return e.length?e.map(t=>`
    <div class="bm-result" data-pick="${t.id}" data-bid-name="${p(t.full_name)}">
      <span class="bm-result-name">${p(t.full_name)}</span>
      ${t.phone?`<span class="bm-result-phone">${p(t.phone)}</span>`:""}
    </div>`).join(""):'<div class="bm-no-results">No members found</div>'}function E(e,t){h=h===t?null:t,y(e)}function y(e){const t=e.querySelector("#bm-list");t&&(t.innerHTML=s.map(_).join(""),e.querySelectorAll(".bm-card").forEach(r=>{r.addEventListener("click",n=>{n.target.closest(".bm-picker")||E(e,r.dataset.bid)})}),e.querySelectorAll("[data-search]").forEach(r=>{r.addEventListener("input",()=>{const n=r.dataset.search;clearTimeout($),$=setTimeout(()=>A(r.value,n,e),300)}),r.addEventListener("click",n=>n.stopPropagation())}),C(e),T(e),w(e))}function C(e){e.querySelectorAll("[data-pick]").forEach(t=>{t.dataset.wired||(t.dataset.wired="1",t.addEventListener("click",r=>{r.stopPropagation();const n=Number(t.dataset.pick),i=x.find(d=>d.id===n);if(!i)return;const o=t.closest("[data-picker]")?.dataset.picker;o&&(l.set(o,i),h=null,y(e))}))})}function w(e){const t=e.querySelector("#bm-footer"),r=e.querySelector("#bm-count");if(!t||!r)return;const n=l.size;r.textContent=n,t.style.display=n>0?"flex":"none"}async function R(e){const t=e.querySelector("#bm-footer"),r=e.querySelector("#bm-progress"),n=e.querySelector("#bm-fill"),i=e.querySelector("#bm-progress-text"),a=e.querySelector("#bm-link-all");t&&(t.style.display="none"),r&&(r.style.display="block"),a&&(a.disabled=!0);const o=[...l.entries()].map(([f,m])=>({external_id:f,member_id:m.id}));i&&(i.textContent=`Linking ${o.length} IDs…`);const d=await b("/api/mobile/v1/rrr/mappings/bulk-resolve",{method:"POST",body:{mappings:o}});if(n&&(n.style.width="100%"),d.ok){const f=d.data.linked||0,m=(d.data.results||[]).filter(u=>!u.ok);if(m.length){i&&(i.textContent=`✓ Linked ${f}, ${m.length} failed: IDs ${m.map(u=>u.external_id).join(", ")}`),m[0]?.error&&L(m[0].error,"error");for(const u of d.data.results||[])u.ok&&l.delete(u.external_id);setTimeout(()=>k(e),2500)}else i&&(i.textContent=`✓ Linked ${f} of ${o.length}`),l.clear(),setTimeout(()=>k(e),1200)}else i&&(i.textContent="Something went wrong. Try again."),a&&(a.disabled=!1),setTimeout(()=>{r&&(r.style.display="none"),w(e)},2e3)}export{B as default};
