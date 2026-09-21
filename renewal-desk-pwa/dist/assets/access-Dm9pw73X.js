import{a as _,i as x,z as L,b as k,k as u,A as p,f as T,e as b,n as g,D as q,u as f}from"./index-1Q0YpctZ.js";const D={async mount(i){let d="all",y="",r=null,l=[];i.innerHTML=`
      ${_({title:"Live Access",showBack:!1})}
      <div class="scroll-view" id="access-scroll">
        <div class="scroll-content">
          <!-- Summary Card -->
          <div style="padding:0 var(--sp-lg) var(--sp-md)">
            <div class="card card-body" id="access-summary-card">
              <div class="access-device-status-row" style="margin-bottom:var(--sp-sm)">
                <span class="device-dot" id="acc-device-dot" style="background:var(--muted)"></span>
                <span style="font-size:var(--fs-xs);color:var(--text-secondary);font-weight:var(--fw-medium)" id="acc-device-text">Biometric Device: Offline</span>
                <span style="font-size:var(--fs-xs);color:var(--muted);margin-left:auto" id="acc-device-sync"></span>
              </div>
              <div class="access-stats-grid">
                <div class="access-tile" data-filter="inside" style="cursor:pointer">
                  <div class="access-tile-value" style="color:var(--success)" id="acc-val-inside">0</div>
                  <div class="access-tile-label">Inside Now</div>
                </div>
                <div class="access-tile bordered" data-filter="entry" style="cursor:pointer">
                  <div class="access-tile-value" style="color:var(--brand)" id="acc-val-entries">0</div>
                  <div class="access-tile-label">Entries Today</div>
                </div>
                <div class="access-tile bordered" data-filter="exit" style="cursor:pointer">
                  <div class="access-tile-value" style="color:var(--warning)" id="acc-val-exits">0</div>
                  <div class="access-tile-label">Exits Today</div>
                </div>
                <div class="access-tile bordered" data-filter="denied" style="cursor:pointer">
                  <div class="access-tile-value" style="color:var(--critical)" id="acc-val-denied">0</div>
                  <div class="access-tile-label">Denied</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Search & Filter Chips -->
          <div style="padding:0 var(--sp-lg) var(--sp-sm)">
            <div class="search-box" style="margin-bottom:var(--sp-sm)">
              ${x("search",18,"var(--muted)")}
              <input type="text" class="search-input" id="acc-search-input" placeholder="Search member name...">
            </div>
            <div class="filter-chips" id="acc-filter-chips">
              <button class="filter-chip active" data-tab="all">All</button>
              <button class="filter-chip" data-tab="inside">Inside Now</button>
              <button class="filter-chip" data-tab="entry">Entries</button>
              <button class="filter-chip" data-tab="exit">Exits</button>
              <button class="filter-chip" data-tab="denied">Denied</button>
            </div>
          </div>

          <!-- Events List Container -->
          <div id="access-events-container" style="padding:0 var(--sp-lg) var(--sp-lg)">
            ${L()}
          </div>
        </div>
      </div>`,k(i,{onBack:()=>g.switchTab("dashboard")}),i.querySelector("#acc-filter-chips")?.addEventListener("click",t=>{const s=t.target.closest(".filter-chip");s&&(i.querySelectorAll(".filter-chip").forEach(n=>n.classList.remove("active")),s.classList.add("active"),d=s.dataset.tab,o())});const S=i.querySelector("#acc-search-input");let h;S?.addEventListener("input",t=>{clearTimeout(h),h=setTimeout(()=>{y=t.target.value.trim(),o()},300)}),i.querySelectorAll(".access-tile[data-filter]").forEach(t=>{t.addEventListener("click",()=>{const s=t.dataset.filter,n=i.querySelector(`.filter-chip[data-tab="${s}"]`);n&&(i.querySelectorAll(".filter-chip").forEach(e=>e.classList.remove("active")),n.classList.add("active"),d=s,o())})});async function E(){const t=await u("/api/mobile/v1/access/summary");if(t.ok){r=t.data;const s=i.querySelector("#acc-device-dot"),n=i.querySelector("#acc-device-text"),e=i.querySelector("#acc-device-sync");s&&(s.style.background=r.device_online?"var(--success)":"var(--muted)"),n&&(n.textContent=`${r.device_name||"Biometric Device"}: ${r.device_online?"Online":"Offline"}`),e&&r.last_event_at&&(e.textContent=`Last scan ${new Date(r.last_event_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`);const c=i.querySelector("#acc-val-inside"),a=i.querySelector("#acc-val-entries"),v=i.querySelector("#acc-val-exits"),m=i.querySelector("#acc-val-denied");c&&(c.textContent=f(r.inside_now||0)),a&&(a.textContent=f(r.entries_today||0)),v&&(v.textContent=f(r.exits_today||0)),m&&(m.textContent=f(r.denied_today||0))}}async function o(){const t=i.querySelector("#access-events-container");if(!t)return;if(d==="inside"){t.innerHTML=L();const e=await u("/api/mobile/v1/access/inside");if(!e.ok){t.innerHTML=p({icon:"access",title:"Could not load members",text:e.error.message});return}const c=e.data.members||[];if(c.length===0){t.innerHTML=p({icon:"access",title:"No members inside",text:"No active gym entries currently open."});return}t.innerHTML=`
          <div class="card">
            ${c.map(a=>`
              <div class="list-item" data-member-id="${a.id}" style="cursor:pointer">
                ${T(a.full_name,"md")}
                <div class="list-item-content">
                  <div class="list-item-title">${b(a.full_name)}</div>
                  <div class="list-item-subtitle">Entered at ${new Date(a.entered_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div>
                </div>
                <span class="badge badge-active">INSIDE</span>
              </div>
            `).join("")}
          </div>`,t.querySelectorAll("[data-member-id]").forEach(a=>{a.addEventListener("click",()=>g.push("member-detail",{member:JSON.stringify({id:a.dataset.memberId})}))});return}let s="/api/mobile/v1/access/events?page=1&per_page=30&date=today";d==="entry"?s+="&type=entry":d==="exit"?s+="&type=exit":d==="denied"&&(s+="&type=denied"),y&&(s+=`&search=${encodeURIComponent(y)}`);const n=await u(s);if(n.ok)l=n.data.events||[];else{const e=await u("/api/mobile/v1/access/log?page_size=30");if(e.ok)l=e.data.events||e.data.log||[];else{t.innerHTML=p({icon:"access",title:"No access events",text:"Scans will appear here as members check in."});return}}if(l.length===0){t.innerHTML=p({icon:"access",title:"No access events",text:"No access events recorded today for this filter."});return}t.innerHTML=`
        <div class="card">
          ${l.map(e=>{const c=(e.event_type||"").toLowerCase().includes("entry")||(e.event_type||"").toLowerCase().includes("attendance"),a=(e.event_type||"").toLowerCase().includes("denied"),v=a?"badge-expired":c?"badge-active":"badge-pending",m=a?"DENIED":c?"ENTRY":"EXIT",$=a?"alert":c?"forward":"back",w=a?"var(--critical)":c?"var(--success)":"var(--warning)";return`
              <div class="list-item" data-member-id="${e.member_id||""}" style="cursor:pointer">
                <div style="width:36px;height:36px;border-radius:var(--r-full);background:${a?"var(--critical-surface)":c?"var(--success-surface)":"var(--warning-surface)"};display:flex;align-items:center;justify-content:center;flex-shrink:0">
                  ${x($,16,w)}
                </div>
                <div class="list-item-content">
                  <div class="list-item-title">${b(e.member_name||`Member #${e.member_id||"—"}`)}</div>
                  <div class="list-item-subtitle">${q(e.timestamp||e.created_at)} ${e.reason?`· ${b(e.reason)}`:""}</div>
                </div>
                <span class="badge ${v}">${m}</span>
              </div>`}).join("")}
        </div>`,t.querySelectorAll("[data-member-id]").forEach(e=>{e.addEventListener("click",()=>{const c=e.dataset.memberId;c&&g.push("member-detail",{member:JSON.stringify({id:c})})})})}await Promise.all([E(),o()])}};export{D as default};
