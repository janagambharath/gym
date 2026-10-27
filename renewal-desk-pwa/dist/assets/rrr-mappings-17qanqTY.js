import{f as m,n as S,g as z}from"./index-BKPceLMO.js";const I={async mount(e){await g(e)}},s=z;let c=[],f=[],d=new Map,u=null;async function g(e){u=null,e.innerHTML='<div class="rrr-loading">Loading unmapped punches…</div>';const[t,n]=await Promise.all([m("/api/mobile/v1/rrr/mappings/unresolved"),m("/api/mobile/v1/members?page=1&page_size=500")]);if(!t.ok){e.innerHTML=`<main class="rrr-page"><h1>Couldn't load</h1><p>Check your connection and retry.</p><button id="rrr-retry" class="rrr-btn">Retry</button></main>`,e.querySelector("#rrr-retry")?.addEventListener("click",()=>g(e));return}f=n.ok?n.data.members||[]:[],c=q(t.data.events||[]);const r=new Set(c.map(i=>i.id));for(const i of d.keys())r.has(i)||d.delete(i);T(e)}function q(e){const t=new Map;for(const n of e){const r=n.biometric_user_id;t.has(r)||t.set(r,{id:r,count:0,latest:n.punch_time});const i=t.get(r);i.count+=1,n.punch_time>i.latest&&(i.latest=n.punch_time)}return[...t.values()].sort((n,r)=>r.count-n.count)}function T(e){const t=c.reduce((n,r)=>n+r.count,0);e.innerHTML=`<main class="rrr-page bulk-map-page">
    <header class="rrr-header">
      <button id="bm-back" class="bm-back">‹</button>
      <div class="bm-title">
        <h1>Link biometric IDs</h1>
        <p>${c.length} IDs · ${t} punches need a member</p>
      </div>
    </header>
    
    <div class="bm-hint">
      <span class="bm-hint-icon">💡</span>
      <p>Tap an ID, search the member name, tap to assign. Then hit <b>Link all</b> at the bottom.</p>
    </div>
    
    <div class="bm-list" id="bm-list">
      ${c.map(w).join("")}
    </div>
    
    <div class="bm-footer" id="bm-footer" style="display:none">
      <div class="bm-footer-info"><span id="bm-count">0</span> ready to link</div>
      <button class="bm-link-all" id="bm-link-all">Link all →</button>
    </div>
    ${c.length?`<div class="bm-danger-row">
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
  </style>`,e.querySelector("#bm-back")?.addEventListener("click",()=>S.back()),e.querySelector("#bm-link-all")?.addEventListener("click",()=>C(e)),e.querySelector("#bm-clear-all")?.addEventListener("click",async()=>{if(!confirm(`Delete ALL unmapped punch entries?

This cannot be undone. Mapped punches and members are safe.`)||!confirm("Final confirm: clear all unmapped entries?"))return;const n=await m("/api/mobile/v1/rrr/attendance/unmapped",{method:"DELETE"});n.ok?(alert(`Cleared ${n.data.deleted} unmapped entries.`),g(e)):alert("Failed: "+(n.data?.message||n.error||"unknown error"))}),e.querySelectorAll(".bm-card").forEach(n=>{n.addEventListener("click",r=>{r.target.closest(".bm-picker")||$(e,n.dataset.bid)})}),y(e),k(e)}function y(e){e.querySelectorAll("[data-save-one]").forEach(t=>{t.dataset.wired||(t.dataset.wired="1",t.addEventListener("click",async n=>{n.stopPropagation();const r=t.dataset.saveOne,i=d.get(r);if(!i)return;t.disabled=!0,t.textContent="Linking…";const a=await m("/api/mobile/v1/rrr/mappings/bulk-resolve",{method:"POST",body:{mappings:[{external_id:r,member_id:i.id}]}});a.ok&&a.data.linked===1?(t.textContent="✓ Linked",d.delete(r),c=c.filter(o=>o.id!==r),setTimeout(()=>h(e),600)):(t.disabled=!1,t.textContent="Save link")}))})}function w(e){const t=d.get(e.id),n=u===e.id,i=new Date(e.latest).toLocaleDateString("en-IN",{day:"numeric",month:"short"});return`<div class="bm-card ${t?"ready":""}" data-bid="${s(e.id)}">
    <div class="bm-card-top">
      <div class="bm-id-wrap">
        <span class="bm-id-badge">BIOMETRIC</span>
        <span class="bm-id-num">ID ${s(e.id)}</span>
      </div>
      <span class="bm-punches">${e.count} punches · ${i}</span>
    </div>
    ${t?`
    <div class="bm-assigned">
      <span class="bm-check">✓</span>
      <span class="bm-member-name">${s(t.full_name)}</span>
      <span class="bm-change">change</span>
    </div>
    <button class="bm-save-one" data-save-one="${s(e.id)}">Save link</button>`:`
    <div class="bm-tap-hint">Tap to assign a member →</div>`}
    ${n?E(e.id):""}
  </div>`}function E(e){return`<div class="bm-picker" data-picker="${s(e)}">
    <input class="bm-search" data-search="${s(e)}" type="search" placeholder="Type member name…" autocomplete="off">
    <div class="bm-results" data-results="${s(e)}">${L(f.slice(0,20))}</div>
  </div>`}function L(e){return e.length?e.map(t=>`
    <div class="bm-result" data-pick="${t.id}" data-bid-name="${s(t.full_name)}">
      <span class="bm-result-name">${s(t.full_name)}</span>
      ${t.phone?`<span class="bm-result-phone">${s(t.phone)}</span>`:""}
    </div>`).join(""):'<div class="bm-no-results">No members found</div>'}function $(e,t){u=u===t?null:t,h(e)}function h(e){const t=e.querySelector("#bm-list");t&&(t.innerHTML=c.map(w).join(""),e.querySelectorAll(".bm-card").forEach(n=>{n.addEventListener("click",r=>{r.target.closest(".bm-picker")||$(e,n.dataset.bid)})}),e.querySelectorAll("[data-search]").forEach(n=>{n.addEventListener("input",()=>{const r=n.value.toLowerCase().trim(),i=n.dataset.search,a=e.querySelector(`[data-results="${CSS.escape(i)}"]`);if(!a)return;const o=r?f.filter(l=>l.full_name.toLowerCase().includes(r)||(l.phone||"").includes(r)).slice(0,20):f.slice(0,20);a.innerHTML=L(o),v(e)}),n.addEventListener("click",r=>r.stopPropagation())}),v(e),y(e),k(e))}function v(e){e.querySelectorAll("[data-pick]").forEach(t=>{t.dataset.wired||(t.dataset.wired="1",t.addEventListener("click",n=>{n.stopPropagation();const r=Number(t.dataset.pick),i=f.find(l=>l.id===r);if(!i)return;const o=t.closest("[data-picker]")?.dataset.picker;o&&(d.set(o,i),u=null,h(e))}))})}function k(e){const t=e.querySelector("#bm-footer"),n=e.querySelector("#bm-count");if(!t||!n)return;const r=d.size;n.textContent=r,t.style.display=r>0?"flex":"none"}async function C(e){const t=e.querySelector("#bm-footer"),n=e.querySelector("#bm-progress"),r=e.querySelector("#bm-fill"),i=e.querySelector("#bm-progress-text"),a=e.querySelector("#bm-link-all");t&&(t.style.display="none"),n&&(n.style.display="block"),a&&(a.disabled=!0);const o=[...d.entries()].map(([x,b])=>({external_id:x,member_id:b.id}));i&&(i.textContent=`Linking ${o.length} IDs…`);const l=await m("/api/mobile/v1/rrr/mappings/bulk-resolve",{method:"POST",body:{mappings:o}});if(r&&(r.style.width="100%"),l.ok){const x=l.data.linked||0,b=(l.data.results||[]).filter(p=>!p.ok);if(b.length){i&&(i.textContent=`✓ Linked ${x}, ${b.length} failed: IDs ${b.map(p=>p.external_id).join(", ")}`);for(const p of l.data.results||[])p.ok&&d.delete(p.external_id);setTimeout(()=>g(e),2500)}else i&&(i.textContent=`✓ Linked ${x} of ${o.length}`),d.clear(),setTimeout(()=>g(e),1200)}else i&&(i.textContent="Something went wrong. Try again."),a&&(a.disabled=!1),setTimeout(()=>{n&&(n.style.display="none"),k(e)},2e3)}export{I as default};
