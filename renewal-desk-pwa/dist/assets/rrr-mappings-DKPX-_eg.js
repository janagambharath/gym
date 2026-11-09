import{e as k,s as S,o as D,n as A,t as R,u as F,f as O}from"./index-DYUtf5t4.js";const K={async mount(e){await $(e)}},b=O;let c=[],p=[],m=new Map,y=null,I=null,g=1,M=0,w=0,x=1;function B(){const e=D()?.tenantId??null;e!==I&&(I=e,c=[],p=[],m=new Map,y=null,g=1,w=0,x=1)}async function $(e){B(),y=null,g=1,e.innerHTML='<div class="rrr-loading">Loading unmapped punches…</div>';const[t,n]=await Promise.all([k("/api/mobile/v1/rrr/mappings/unresolved?page=1&per_page=50"),k("/api/mobile/v1/members?page=1&page_size=50")]);if(!t.ok){e.innerHTML=`<main class="rrr-page"><h1>Couldn't load</h1><p>Check your connection and retry.</p><button id="rrr-retry" class="rrr-btn">Retry</button></main>`,e.querySelector("#rrr-retry")?.addEventListener("click",()=>$(e));return}p=n.ok?n.data.members||[]:[],M=n.ok?n.data.pagination?.total??p.length:p.length;const r=!n.ok;r&&S("Could not load the member list — search may miss members. Check your connection and retry.","error");const o=t.data.pagination||{};w=o.total??0,x=o.total_pages??1,g=o.page??1,c=(t.data.groups||[]).map(a=>({id:String(a.biometric_user_id),count:a.punch_count||0,latest:a.latest_punch_time}));const d=new Set(c.map(a=>a.id));for(const a of m.keys())d.has(a)||m.delete(a);N(e,r)}async function G(e){if(g>=x)return;const t=e.querySelector("#bm-more");t&&(t.disabled=!0,t.textContent="Loading…");const n=await k(`/api/mobile/v1/rrr/mappings/unresolved?page=${g+1}&per_page=50`);if(!n.ok){t&&(t.disabled=!1,t.textContent="Load more IDs"),S(n.error?.message||"Could not load more IDs.","error");return}g=n.data.pagination?.page??g+1,x=n.data.pagination?.total_pages??x;const r=(n.data.groups||[]).map(s=>({id:String(s.biometric_user_id),count:s.punch_count||0,latest:s.latest_punch_time})),o=new Set(c.map(s=>s.id)),d=r.filter(s=>!o.has(s.id));c=[...c,...d];const a=e.querySelector("#bm-list");a&&(a.insertAdjacentHTML("beforeend",d.map(T).join("")),a.querySelectorAll(".bm-card").forEach(s=>{s.dataset.wired||(s.dataset.wired="1",s.addEventListener("click",l=>{l.target.closest(".bm-picker")||z(e,s.dataset.bid)}))}),L(a));const i=e.querySelector("#bm-count-line");i&&(i.textContent=`Showing ${c.length} of ${w} unmapped IDs`);const u=e.querySelector("#bm-more-wrap");u&&(u.style.display=g<x?"":"none"),t&&(t.disabled=!1,t.textContent="Load more IDs")}let _,E=0;async function H(e,t,n){const r=++E,o=n.querySelector(`[data-results="${CSS.escape(t)}"]`);if(!o)return;const d=(e||"").trim(),a=await k(`/api/mobile/v1/members?page=1&page_size=50${d?`&q=${encodeURIComponent(d)}`:""}`);if(r!==E)return;if(!a.ok){o.innerHTML=`<div class="bm-no-results" style="color:#dc2626">Couldn’t search members (${b(a.error?.message||"check your connection")}). <button type="button" class="btn btn-sm btn-secondary" data-bm-search-retry="${b(t)}">Try again</button></div>`,o.querySelector("[data-bm-search-retry]")?.addEventListener("click",()=>H(e,t,n));return}const i=a.ok?a.data.members||[]:[],u=a.ok?a.data.pagination?.total??i.length:0,s=new Set(p.map(l=>l.id));for(const l of i)s.has(l.id)||(p.push(l),s.add(l.id));if(p.length>200){const l=new Set([...m.values()].map(v=>v.id)),f=p.filter(v=>l.has(v.id)),h=p.filter(v=>!l.has(v.id)).slice(-(200-f.length));p=[...f,...h]}o.innerHTML=P(i)+(u>i.length?`<div class="bm-no-results">Showing ${i.length} of ${u} members — refine your search to find more.</div>`:""),j(n)}function N(e,t=!1){const n=c.reduce((r,o)=>r+o.count,0);e.innerHTML=`<main class="rrr-page bulk-map-page">
    <header class="rrr-header">
      <button id="bm-back" class="bm-back">‹</button>
      <div class="bm-title">
        <h1>Link biometric IDs</h1>
        <p>${w||c.length} IDs · ${n} punches need a member</p>
      </div>
    </header>
    
    <div class="bm-hint">
      <span class="bm-hint-icon">💡</span>
      <p>Tap an ID, search the member name, tap to assign. Then hit <b>Link all</b> at the bottom.</p>
    </div>
    
    <div class="bm-list" id="bm-list">
      ${c.map(T).join("")}
    </div>
    ${t?'<div class="bm-hint" style="background:#fef3c7"><span class="bm-hint-icon">⚠️</span><p style="color:#92400e">Member list failed to load — search may miss members. Check your connection and reload.</p></div>':""}
    <div id="bm-count-line" style="padding:var(--sp-sm) 0;font-size:var(--fs-sm);color:var(--muted);text-align:center">Showing ${c.length} of ${w} unmapped IDs</div>
    <div id="bm-more-wrap" style="text-align:center;padding:var(--sp-md);${g<x?"":"display:none"}"><button class="btn btn-secondary" id="bm-more">Load more IDs</button></div>
    
    <div class="bm-footer" id="bm-footer" style="display:none">
      <div class="bm-footer-info"><span id="bm-count">0</span> ready to link</div>
      <button class="bm-link-all" id="bm-link-all">Link all →</button>
    </div>
    ${c.length&&D()?.userRole!=="staff"?`<div class="bm-danger-row">
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
  </style>`,e.querySelector("#bm-back")?.addEventListener("click",()=>A.back()),e.querySelector("#bm-more")?.addEventListener("click",()=>G(e)),e.querySelector("#bm-link-all")?.addEventListener("click",()=>W(e)),e.querySelector("#bm-clear-all")?.addEventListener("click",async()=>{if(!confirm(`Delete ALL unmapped punch entries?

This cannot be undone. Mapped punches and members are safe.`)||!confirm("Final confirm: clear all unmapped entries?"))return;const r=await k("/api/mobile/v1/rrr/attendance/unmapped",{method:"DELETE"});if(r.ok){const o=typeof r.data?.deleted=="number"?r.data.deleted:0;alert(`Cleared ${o} unmapped ${o===1?"entry":"entries"}.`),$(e)}else alert("Failed: "+(r.error?.message||"unknown error"))}),e.querySelectorAll(".bm-card").forEach(r=>{r.dataset.wired="1",r.addEventListener("click",o=>{o.target.closest(".bm-picker")||z(e,r.dataset.bid)})}),L(e),C(e)}function L(e){e.querySelectorAll("[data-save-one]").forEach(t=>{t.dataset.wired||(t.dataset.wired="1",t.addEventListener("click",async n=>{n.stopPropagation();const r=t.dataset.saveOne,o=m.get(r);if(!o)return;t.disabled=!0,t.textContent="Linking…";const d=await k("/api/mobile/v1/rrr/mappings/bulk-resolve",{method:"POST",body:{mappings:[{external_id:r,member_id:o.id}]}});if(d.ok&&d.data.linked===1)t.textContent="✓ Linked",m.delete(r),c=c.filter(a=>a.id!==r),setTimeout(()=>q(e),600);else{t.disabled=!1,t.textContent="Save link";const a=d?.data?.results?.find(i=>String(i.external_id)===String(r))?.error;S(a||d?.error?.message||"Could not link — try again.","error")}}))})}function T(e){const t=m.get(e.id),n=y===e.id,r=e.latest?R(e.latest):"";return`<div class="bm-card ${t?"ready":""}" data-bid="${b(e.id)}">
    <div class="bm-card-top">
      <div class="bm-id-wrap">
        <span class="bm-id-badge">BIOMETRIC</span>
        <span class="bm-id-num">ID ${b(e.id)}</span>
      </div>
      <span class="bm-punches">${e.count} punches · ${r}</span>
    </div>
    ${t?`
    <div class="bm-assigned">
      <span class="bm-check">✓</span>
      <span class="bm-member-name">${b(t.full_name)}</span>
      <span class="bm-change">change</span>
    </div>
    <button class="bm-save-one" data-save-one="${b(e.id)}">Save link</button>`:`
    <div class="bm-tap-hint">Tap to assign a member →</div>`}
    ${n?U(e.id):""}
  </div>`}function U(e){const t=p.slice(0,20),n=M||p.length;return`<div class="bm-picker" data-picker="${b(e)}">
    <input class="bm-search" data-search="${b(e)}" type="search" placeholder="Type member name…" autocomplete="off">
    <div class="bm-results" data-results="${b(e)}">${P(t)}${n>t.length?`<div class="bm-no-results">Showing ${t.length} of ${n} members — type to search for more.</div>`:""}</div>
  </div>`}function P(e){return e.length?e.map(t=>`
    <div class="bm-result" data-pick="${t.id}" data-bid-name="${b(t.full_name)}">
      <span class="bm-result-name">${b(t.full_name)}</span>
      ${t.phone?`<span class="bm-result-phone">${b(t.phone)}</span>`:""}
    </div>`).join(""):'<div class="bm-no-results">No members found</div>'}function z(e,t){y=y===t?null:t,q(e)}function q(e){const t=e.querySelector("#bm-list");t&&(t.innerHTML=c.map(T).join(""),e.querySelectorAll(".bm-card").forEach(n=>{n.dataset.wired="1",n.addEventListener("click",r=>{r.target.closest(".bm-picker")||z(e,n.dataset.bid)})}),e.querySelectorAll("[data-search]").forEach(n=>{n.addEventListener("input",()=>{const r=n.dataset.search;clearTimeout(_),_=setTimeout(()=>H(n.value,r,e),300)}),n.addEventListener("click",r=>r.stopPropagation())}),j(e),L(e),C(e))}function j(e){e.querySelectorAll("[data-pick]").forEach(t=>{t.dataset.wired||(t.dataset.wired="1",t.addEventListener("click",n=>{n.stopPropagation();const r=Number(t.dataset.pick),o=p.find(i=>i.id===r);if(!o)return;const a=t.closest("[data-picker]")?.dataset.picker;a&&(m.set(a,o),y=null,q(e))}))})}function C(e){const t=e.querySelector("#bm-footer"),n=e.querySelector("#bm-count");if(!t||!n)return;const r=m.size;n.textContent=r,t.style.display=r>0?"flex":"none"}async function W(e){const t=m.size;if(t===0||!await F({title:"Link all IDs?",message:`Link ${t} biometric ${t===1?"ID":"IDs"} to the selected members?`,confirmText:`Link ${t===1?"ID":`${t} IDs`}`}))return;const r=e.querySelector("#bm-footer"),o=e.querySelector("#bm-progress"),d=e.querySelector("#bm-fill"),a=e.querySelector("#bm-progress-text"),i=e.querySelector("#bm-link-all");r&&(r.style.display="none"),o&&(o.style.display="block"),i&&(i.disabled=!0);const u=[...m.entries()].map(([l,f])=>({external_id:l,member_id:f.id}));a&&(a.textContent=`Linking ${u.length} IDs…`);const s=await k("/api/mobile/v1/rrr/mappings/bulk-resolve",{method:"POST",body:{mappings:u}});if(d&&(d.style.width="100%"),s.ok){const l=s.data.linked||0,f=(s.data.results||[]).filter(h=>!h.ok);if(f.length){a&&(a.textContent=`✓ Linked ${l}, ${f.length} failed: IDs ${f.map(h=>h.external_id).join(", ")}`),f[0]?.error&&S(f[0].error,"error");for(const h of s.data.results||[])h.ok&&m.delete(h.external_id);setTimeout(()=>$(e),2500)}else a&&(a.textContent=`✓ Linked ${l} of ${u.length}`),m.clear(),setTimeout(()=>$(e),1200)}else a&&(a.textContent="Something went wrong. Try again."),i&&(i.disabled=!1),setTimeout(()=>{o&&(o.style.display="none"),C(e)},2e3)}export{K as default};
