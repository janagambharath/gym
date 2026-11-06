import{g as h,s as w,p as P,n as j,t as H,j as A}from"./index-C9y_aAuQ.js";const W={async mount(e){await y(e)}},b=A;let l=[],m=[],c=new Map,x=null,C=null,u=1,v=0,g=1;function F(){const e=P()?.tenantId??null;e!==C&&(C=e,l=[],m=[],c=new Map,x=null,u=1,v=0,g=1)}async function y(e){F(),x=null,u=1,e.innerHTML='<div class="rrr-loading">Loading unmapped punches…</div>';const[t,r]=await Promise.all([h("/api/mobile/v1/rrr/mappings/unresolved?page=1&per_page=50"),h("/api/mobile/v1/members?page=1&page_size=50")]);if(!t.ok){e.innerHTML=`<main class="rrr-page"><h1>Couldn't load</h1><p>Check your connection and retry.</p><button id="rrr-retry" class="rrr-btn">Retry</button></main>`,e.querySelector("#rrr-retry")?.addEventListener("click",()=>y(e));return}m=r.ok?r.data.members||[]:[];const n=!r.ok;n&&w("Could not load the member list — search may miss members. Check your connection and retry.","error");const a=t.data.pagination||{};v=a.total??0,g=a.total_pages??1,u=a.page??1,l=(t.data.groups||[]).map(i=>({id:String(i.biometric_user_id),count:i.punch_count||0,latest:i.latest_punch_time}));const s=new Set(l.map(i=>i.id));for(const i of c.keys())s.has(i)||c.delete(i);B(e,n)}async function O(e){if(u>=g)return;const t=e.querySelector("#bm-more");t&&(t.disabled=!0,t.textContent="Loading…");const r=await h(`/api/mobile/v1/rrr/mappings/unresolved?page=${u+1}&per_page=50`);if(!r.ok){t&&(t.disabled=!1,t.textContent="Load more IDs"),w(r.error?.message||"Could not load more IDs.","error");return}u=r.data.pagination?.page??u+1,g=r.data.pagination?.total_pages??g;const n=(r.data.groups||[]).map(o=>({id:String(o.biometric_user_id),count:o.punch_count||0,latest:o.latest_punch_time}));l=[...l,...n];const a=e.querySelector("#bm-list");a&&(a.insertAdjacentHTML("beforeend",n.map($).join("")),a.querySelectorAll(".bm-card").forEach(o=>{o.dataset.wired||(o.dataset.wired="1",o.addEventListener("click",f=>{f.target.closest(".bm-picker")||L(e,o.dataset.bid)}))}),S(a));const s=e.querySelector("#bm-count-line");s&&(s.textContent=`Showing ${l.length} of ${v} unmapped IDs`);const i=e.querySelector("#bm-more-wrap");i&&(i.style.display=u<g?"":"none"),t&&(t.disabled=!1,t.textContent="Load more IDs")}let _,E=0;async function R(e,t,r){const n=++E,a=r.querySelector(`[data-results="${CSS.escape(t)}"]`);if(!a)return;const s=(e||"").trim(),i=await h(`/api/mobile/v1/members?page=1&page_size=50${s?`&q=${encodeURIComponent(s)}`:""}`);if(n!==E)return;const o=i.ok?i.data.members||[]:[],f=i.ok?i.data.pagination?.total??o.length:0,p=new Set(m.map(d=>d.id));for(const d of o)p.has(d.id)||(m.push(d),p.add(d.id));if(m.length>200){const d=new Set([...c.values()].map(k=>k.id)),T=m.filter(k=>d.has(k.id)),M=m.filter(k=>!d.has(k.id)).slice(-(200-T.length));m=[...T,...M]}a.innerHTML=I(o)+(f>o.length?`<div class="bm-no-results">Showing ${o.length} of ${f} members — refine your search to find more.</div>`:""),D(r)}function B(e,t=!1){const r=l.reduce((n,a)=>n+a.count,0);e.innerHTML=`<main class="rrr-page bulk-map-page">
    <header class="rrr-header">
      <button id="bm-back" class="bm-back">‹</button>
      <div class="bm-title">
        <h1>Link biometric IDs</h1>
        <p>${v||l.length} IDs · ${r} punches need a member</p>
      </div>
    </header>
    
    <div class="bm-hint">
      <span class="bm-hint-icon">💡</span>
      <p>Tap an ID, search the member name, tap to assign. Then hit <b>Link all</b> at the bottom.</p>
    </div>
    
    <div class="bm-list" id="bm-list">
      ${l.map($).join("")}
    </div>
    ${t?'<div class="bm-hint" style="background:#fef3c7"><span class="bm-hint-icon">⚠️</span><p style="color:#92400e">Member list failed to load — search may miss members. Check your connection and reload.</p></div>':""}
    <div id="bm-count-line" style="padding:var(--sp-sm) 0;font-size:var(--fs-sm);color:var(--muted);text-align:center">Showing ${l.length} of ${v} unmapped IDs</div>
    <div id="bm-more-wrap" style="text-align:center;padding:var(--sp-md);${u<g?"":"display:none"}"><button class="btn btn-secondary" id="bm-more">Load more IDs</button></div>
    
    <div class="bm-footer" id="bm-footer" style="display:none">
      <div class="bm-footer-info"><span id="bm-count">0</span> ready to link</div>
      <button class="bm-link-all" id="bm-link-all">Link all →</button>
    </div>
    ${l.length?`<div class="bm-danger-row">
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
  </style>`,e.querySelector("#bm-back")?.addEventListener("click",()=>j.back()),e.querySelector("#bm-more")?.addEventListener("click",()=>O(e)),e.querySelector("#bm-link-all")?.addEventListener("click",()=>G(e)),e.querySelector("#bm-clear-all")?.addEventListener("click",async()=>{if(!confirm(`Delete ALL unmapped punch entries?

This cannot be undone. Mapped punches and members are safe.`)||!confirm("Final confirm: clear all unmapped entries?"))return;const n=await h("/api/mobile/v1/rrr/attendance/unmapped",{method:"DELETE"});n.ok?(alert(`Cleared ${n.data.deleted} unmapped entries.`),y(e)):alert("Failed: "+(n.data?.message||n.error||"unknown error"))}),e.querySelectorAll(".bm-card").forEach(n=>{n.dataset.wired="1",n.addEventListener("click",a=>{a.target.closest(".bm-picker")||L(e,n.dataset.bid)})}),S(e),z(e)}function S(e){e.querySelectorAll("[data-save-one]").forEach(t=>{t.dataset.wired||(t.dataset.wired="1",t.addEventListener("click",async r=>{r.stopPropagation();const n=t.dataset.saveOne,a=c.get(n);if(!a)return;t.disabled=!0,t.textContent="Linking…";const s=await h("/api/mobile/v1/rrr/mappings/bulk-resolve",{method:"POST",body:{mappings:[{external_id:n,member_id:a.id}]}});if(s.ok&&s.data.linked===1)t.textContent="✓ Linked",c.delete(n),l=l.filter(i=>i.id!==n),setTimeout(()=>q(e),600);else{t.disabled=!1,t.textContent="Save link";const i=s?.data?.results?.find(o=>String(o.external_id)===String(n))?.error;w(i||s?.error?.message||"Could not link — try again.","error")}}))})}function $(e){const t=c.get(e.id),r=x===e.id,n=e.latest?H(e.latest):"";return`<div class="bm-card ${t?"ready":""}" data-bid="${b(e.id)}">
    <div class="bm-card-top">
      <div class="bm-id-wrap">
        <span class="bm-id-badge">BIOMETRIC</span>
        <span class="bm-id-num">ID ${b(e.id)}</span>
      </div>
      <span class="bm-punches">${e.count} punches · ${n}</span>
    </div>
    ${t?`
    <div class="bm-assigned">
      <span class="bm-check">✓</span>
      <span class="bm-member-name">${b(t.full_name)}</span>
      <span class="bm-change">change</span>
    </div>
    <button class="bm-save-one" data-save-one="${b(e.id)}">Save link</button>`:`
    <div class="bm-tap-hint">Tap to assign a member →</div>`}
    ${r?N(e.id):""}
  </div>`}function N(e){return`<div class="bm-picker" data-picker="${b(e)}">
    <input class="bm-search" data-search="${b(e)}" type="search" placeholder="Type member name…" autocomplete="off">
    <div class="bm-results" data-results="${b(e)}">${I(m.slice(0,20))}</div>
  </div>`}function I(e){return e.length?e.map(t=>`
    <div class="bm-result" data-pick="${t.id}" data-bid-name="${b(t.full_name)}">
      <span class="bm-result-name">${b(t.full_name)}</span>
      ${t.phone?`<span class="bm-result-phone">${b(t.phone)}</span>`:""}
    </div>`).join(""):'<div class="bm-no-results">No members found</div>'}function L(e,t){x=x===t?null:t,q(e)}function q(e){const t=e.querySelector("#bm-list");t&&(t.innerHTML=l.map($).join(""),e.querySelectorAll(".bm-card").forEach(r=>{r.dataset.wired="1",r.addEventListener("click",n=>{n.target.closest(".bm-picker")||L(e,r.dataset.bid)})}),e.querySelectorAll("[data-search]").forEach(r=>{r.addEventListener("input",()=>{const n=r.dataset.search;clearTimeout(_),_=setTimeout(()=>R(r.value,n,e),300)}),r.addEventListener("click",n=>n.stopPropagation())}),D(e),S(e),z(e))}function D(e){e.querySelectorAll("[data-pick]").forEach(t=>{t.dataset.wired||(t.dataset.wired="1",t.addEventListener("click",r=>{r.stopPropagation();const n=Number(t.dataset.pick),a=m.find(o=>o.id===n);if(!a)return;const i=t.closest("[data-picker]")?.dataset.picker;i&&(c.set(i,a),x=null,q(e))}))})}function z(e){const t=e.querySelector("#bm-footer"),r=e.querySelector("#bm-count");if(!t||!r)return;const n=c.size;r.textContent=n,t.style.display=n>0?"flex":"none"}async function G(e){const t=e.querySelector("#bm-footer"),r=e.querySelector("#bm-progress"),n=e.querySelector("#bm-fill"),a=e.querySelector("#bm-progress-text"),s=e.querySelector("#bm-link-all");t&&(t.style.display="none"),r&&(r.style.display="block"),s&&(s.disabled=!0);const i=[...c.entries()].map(([f,p])=>({external_id:f,member_id:p.id}));a&&(a.textContent=`Linking ${i.length} IDs…`);const o=await h("/api/mobile/v1/rrr/mappings/bulk-resolve",{method:"POST",body:{mappings:i}});if(n&&(n.style.width="100%"),o.ok){const f=o.data.linked||0,p=(o.data.results||[]).filter(d=>!d.ok);if(p.length){a&&(a.textContent=`✓ Linked ${f}, ${p.length} failed: IDs ${p.map(d=>d.external_id).join(", ")}`),p[0]?.error&&w(p[0].error,"error");for(const d of o.data.results||[])d.ok&&c.delete(d.external_id);setTimeout(()=>y(e),2500)}else a&&(a.textContent=`✓ Linked ${f} of ${i.length}`),c.clear(),setTimeout(()=>y(e),1200)}else a&&(a.textContent="Something went wrong. Try again."),s&&(s.disabled=!1),setTimeout(()=>{r&&(r.style.display="none"),z(e)},2e3)}export{W as default};
