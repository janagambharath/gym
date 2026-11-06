import{g as h,s as w,p as j,n as H,u as A,j as F}from"./index-ByhK-z4i.js";const J={async mount(e){await y(e)}},f=F;let c=[],p=[],m=new Map,x=null,C=null,u=1,I=0,v=0,g=1;function O(){const e=j()?.tenantId??null;e!==C&&(C=e,c=[],p=[],m=new Map,x=null,u=1,v=0,g=1)}async function y(e){O(),x=null,u=1,e.innerHTML='<div class="rrr-loading">Loading unmapped punches…</div>';const[t,n]=await Promise.all([h("/api/mobile/v1/rrr/mappings/unresolved?page=1&per_page=50"),h("/api/mobile/v1/members?page=1&page_size=50")]);if(!t.ok){e.innerHTML=`<main class="rrr-page"><h1>Couldn't load</h1><p>Check your connection and retry.</p><button id="rrr-retry" class="rrr-btn">Retry</button></main>`,e.querySelector("#rrr-retry")?.addEventListener("click",()=>y(e));return}p=n.ok?n.data.members||[]:[],I=n.ok?n.data.pagination?.total??p.length:p.length;const r=!n.ok;r&&w("Could not load the member list — search may miss members. Check your connection and retry.","error");const a=t.data.pagination||{};v=a.total??0,g=a.total_pages??1,u=a.page??1,c=(t.data.groups||[]).map(o=>({id:String(o.biometric_user_id),count:o.punch_count||0,latest:o.latest_punch_time}));const s=new Set(c.map(o=>o.id));for(const o of m.keys())s.has(o)||m.delete(o);G(e,r)}async function R(e){if(u>=g)return;const t=e.querySelector("#bm-more");t&&(t.disabled=!0,t.textContent="Loading…");const n=await h(`/api/mobile/v1/rrr/mappings/unresolved?page=${u+1}&per_page=50`);if(!n.ok){t&&(t.disabled=!1,t.textContent="Load more IDs"),w(n.error?.message||"Could not load more IDs.","error");return}u=n.data.pagination?.page??u+1,g=n.data.pagination?.total_pages??g;const r=(n.data.groups||[]).map(i=>({id:String(i.biometric_user_id),count:i.punch_count||0,latest:i.latest_punch_time})),a=new Set(c.map(i=>i.id)),s=r.filter(i=>!a.has(i.id));c=[...c,...s];const o=e.querySelector("#bm-list");o&&(o.insertAdjacentHTML("beforeend",s.map($).join("")),o.querySelectorAll(".bm-card").forEach(i=>{i.dataset.wired||(i.dataset.wired="1",i.addEventListener("click",l=>{l.target.closest(".bm-picker")||L(e,i.dataset.bid)}))}),S(o));const d=e.querySelector("#bm-count-line");d&&(d.textContent=`Showing ${c.length} of ${v} unmapped IDs`);const b=e.querySelector("#bm-more-wrap");b&&(b.style.display=u<g?"":"none"),t&&(t.disabled=!1,t.textContent="Load more IDs")}let _,E=0;async function B(e,t,n){const r=++E,a=n.querySelector(`[data-results="${CSS.escape(t)}"]`);if(!a)return;const s=(e||"").trim(),o=await h(`/api/mobile/v1/members?page=1&page_size=50${s?`&q=${encodeURIComponent(s)}`:""}`);if(r!==E)return;const d=o.ok?o.data.members||[]:[],b=o.ok?o.data.pagination?.total??d.length:0,i=new Set(p.map(l=>l.id));for(const l of d)i.has(l.id)||(p.push(l),i.add(l.id));if(p.length>200){const l=new Set([...m.values()].map(k=>k.id)),T=p.filter(k=>l.has(k.id)),P=p.filter(k=>!l.has(k.id)).slice(-(200-T.length));p=[...T,...P]}a.innerHTML=D(d)+(b>d.length?`<div class="bm-no-results">Showing ${d.length} of ${b} members — refine your search to find more.</div>`:""),M(n)}function G(e,t=!1){const n=c.reduce((r,a)=>r+a.count,0);e.innerHTML=`<main class="rrr-page bulk-map-page">
    <header class="rrr-header">
      <button id="bm-back" class="bm-back">‹</button>
      <div class="bm-title">
        <h1>Link biometric IDs</h1>
        <p>${v||c.length} IDs · ${n} punches need a member</p>
      </div>
    </header>
    
    <div class="bm-hint">
      <span class="bm-hint-icon">💡</span>
      <p>Tap an ID, search the member name, tap to assign. Then hit <b>Link all</b> at the bottom.</p>
    </div>
    
    <div class="bm-list" id="bm-list">
      ${c.map($).join("")}
    </div>
    ${t?'<div class="bm-hint" style="background:#fef3c7"><span class="bm-hint-icon">⚠️</span><p style="color:#92400e">Member list failed to load — search may miss members. Check your connection and reload.</p></div>':""}
    <div id="bm-count-line" style="padding:var(--sp-sm) 0;font-size:var(--fs-sm);color:var(--muted);text-align:center">Showing ${c.length} of ${v} unmapped IDs</div>
    <div id="bm-more-wrap" style="text-align:center;padding:var(--sp-md);${u<g?"":"display:none"}"><button class="btn btn-secondary" id="bm-more">Load more IDs</button></div>
    
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
  </style>`,e.querySelector("#bm-back")?.addEventListener("click",()=>H.back()),e.querySelector("#bm-more")?.addEventListener("click",()=>R(e)),e.querySelector("#bm-link-all")?.addEventListener("click",()=>U(e)),e.querySelector("#bm-clear-all")?.addEventListener("click",async()=>{if(!confirm(`Delete ALL unmapped punch entries?

This cannot be undone. Mapped punches and members are safe.`)||!confirm("Final confirm: clear all unmapped entries?"))return;const r=await h("/api/mobile/v1/rrr/attendance/unmapped",{method:"DELETE"});if(r.ok){const a=typeof r.data?.deleted=="number"?r.data.deleted:0;alert(`Cleared ${a} unmapped ${a===1?"entry":"entries"}.`),y(e)}else alert("Failed: "+(r.error?.message||"unknown error"))}),e.querySelectorAll(".bm-card").forEach(r=>{r.dataset.wired="1",r.addEventListener("click",a=>{a.target.closest(".bm-picker")||L(e,r.dataset.bid)})}),S(e),z(e)}function S(e){e.querySelectorAll("[data-save-one]").forEach(t=>{t.dataset.wired||(t.dataset.wired="1",t.addEventListener("click",async n=>{n.stopPropagation();const r=t.dataset.saveOne,a=m.get(r);if(!a)return;t.disabled=!0,t.textContent="Linking…";const s=await h("/api/mobile/v1/rrr/mappings/bulk-resolve",{method:"POST",body:{mappings:[{external_id:r,member_id:a.id}]}});if(s.ok&&s.data.linked===1)t.textContent="✓ Linked",m.delete(r),c=c.filter(o=>o.id!==r),setTimeout(()=>q(e),600);else{t.disabled=!1,t.textContent="Save link";const o=s?.data?.results?.find(d=>String(d.external_id)===String(r))?.error;w(o||s?.error?.message||"Could not link — try again.","error")}}))})}function $(e){const t=m.get(e.id),n=x===e.id,r=e.latest?A(e.latest):"";return`<div class="bm-card ${t?"ready":""}" data-bid="${f(e.id)}">
    <div class="bm-card-top">
      <div class="bm-id-wrap">
        <span class="bm-id-badge">BIOMETRIC</span>
        <span class="bm-id-num">ID ${f(e.id)}</span>
      </div>
      <span class="bm-punches">${e.count} punches · ${r}</span>
    </div>
    ${t?`
    <div class="bm-assigned">
      <span class="bm-check">✓</span>
      <span class="bm-member-name">${f(t.full_name)}</span>
      <span class="bm-change">change</span>
    </div>
    <button class="bm-save-one" data-save-one="${f(e.id)}">Save link</button>`:`
    <div class="bm-tap-hint">Tap to assign a member →</div>`}
    ${n?N(e.id):""}
  </div>`}function N(e){const t=p.slice(0,20),n=I||p.length;return`<div class="bm-picker" data-picker="${f(e)}">
    <input class="bm-search" data-search="${f(e)}" type="search" placeholder="Type member name…" autocomplete="off">
    <div class="bm-results" data-results="${f(e)}">${D(t)}${n>t.length?`<div class="bm-no-results">Showing ${t.length} of ${n} members — type to search for more.</div>`:""}</div>
  </div>`}function D(e){return e.length?e.map(t=>`
    <div class="bm-result" data-pick="${t.id}" data-bid-name="${f(t.full_name)}">
      <span class="bm-result-name">${f(t.full_name)}</span>
      ${t.phone?`<span class="bm-result-phone">${f(t.phone)}</span>`:""}
    </div>`).join(""):'<div class="bm-no-results">No members found</div>'}function L(e,t){x=x===t?null:t,q(e)}function q(e){const t=e.querySelector("#bm-list");t&&(t.innerHTML=c.map($).join(""),e.querySelectorAll(".bm-card").forEach(n=>{n.dataset.wired="1",n.addEventListener("click",r=>{r.target.closest(".bm-picker")||L(e,n.dataset.bid)})}),e.querySelectorAll("[data-search]").forEach(n=>{n.addEventListener("input",()=>{const r=n.dataset.search;clearTimeout(_),_=setTimeout(()=>B(n.value,r,e),300)}),n.addEventListener("click",r=>r.stopPropagation())}),M(e),S(e),z(e))}function M(e){e.querySelectorAll("[data-pick]").forEach(t=>{t.dataset.wired||(t.dataset.wired="1",t.addEventListener("click",n=>{n.stopPropagation();const r=Number(t.dataset.pick),a=p.find(d=>d.id===r);if(!a)return;const o=t.closest("[data-picker]")?.dataset.picker;o&&(m.set(o,a),x=null,q(e))}))})}function z(e){const t=e.querySelector("#bm-footer"),n=e.querySelector("#bm-count");if(!t||!n)return;const r=m.size;n.textContent=r,t.style.display=r>0?"flex":"none"}async function U(e){const t=e.querySelector("#bm-footer"),n=e.querySelector("#bm-progress"),r=e.querySelector("#bm-fill"),a=e.querySelector("#bm-progress-text"),s=e.querySelector("#bm-link-all");t&&(t.style.display="none"),n&&(n.style.display="block"),s&&(s.disabled=!0);const o=[...m.entries()].map(([b,i])=>({external_id:b,member_id:i.id}));a&&(a.textContent=`Linking ${o.length} IDs…`);const d=await h("/api/mobile/v1/rrr/mappings/bulk-resolve",{method:"POST",body:{mappings:o}});if(r&&(r.style.width="100%"),d.ok){const b=d.data.linked||0,i=(d.data.results||[]).filter(l=>!l.ok);if(i.length){a&&(a.textContent=`✓ Linked ${b}, ${i.length} failed: IDs ${i.map(l=>l.external_id).join(", ")}`),i[0]?.error&&w(i[0].error,"error");for(const l of d.data.results||[])l.ok&&m.delete(l.external_id);setTimeout(()=>y(e),2500)}else a&&(a.textContent=`✓ Linked ${b} of ${o.length}`),m.clear(),setTimeout(()=>y(e),1200)}else a&&(a.textContent="Something went wrong. Try again."),s&&(s.disabled=!1),setTimeout(()=>{n&&(n.style.display="none"),z(e)},2e3)}export{J as default};
