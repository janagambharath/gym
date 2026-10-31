import{a as N,A as M,q as L,b as R,f as u,F as E,g as o,j as C,i as $,v as B,s as d,E as P,n as T,P as S,B as H}from"./index-bJIZjDRL.js";const F={async mount(p){document.getElementById("quick-assign-overlay")?.remove();let n="all",x=null,b=null;async function r(){const a=p.querySelector("#ac-scroll");if(!a)return;const k=u("/api/mobile/v1/access/summary"),c=u(`/api/mobile/v1/access/events?per_page=25${n==="all"?"":`&type=${n}`}`),[v,l]=await Promise.all([k,c]),e=v.ok?v.data:x||{};x=e;const w=l.ok?l.data?.events||l.data?.log||[]:[];l.ok&&l.data?.members;const g=e.last_event_at?E(e.last_event_at):e.last_heartbeat?`Heartbeat: ${E(e.last_heartbeat)}`:"";a.innerHTML=`
        <div class="scroll-content">
          <!-- Summary Card -->
          <div style="padding:var(--sp-lg)">
            <div class="card card-body" style="text-align:center">
              <div style="display:flex;align-items:center;justify-content:center;gap:var(--sp-sm);margin-bottom:var(--sp-sm)">
                <span style="width:10px;height:10px;border-radius:50%;background:${e.device_online?"var(--success)":"var(--muted)"}"></span>
                <span style="font-weight:var(--fw-bold);font-size:var(--fs-base)">${e.device_online?"Biometric Device Online":"Biometric Device Offline"}</span>
                ${e.device_name?`<span style="font-size:var(--fs-xs);color:var(--muted)">· ${o(e.device_name)}</span>`:""}
              </div>
              ${g?`<div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:var(--sp-md)">Last event: ${o(g)}</div>`:'<div style="margin-bottom:var(--sp-md)"></div>'}
              <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:var(--sp-lg)">
                <div style="cursor:pointer" id="stat-entries">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--brand)">${C(e.entries_today||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Entries</div>
                </div>
                <div style="cursor:pointer" id="stat-exits">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--warning)">${C(e.exits_today||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Exits</div>
                </div>
              </div>

              ${e.remote_unlock_available?`
              <!-- Remote Physical Gate Control -->
              <div style="margin-top:var(--sp-lg);padding-top:var(--sp-md);border-top:1px solid var(--border);display:grid;grid-template-columns:1fr;gap:var(--sp-sm)">
                <button class="btn" id="btn-remote-unlock" style="font-weight:var(--fw-semibold);display:flex;align-items:center;justify-content:center;gap:var(--sp-xs);font-size:var(--fs-xs);background:#16a34a;color:white;border:none">
                  🔓 Unlock Gate
                </button>
              </div>
              `:""}
            </div>

            ${e.adms_integration_id?"":`
            <!-- Hardware Bridge Controls (only when NOT on Direct Cloud) -->
            <div class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);display:flex;flex-direction:column;gap:var(--sp-sm)">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <div style="font-weight:var(--fw-bold);font-size:var(--fs-xs);text-transform:uppercase;color:var(--muted);letter-spacing:0.5px">Hardware Bridge Controls</div>
                <span style="font-size:10px;font-weight:var(--fw-bold);padding:2px 8px;border-radius:12px;background:${e.bridge_online?"#dcfce7":"#fee2e2"};color:${e.bridge_online?"#15803d":"#b91c1c"}">
                  ${e.bridge_online?"BRIDGE ONLINE":"BRIDGE OFFLINE"}
                </span>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-xs)">
                <button class="btn btn-secondary btn-sm" id="btn-reconcile-all" style="font-size:var(--fs-xs);padding:6px 10px">🔄 Re-sync Members</button>
                <button class="btn btn-secondary btn-sm" id="btn-bridge-pairing" style="font-size:var(--fs-xs);padding:6px 10px">🔑 Pairing Code</button>
              </div>
            </div>
            `}

            ${e.adms_integration_id?`
            <!-- Direct Cloud (ADMS) Status -->
            <div class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);display:flex;flex-direction:column;gap:var(--sp-sm)">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <div style="font-weight:var(--fw-bold);font-size:var(--fs-xs);text-transform:uppercase;color:var(--muted);letter-spacing:0.5px">Direct Cloud Terminal</div>
                <span style="font-size:10px;font-weight:var(--fw-bold);padding:2px 8px;border-radius:12px;background:${e.adms_online?"#dcfce7":"#fee2e2"};color:${e.adms_online?"#15803d":"#b91c1c"}">
                  ${e.adms_online?"ONLINE":"OFFLINE"}
                </span>
              </div>
              ${e.adms_device_name?`<div style="font-size:var(--fs-xs);color:var(--muted)">${o(e.adms_device_name)}</div>`:""}
              <p style="font-size:var(--fs-xs);color:var(--muted);margin:0">${e.adms_online?e.adms_commands_enabled?"Terminal polled recently. Membership block/restore commands are enabled.":"Terminal polled recently, but automatic membership commands are not enabled yet.":`No recent terminal poll${e.adms_last_seen_at?` (last seen ${o(E(e.adms_last_seen_at))})`:""}. It cannot receive block/unblock commands until it reconnects.`}</p>
            </div>
            `:""}

            ${e.failed_commands>0?`
              <div class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);background:rgba(245,158,11,0.1);border-color:rgba(245,158,11,0.3);display:flex;align-items:center;justify-content:space-between">
                <div style="font-size:var(--fs-xs);color:#B45309;display:flex;align-items:center;gap:var(--sp-xs)">
                  ${$("alert",16,"#B45309")}
                  <span><strong>${C(e.failed_commands)} command(s)</strong> failed to sync</span>
                </div>
                <button class="btn btn-sm btn-primary" id="btn-retry-sync" style="font-size:var(--fs-xs);padding:4px 10px">Retry All</button>
              </div>
            `:""}

            ${e.denied_today>0?`
              <div class="card" id="banner-denied" style="margin-top:var(--sp-md);padding:var(--sp-md);background:var(--critical-surface);border-color:var(--critical-border);display:flex;align-items:center;justify-content:space-between;cursor:pointer">
                <div style="display:flex;align-items:center;gap:var(--sp-sm)">
                  ${$("alert",18,"var(--critical)")}
                  <span style="font-size:var(--fs-sm);font-weight:var(--fw-semibold);color:var(--critical)">${C(e.denied_today)} access denied event${e.denied_today>1?"s":""} today</span>
                </div>
                ${$("forward",14,"var(--critical)")}
              </div>
            `:""}

            ${!e.device_online&&(e.inside_now||0)===0&&(e.entries_today||0)===0?`
              <div style="margin-top:var(--sp-md);padding:var(--sp-sm) var(--sp-md);background:var(--gray-50, #f8f9fa);border:1px dashed var(--border);border-radius:var(--r-md);font-size:var(--fs-xs);color:var(--muted);text-align:center">
                💡 Tip: Tap <b>"+ Check In Member"</b> above to log attendance manually anytime, or connect your biometric turnstile/machine.
              </div>
            `:""}
          </div>

          <!-- Filter Tabs -->
          <div style="display:flex;gap:var(--sp-xs);padding:0 var(--sp-lg) var(--sp-md);overflow-x:auto;-webkit-overflow-scrolling:touch">
            ${[{id:"all",label:"All Events"},{id:"entry",label:"Entries"},{id:"exit",label:"Exits"},{id:"denied",label:"Denied"}].map(t=>`
              <button class="btn btn-sm ${n===t.id?"btn-primary":"btn-secondary"}" data-tab="${t.id}" style="border-radius:var(--r-full);white-space:nowrap;padding:4px 12px;font-size:var(--fs-xs)">
                ${t.label}
              </button>
            `).join("")}
          </div>

          <!-- List Section -->
          ${`
            ${w.length>0?`
              <div class="card" style="margin:0 var(--sp-lg)">
                ${w.map(t=>{const i=(t.event_type||"ENTRY").toUpperCase(),m=i==="ENTRY"||i==="ATTENDANCE",y=i==="ACCESS_DENIED",q=y?"var(--critical-surface)":m?"var(--success-surface)":"var(--gray-100)",z=y?"var(--critical)":m?"var(--success)":"var(--muted)",I=y?"alert":m?"forward":"back",A=y?"expired":m?"active":"info",D=y?"Denied":i==="ATTENDANCE"?"Check In":m?"Entry":"Exit";return`
                    <div class="list-item" style="cursor:pointer" data-event-member-id="${t.member_id||""}" data-bio-id="${!t.member_id&&t.biometric_user_id?o(t.biometric_user_id):""}">
                      <div style="width:34px;height:34px;border-radius:var(--r-full);background:${q};display:flex;align-items:center;justify-content:center;flex-shrink:0">
                        ${$(I,16,z)}
                      </div>
                      <div class="list-item-content">
                        <div class="list-item-title">${o(t.member_name||"Unknown")}${!t.member_id&&t.biometric_user_id?' <span style="font-size:11px;color:#3b82f6;font-weight:700">· tap to assign</span>':""}</div>
                        <div class="list-item-subtitle">${E(t.event_timestamp||t.timestamp||t.created_at)}${t.device_name?` · ${o(t.device_name)}`:""}</div>
                      </div>
                      <span class="badge badge-${A}">${D}</span>
                    </div>
                  `}).join("")}
              </div>
            `:B({icon:"access",title:"No events",text:"Live access and check-in events will appear here"})}
          `}
        </div>
      `,a.querySelectorAll("[data-tab]").forEach(t=>{t.addEventListener("click",()=>{n=t.dataset.tab,a.innerHTML=L(),r()})}),a.querySelector("#stat-entries")?.addEventListener("click",()=>{n="entry",r()}),a.querySelector("#stat-exits")?.addEventListener("click",()=>{n="exit",r()}),a.querySelector("#banner-denied")?.addEventListener("click",()=>{n="denied",r()});const f=a.querySelector("#btn-remote-unlock");f&&f.addEventListener("click",async()=>{f.disabled=!0,f.textContent="Unlocking...";const t=await u("/api/mobile/v1/access/remote-unlock",{method:"POST",body:{delay_seconds:5}});t.ok?d("🔓 Turnstile / Door unlocked for 5s!","success"):d(t.error?.message||"Could not unlock door","error"),f.disabled=!1,f.textContent="🔓 Unlock Gate"});const s=a.querySelector("#btn-reconcile-all");s&&s.addEventListener("click",async()=>{s.disabled=!0,s.textContent="Syncing...";const t=await u("/api/mobile/v1/access/reconcile",{method:"POST"});t.ok?(d(t.data?.message||"Re-sync queued for device","success"),await r()):d(t.error?.message||"Re-sync failed","error"),s.disabled=!1,s.textContent="🔄 Re-sync Members"});const _=a.querySelector("#btn-bridge-pairing");_&&_.addEventListener("click",async()=>{_.disabled=!0;const t=await u("/api/mobile/v1/settings/bridge/pairing-code",{method:"POST"});_.disabled=!1,t.ok&&t.data?.pairing_code?await P({title:"Bridge Pairing Code",message:`Your 6-digit pairing code is:

${t.data.pairing_code}

Valid for 10 minutes. Enter this code into RenewalDeskConnector.exe on your gym PC to connect.`,confirmText:"Done"}):d(t.error?.message||"Could not generate pairing code","error")}),a.querySelector("#btn-retry-sync")?.addEventListener("click",async()=>{const t=a.querySelector("#btn-retry-sync");t&&(t.disabled=!0);const i=await u("/api/mobile/v1/access/retry-sync",{method:"POST"});i.ok?(d(i.data?.message||"Commands queued for retry","success"),await r()):(d(i.error?.message||"Could not retry syncs","error"),t&&(t.disabled=!1))}),a.querySelectorAll("[data-member-link]").forEach(t=>{t.addEventListener("click",()=>{const i=t.dataset.memberLink;i&&T.push("member-detail",{memberId:i})})}),a.querySelectorAll("[data-event-member-id]").forEach(t=>{t.addEventListener("click",()=>{const i=t.dataset.eventMemberId,m=t.dataset.bioId;i?T.push("member-detail",{memberId:i}):m&&j(m)})}),a.querySelectorAll("[data-checkout-id]").forEach(t=>{t.addEventListener("click",async i=>{i.stopPropagation();const m=t.dataset.checkoutId,y=t.dataset.checkoutName;t.disabled=!0,t.textContent="Checking out...";const q=await S(m,"EXIT");q.ok?(d(`${y} checked out`,"success"),await r()):(d(q.error?.message||"Check-out failed","error"),t.disabled=!1,t.textContent="Check Out")})})}function h(){const a=document.createElement("div");a.className="modal-overlay center",a.innerHTML=`
        <div class="confirm-dialog" style="max-width:440px;width:90%;max-height:85vh;display:flex;flex-direction:column;padding:var(--sp-lg)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-md)">
            <div style="font-weight:var(--fw-bold);font-size:var(--fs-lg)">Manual Check In</div>
            <button id="modal-close" style="background:none;border:none;cursor:pointer;padding:4px">${$("close",20,"var(--muted)")}</button>
          </div>
          <div style="margin-bottom:var(--sp-md)">
            <input type="text" id="checkin-search" class="form-input" placeholder="Search member by name or phone..." style="width:100%" autofocus />
          </div>
          <div id="checkin-members-list" style="overflow-y:auto;max-height:50vh;display:flex;flex-direction:column;gap:var(--sp-xs)">
            <div style="text-align:center;padding:var(--sp-lg);color:var(--muted)">Loading active members...</div>
          </div>
        </div>
      `,document.body.appendChild(a),a.querySelector("#modal-close").onclick=()=>a.remove(),a.onclick=e=>{e.target===a&&a.remove()};const k=a.querySelector("#checkin-search"),c=a.querySelector("#checkin-members-list");let v=null;async function l(e=""){const w=`/api/mobile/v1/members?page_size=20${e?`&q=${encodeURIComponent(e)}`:"&status=active"}`,g=await u(w);if(!g.ok){c.innerHTML='<div style="text-align:center;padding:var(--sp-md);color:var(--critical)">Failed to load members</div>';return}const f=g.data?.members||[];if(f.length===0){c.innerHTML=`<div style="text-align:center;padding:var(--sp-lg);color:var(--muted)">No members found matching "${o(e)}"</div>`;return}c.innerHTML=f.map(s=>`
          <div class="card card-body" style="padding:var(--sp-sm) var(--sp-md);display:flex;align-items:center;justify-content:space-between;gap:var(--sp-sm)">
            <div style="display:flex;align-items:center;gap:var(--sp-sm);min-width:0;flex:1">
              ${H(s.full_name||"Member","sm")}
              <div style="min-width:0">
                <div style="font-weight:var(--fw-semibold);font-size:var(--fs-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${o(s.full_name)}</div>
                <div style="font-size:var(--fs-xs);color:var(--muted)">${o(s.phone||"")}${s.plan?` · ${o(s.plan.name)}`:""}</div>
              </div>
            </div>
            <button class="btn btn-primary btn-sm btn-do-checkin" data-mid="${s.id}" data-mname="${o(s.full_name)}" style="border-radius:var(--r-full);padding:4px 12px;font-size:var(--fs-xs);flex-shrink:0">
              Check In
            </button>
          </div>
        `).join(""),c.querySelectorAll(".btn-do-checkin").forEach(s=>{s.addEventListener("click",async()=>{const _=s.dataset.mid,t=s.dataset.mname;s.disabled=!0,s.textContent="Checking in...";const i=await S(_,"ENTRY");i.ok?(d(`${t} checked in successfully!`,"success"),a.remove(),await r()):(d(i.error?.message||"Check-in failed","error"),s.disabled=!1,s.textContent="Check In")})})}k.addEventListener("input",e=>{clearTimeout(v),v=setTimeout(()=>{l(e.target.value.trim())},300)}),l()}p.innerHTML=`
      ${N({title:"Live Access",showBack:M.depth>1,actions:[{icon:"access",label:"Check In",onClick:()=>h()},{icon:"refresh",label:"Refresh",onClick:()=>r()}]})}
      <div class="scroll-view" id="ac-scroll">${L()}</div>
    `,R(p,{onBack:()=>{b&&clearInterval(b),T.pop()},actions:[{icon:"access",onClick:()=>h()},{icon:"refresh",onClick:()=>r()}]}),await r(),b=setInterval(()=>{document.body.contains(p)?r():clearInterval(b)},15e3),window.__refreshAccess=()=>{document.body.contains(p)&&r()}},async unmount(){window.__refreshAccess=null}};async function j(p){const n=document.createElement("div");n.id="quick-assign-overlay",n.innerHTML=`
    <div class="qa-sheet">
      <div class="qa-handle"></div>
      <h3>Who is biometric ID ${o(p)}?</h3>
      <p class="qa-sub">Pick the member — all their punches get linked.</p>
      <input id="qa-search" type="search" placeholder="Type member name…" autocomplete="off">
      <div id="qa-results"><div class="qa-loading">Loading members…</div></div>
      <button id="qa-close" class="qa-close">Cancel</button>
    </div>
    <style>
      #quick-assign-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 100; display: flex; align-items: flex-end; animation: qaFade 0.2s; }
      @keyframes qaFade { from { opacity: 0; } }
      .qa-sheet { background: #fff; width: 100%; border-radius: 20px 20px 0 0; padding: 12px 20px calc(20px + env(safe-area-inset-bottom)); max-height: 75vh; display: flex; flex-direction: column; animation: qaSlide 0.25s; }
      @keyframes qaSlide { from { transform: translateY(40px); } }
      .qa-handle { width: 40px; height: 4px; background: #e2e8f0; border-radius: 2px; margin: 0 auto 12px; }
      .qa-sheet h3 { margin: 0 0 4px 0; font-size: 18px; font-weight: 800; }
      .qa-sub { margin: 0 0 12px 0; font-size: 13px; color: #64748b; }
      #qa-search { width: 100%; padding: 12px; border: 1.5px solid #e2e8f0; border-radius: 10px; font-size: 15px; box-sizing: border-box; margin-bottom: 8px; }
      #qa-search:focus { outline: none; border-color: #3b82f6; }
      #qa-results { overflow-y: auto; flex: 1; min-height: 120px; }
      .qa-row { padding: 13px 4px; border-bottom: 1px solid #f1f5f9; font-size: 15px; cursor: pointer; }
      .qa-row:active { background: #eff6ff; }
      .qa-row b { font-weight: 700; }
      .qa-row span { color: #64748b; font-size: 13px; margin-left: 6px; }
      .qa-loading, .qa-empty { padding: 24px; text-align: center; color: #94a3b8; font-size: 14px; }
      .qa-close { margin-top: 12px; width: 100%; padding: 13px; border: none; background: #f1f5f9; border-radius: 12px; font-weight: 700; font-size: 15px; color: #475569; cursor: pointer; }
    </style>`,document.body.appendChild(n);const x=()=>n.remove();n.addEventListener("click",c=>{c.target===n&&x()}),n.querySelector("#qa-close").addEventListener("click",x);let b=[];const r=n.querySelector("#qa-results"),h=n.querySelector("#qa-search"),a=c=>{const v=(c||"").toLowerCase().trim(),l=v?b.filter(e=>e.full_name.toLowerCase().includes(v)||(e.phone||"").includes(v)).slice(0,30):b.slice(0,30);r.innerHTML=l.length?l.map(e=>`<div class="qa-row" data-qa-pick="${e.id}"><b>${o(e.full_name)}</b>${e.phone?`<span>${o(e.phone)}</span>`:""}</div>`).join(""):'<div class="qa-empty">No members found</div>',r.querySelectorAll("[data-qa-pick]").forEach(e=>{e.addEventListener("click",async()=>{const w=Number(e.dataset.qaPick);e.style.background="#dcfce7";const g=await u("/api/mobile/v1/rrr/mappings/bulk-resolve",{method:"POST",body:{mappings:[{external_id:p,member_id:w}]}});g.ok&&g.data.linked===1?(d(`ID ${p} linked ✓`),x(),window.__refreshAccess&&window.__refreshAccess()):(d("Link failed — try again"),e.style.background="")})})};h.addEventListener("input",()=>a(h.value));const k=await u("/api/mobile/v1/members?page=1&page_size=500");b=k.ok?k.data.members||[]:[],a(""),h.focus()}export{F as default};
