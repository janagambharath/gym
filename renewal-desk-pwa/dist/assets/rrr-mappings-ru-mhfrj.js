import{g as c,p as C,n as I,t as M,j as D}from"./index-B1po66HU.js";const F={async mount(e){await x(e)}},l=D;let o=[],v=[],s=new Map,u=null,$=null,p=1,k=0,f=1;function P(){const e=C()?.tenantId??null;e!==$&&($=e,o=[],v=[],s=new Map,u=null,p=1,k=0,f=1)}async function x(e){P(),u=null,p=1,e.innerHTML='<div class="rrr-loading">Loading unmapped punches…</div>';const[t,n]=await Promise.all([c("/api/mobile/v1/rrr/mappings/unresolved?page=1&per_page=50"),c("/api/mobile/v1/members?page=1&page_size=50")]);if(!t.ok){e.innerHTML=`<main class="rrr-page"><h1>Couldn't load</h1><p>Check your connection and retry.</p><button id="rrr-retry" class="rrr-btn">Retry</button></main>`,e.querySelector("#rrr-retry")?.addEventListener("click",()=>x(e));return}v=n.ok?n.data.members||[]:[];const a=t.data.pagination||{};k=a.total??0,f=a.total_pages??1,p=a.page??1,o=(t.data.groups||[]).map(r=>({id:String(r.biometric_user_id),count:r.punch_count||0,latest:r.latest_punch_time}));const i=new Set(o.map(r=>r.id));for(const r of s.keys())i.has(r)||s.delete(r);L(e)}async function H(e){if(p>=f)return;const t=await c(`/api/mobile/v1/rrr/mappings/unresolved?page=${p+1}&per_page=50`);if(!t.ok)return;p=t.data.pagination?.page??p+1,f=t.data.pagination?.total_pages??f;const n=(t.data.groups||[]).map(a=>({id:String(a.biometric_user_id),count:a.punch_count||0,latest:a.latest_punch_time}));o=[...o,...n],L(e)}let S;async function j(e,t,n){const a=n.querySelector(`[data-results="${CSS.escape(t)}"]`);if(!a)return;const i=(e||"").trim(),r=await c(`/api/mobile/v1/members?page=1&page_size=20${i?`&q=${encodeURIComponent(i)}`:""}`),d=r.ok?r.data.members||[]:[];a.innerHTML=_(d),E(n)}function L(e){const t=o.reduce((n,a)=>n+a.count,0);e.innerHTML=`<main class="rrr-page bulk-map-page">
    <header class="rrr-header">
      <button id="bm-back" class="bm-back">‹</button>
      <div class="bm-title">
        <h1>Link biometric IDs</h1>
        <p>${k||o.length} IDs · ${t} punches need a member</p>
      </div>
    </header>
    
    <div class="bm-hint">
      <span class="bm-hint-icon">💡</span>
      <p>Tap an ID, search the member name, tap to assign. Then hit <b>Link all</b> at the bottom.</p>
    </div>
    
    <div class="bm-list" id="bm-list">
      ${o.map(T).join("")}
    </div>
    <div style="padding:var(--sp-sm) 0;font-size:var(--fs-sm);color:var(--muted);text-align:center">Showing ${o.length} of ${k} unmapped IDs</div>
    ${p<f?'<div style="text-align:center;padding:var(--sp-md)"><button class="btn btn-secondary" id="bm-more">Load more IDs</button></div>':""}
    
    <div class="bm-footer" id="bm-footer" style="display:none">
      <div class="bm-footer-info"><span id="bm-count">0</span> ready to link</div>
      <button class="bm-link-all" id="bm-link-all">Link all →</button>
    </div>
    ${o.length?`<div class="bm-danger-row">
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
  </style>`,e.querySelector("#bm-back")?.addEventListener("click",()=>I.back()),e.querySelector("#bm-more")?.addEventListener("click",()=>H(e)),e.querySelector("#bm-link-all")?.addEventListener("click",()=>O(e)),e.querySelector("#bm-clear-all")?.addEventListener("click",async()=>{if(!confirm(`Delete ALL unmapped punch entries?

This cannot be undone. Mapped punches and members are safe.`)||!confirm("Final confirm: clear all unmapped entries?"))return;const n=await c("/api/mobile/v1/rrr/attendance/unmapped",{method:"DELETE"});n.ok?(alert(`Cleared ${n.data.deleted} unmapped entries.`),x(e)):alert("Failed: "+(n.data?.message||n.error||"unknown error"))}),e.querySelectorAll(".bm-card").forEach(n=>{n.addEventListener("click",a=>{a.target.closest(".bm-picker")||q(e,n.dataset.bid)})}),z(e),w(e)}function z(e){e.querySelectorAll("[data-save-one]").forEach(t=>{t.dataset.wired||(t.dataset.wired="1",t.addEventListener("click",async n=>{n.stopPropagation();const a=t.dataset.saveOne,i=s.get(a);if(!i)return;t.disabled=!0,t.textContent="Linking…";const r=await c("/api/mobile/v1/rrr/mappings/bulk-resolve",{method:"POST",body:{mappings:[{external_id:a,member_id:i.id}]}});r.ok&&r.data.linked===1?(t.textContent="✓ Linked",s.delete(a),o=o.filter(d=>d.id!==a),setTimeout(()=>y(e),600)):(t.disabled=!1,t.textContent="Save link")}))})}function T(e){const t=s.get(e.id),n=u===e.id,a=e.latest?M(e.latest):"";return`<div class="bm-card ${t?"ready":""}" data-bid="${l(e.id)}">
    <div class="bm-card-top">
      <div class="bm-id-wrap">
        <span class="bm-id-badge">BIOMETRIC</span>
        <span class="bm-id-num">ID ${l(e.id)}</span>
      </div>
      <span class="bm-punches">${e.count} punches · ${a}</span>
    </div>
    ${t?`
    <div class="bm-assigned">
      <span class="bm-check">✓</span>
      <span class="bm-member-name">${l(t.full_name)}</span>
      <span class="bm-change">change</span>
    </div>
    <button class="bm-save-one" data-save-one="${l(e.id)}">Save link</button>`:`
    <div class="bm-tap-hint">Tap to assign a member →</div>`}
    ${n?A(e.id):""}
  </div>`}function A(e){return`<div class="bm-picker" data-picker="${l(e)}">
    <input class="bm-search" data-search="${l(e)}" type="search" placeholder="Type member name…" autocomplete="off">
    <div class="bm-results" data-results="${l(e)}">${_(v.slice(0,20))}</div>
  </div>`}function _(e){return e.length?e.map(t=>`
    <div class="bm-result" data-pick="${t.id}" data-bid-name="${l(t.full_name)}">
      <span class="bm-result-name">${l(t.full_name)}</span>
      ${t.phone?`<span class="bm-result-phone">${l(t.phone)}</span>`:""}
    </div>`).join(""):'<div class="bm-no-results">No members found</div>'}function q(e,t){u=u===t?null:t,y(e)}function y(e){const t=e.querySelector("#bm-list");t&&(t.innerHTML=o.map(T).join(""),e.querySelectorAll(".bm-card").forEach(n=>{n.addEventListener("click",a=>{a.target.closest(".bm-picker")||q(e,n.dataset.bid)})}),e.querySelectorAll("[data-search]").forEach(n=>{n.addEventListener("input",()=>{const a=n.dataset.search;clearTimeout(S),S=setTimeout(()=>j(n.value,a,e),300)}),n.addEventListener("click",a=>a.stopPropagation())}),E(e),z(e),w(e))}function E(e){e.querySelectorAll("[data-pick]").forEach(t=>{t.dataset.wired||(t.dataset.wired="1",t.addEventListener("click",n=>{n.stopPropagation();const a=Number(t.dataset.pick),i=v.find(m=>m.id===a);if(!i)return;const d=t.closest("[data-picker]")?.dataset.picker;d&&(s.set(d,i),u=null,y(e))}))})}function w(e){const t=e.querySelector("#bm-footer"),n=e.querySelector("#bm-count");if(!t||!n)return;const a=s.size;n.textContent=a,t.style.display=a>0?"flex":"none"}async function O(e){const t=e.querySelector("#bm-footer"),n=e.querySelector("#bm-progress"),a=e.querySelector("#bm-fill"),i=e.querySelector("#bm-progress-text"),r=e.querySelector("#bm-link-all");t&&(t.style.display="none"),n&&(n.style.display="block"),r&&(r.disabled=!0);const d=[...s.entries()].map(([h,g])=>({external_id:h,member_id:g.id}));i&&(i.textContent=`Linking ${d.length} IDs…`);const m=await c("/api/mobile/v1/rrr/mappings/bulk-resolve",{method:"POST",body:{mappings:d}});if(a&&(a.style.width="100%"),m.ok){const h=m.data.linked||0,g=(m.data.results||[]).filter(b=>!b.ok);if(g.length){i&&(i.textContent=`✓ Linked ${h}, ${g.length} failed: IDs ${g.map(b=>b.external_id).join(", ")}`);for(const b of m.data.results||[])b.ok&&s.delete(b.external_id);setTimeout(()=>x(e),2500)}else i&&(i.textContent=`✓ Linked ${h} of ${d.length}`),s.clear(),setTimeout(()=>x(e),1200)}else i&&(i.textContent="Something went wrong. Try again."),r&&(r.disabled=!1),setTimeout(()=>{n&&(n.style.display="none"),w(e)},2e3)}export{F as default};
