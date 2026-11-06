import{a as B,C as H,u as z,b as j,f as O,g as v,H as T,j as c,k as L,i as E,x as F,s as l,G as U,n as S,R as I,D as G}from"./index-8YfHVAgj.js";const Q={async mount(f){document.getElementById("quick-assign-overlay")?.remove();let n="all",x=null,h=0;async function r(){const d=++h,a=f.querySelector("#ac-scroll");if(!a)return;const b=v("/api/mobile/v1/access/summary"),p=v(`/api/mobile/v1/access/events?per_page=25${n==="all"?"":`&type=${n}`}`),[m,o]=await Promise.all([b,p]);if(d!==h||f.dataset.screenDisposed==="true"||(!m.ok||!o.ok)&&x)return;const t=m.ok?m.data:x||{};x=t;const w=o.ok?o.data?.events||o.data?.log||[]:[];o.ok&&o.data?.members;const g=t.last_event_at?T(t.last_event_at):t.last_heartbeat?`Heartbeat: ${T(t.last_heartbeat)}`:"";a.innerHTML=`
        <div class="scroll-content">
          <!-- Summary Card -->
          <div style="padding:var(--sp-lg)">
            <div class="card card-body" style="text-align:center">
              <div style="display:flex;align-items:center;justify-content:center;gap:var(--sp-sm);margin-bottom:var(--sp-sm)">
                <span style="width:10px;height:10px;border-radius:50%;background:${t.device_online?"var(--success)":"var(--muted)"}"></span>
                <span style="font-weight:var(--fw-bold);font-size:var(--fs-base)">${t.device_online?"Biometric Device Online":"Biometric Device Offline"}</span>
                ${t.device_name?`<span style="font-size:var(--fs-xs);color:var(--muted)">· ${c(t.device_name)}</span>`:""}
              </div>
              ${g?`<div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:var(--sp-md)">Last event: ${c(g)}</div>`:'<div style="margin-bottom:var(--sp-md)"></div>'}
              <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:var(--sp-lg)">
                <div style="cursor:pointer" id="stat-entries">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--brand)">${L(t.entries_today||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Entries</div>
                </div>
                <div style="cursor:pointer" id="stat-exits">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--warning)">${L(t.exits_today||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Exits</div>
                </div>
              </div>

              ${t.remote_unlock_available?`
              <!-- Remote Physical Gate Control -->
              <div style="margin-top:var(--sp-lg);padding-top:var(--sp-md);border-top:1px solid var(--border);display:grid;grid-template-columns:1fr;gap:var(--sp-sm)">
                <button class="btn" id="btn-remote-unlock" style="font-weight:var(--fw-semibold);display:flex;align-items:center;justify-content:center;gap:var(--sp-xs);font-size:var(--fs-xs);background:#16a34a;color:white;border:none">
                  🔓 Unlock Gate
                </button>
              </div>
              `:""}
            </div>

            ${t.adms_integration_id?"":`
            <!-- Hardware Bridge Controls (only when NOT on Direct Cloud) -->
            <div class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);display:flex;flex-direction:column;gap:var(--sp-sm)">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <div style="font-weight:var(--fw-bold);font-size:var(--fs-xs);text-transform:uppercase;color:var(--muted);letter-spacing:0.5px">Hardware Bridge Controls</div>
                <span style="font-size:10px;font-weight:var(--fw-bold);padding:2px 8px;border-radius:12px;background:${t.bridge_online?"#dcfce7":"#fee2e2"};color:${t.bridge_online?"#15803d":"#b91c1c"}">
                  ${t.bridge_online?"BRIDGE ONLINE":"BRIDGE OFFLINE"}
                </span>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-xs)">
                <button class="btn btn-secondary btn-sm" id="btn-reconcile-all" style="font-size:var(--fs-xs);padding:6px 10px">🔄 Re-sync Members</button>
                <button class="btn btn-secondary btn-sm" id="btn-bridge-pairing" style="font-size:var(--fs-xs);padding:6px 10px">🔑 Pairing Code</button>
              </div>
            </div>
            `}

            ${t.adms_integration_id?`
            <!-- Direct Cloud (ADMS) Status -->
            <div class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);display:flex;flex-direction:column;gap:var(--sp-sm)">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <div style="font-weight:var(--fw-bold);font-size:var(--fs-xs);text-transform:uppercase;color:var(--muted);letter-spacing:0.5px">Direct Cloud Terminal</div>
                <span style="font-size:10px;font-weight:var(--fw-bold);padding:2px 8px;border-radius:12px;background:${t.adms_online?"#dcfce7":"#fee2e2"};color:${t.adms_online?"#15803d":"#b91c1c"}">
                  ${t.adms_online?"ONLINE":"OFFLINE"}
                </span>
              </div>
              ${t.adms_device_name?`<div style="font-size:var(--fs-xs);color:var(--muted)">${c(t.adms_device_name)}</div>`:""}
              <p style="font-size:var(--fs-xs);color:var(--muted);margin:0">${t.adms_online?t.adms_commands_enabled?"Terminal polled recently. Membership block/restore commands are enabled.":"Terminal polled recently, but automatic membership commands are not enabled yet.":`No recent terminal poll${t.adms_last_seen_at?` (last seen ${c(T(t.adms_last_seen_at))})`:""}. It cannot receive block/unblock commands until it reconnects.`}</p>
            </div>
            `:""}

            ${t.failed_commands>0?`
              <div class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);background:rgba(245,158,11,0.1);border-color:rgba(245,158,11,0.3);display:flex;align-items:center;justify-content:space-between">
                <div style="font-size:var(--fs-xs);color:#B45309;display:flex;align-items:center;gap:var(--sp-xs)">
                  ${E("alert",16,"#B45309")}
                  <span><strong>${L(t.failed_commands)} command(s)</strong> failed to sync</span>
                </div>
                <div style="display:flex;gap:8px">
                  <button class="btn btn-sm btn-primary" id="btn-retry-sync" style="font-size:var(--fs-xs);padding:4px 10px">Retry All</button>
                  <button class="btn btn-sm" id="btn-clear-failed" style="font-size:var(--fs-xs);padding:4px 10px;background:#FEE2E2;color:#B91C1C;border:1px solid #FECACA">Clear</button>
                </div>
              </div>
            `:""}

            ${t.denied_today>0?`
              <div class="card" id="banner-denied" style="margin-top:var(--sp-md);padding:var(--sp-md);background:var(--critical-surface);border-color:var(--critical-border);display:flex;align-items:center;justify-content:space-between;cursor:pointer">
                <div style="display:flex;align-items:center;gap:var(--sp-sm)">
                  ${E("alert",18,"var(--critical)")}
                  <span style="font-size:var(--fs-sm);font-weight:var(--fw-semibold);color:var(--critical)">${L(t.denied_today)} access denied event${t.denied_today>1?"s":""} today</span>
                </div>
                ${E("forward",14,"var(--critical)")}
              </div>
            `:""}

            ${!t.device_online&&(t.inside_now||0)===0&&(t.entries_today||0)===0?`
              <div style="margin-top:var(--sp-md);padding:var(--sp-sm) var(--sp-md);background:var(--gray-50, #f8f9fa);border:1px dashed var(--border);border-radius:var(--r-md);font-size:var(--fs-xs);color:var(--muted);text-align:center">
                💡 Tip: Tap <b>"+ Check In Member"</b> above to log attendance manually anytime, or connect your biometric turnstile/machine.
              </div>
            `:""}
          </div>

          <!-- Filter Tabs -->
          <div style="display:flex;gap:var(--sp-xs);padding:0 var(--sp-lg) var(--sp-md);overflow-x:auto;-webkit-overflow-scrolling:touch">
            ${[{id:"all",label:"All Events"},{id:"entry",label:"Entries"},{id:"exit",label:"Exits"},{id:"denied",label:"Denied"}].map(e=>`
              <button class="btn btn-sm ${n===e.id?"btn-primary":"btn-secondary"}" data-tab="${e.id}" style="border-radius:var(--r-full);white-space:nowrap;padding:4px 12px;font-size:var(--fs-xs)">
                ${e.label}
              </button>
            `).join("")}
          </div>

          <!-- List Section -->
          ${`
            ${w.length>0?`
              <div class="card" style="margin:0 var(--sp-lg)">
                ${w.map(e=>{const i=(e.event_type||"ENTRY").toUpperCase(),u=i==="ENTRY"||i==="ATTENDANCE",_=i==="ACCESS_DENIED",C=_?"var(--critical-surface)":u?"var(--success-surface)":"var(--gray-100)",D=_?"var(--critical)":u?"var(--success)":"var(--muted)",A=_?"alert":u?"forward":"back",N=_?"expired":u?"active":"info",R=_?"Denied":i==="ATTENDANCE"?"Check In":u?"Entry":"Exit",q=e.biometric_user_id||e.device_enroll_number,M=!e.member_id&&q,P=e.member_id?c(e.member_name||"Unknown"):q?`Unknown · ID ${c(q)}`:"Unknown";return`
                    <div class="list-item" style="cursor:pointer" data-event-member-id="${e.member_id||""}" data-bio-id="${!e.member_id&&q?c(q):""}">
                      <div style="width:34px;height:34px;border-radius:var(--r-full);background:${C};display:flex;align-items:center;justify-content:center;flex-shrink:0">
                        ${E(A,16,D)}
                      </div>
                      <div class="list-item-content">
                        <div class="list-item-title">${P}${M?' <span style="font-size:11px;color:#3b82f6;font-weight:700">· tap to assign</span>':""}</div>
                        <div class="list-item-subtitle">${T(e.event_timestamp||e.timestamp||e.created_at)}${e.device_name?` · ${c(e.device_name)}`:""}</div>
                      </div>
                      <span class="badge badge-${N}">${R}</span>
                    </div>
                  `}).join("")}
              </div>
            `:F({icon:"access",title:"No events",text:"Live access and check-in events will appear here"})}
          `}
        </div>
      `,a.querySelectorAll("[data-tab]").forEach(e=>{e.addEventListener("click",()=>{n=e.dataset.tab,a.innerHTML=z(),r()})}),a.querySelector("#stat-entries")?.addEventListener("click",()=>{n="entry",r()}),a.querySelector("#stat-exits")?.addEventListener("click",()=>{n="exit",r()}),a.querySelector("#banner-denied")?.addEventListener("click",()=>{n="denied",r()});const s=a.querySelector("#btn-remote-unlock");s&&s.addEventListener("click",async()=>{if(!window.confirm("Unlock the gym gate for 5 seconds?"))return;s.disabled=!0,s.textContent="Sending unlock...";const e=await v("/api/mobile/v1/access/remote-unlock",{method:"POST",body:{delay_seconds:5,confirm:!0}});e.ok?l(e.data?.message||"Unlock command queued. Waiting for terminal acknowledgement.","success"):l(e.error?.message||"Could not unlock door","error"),s.disabled=!1,s.textContent="🔓 Unlock Gate"});const y=a.querySelector("#btn-reconcile-all");y&&y.addEventListener("click",async()=>{y.disabled=!0,y.textContent="Syncing...";const e=await v("/api/mobile/v1/access/reconcile",{method:"POST"});e.ok?(l(e.data?.message||"Re-sync queued for device","success"),await r()):l(e.error?.message||"Re-sync failed","error"),y.disabled=!1,y.textContent="🔄 Re-sync Members"});const $=a.querySelector("#btn-bridge-pairing");$&&$.addEventListener("click",async()=>{$.disabled=!0;const e=await v("/api/mobile/v1/settings/bridge/pairing-code",{method:"POST"});$.disabled=!1,e.ok&&e.data?.pairing_code?await U({title:"Bridge Pairing Code",message:`Your 6-digit pairing code is:

${e.data.pairing_code}

Valid for 10 minutes. Enter this code into RenewalDeskConnector.exe on your gym PC to connect.`,confirmText:"Done"}):l(e.error?.message||"Could not generate pairing code","error")}),a.querySelector("#btn-retry-sync")?.addEventListener("click",async()=>{const e=a.querySelector("#btn-retry-sync");e&&(e.disabled=!0);const i=await v("/api/mobile/v1/access/retry-sync",{method:"POST"});i.ok?(l(i.data?.message||"Commands queued for retry","success"),await r()):(l(i.error?.message||"Could not retry syncs","error"),e&&(e.disabled=!1))}),a.querySelector("#btn-clear-failed")?.addEventListener("click",async()=>{if(!confirm("Permanently delete all failed biometric commands? This cannot be undone."))return;const e=a.querySelector("#btn-clear-failed");e&&(e.disabled=!0);const i=await v("/api/mobile/v1/access/clear-failed",{method:"POST"});i.ok?(l(i.data?.message||"Failed commands cleared","success"),await r()):(l(i.error?.message||"Could not clear commands","error"),e&&(e.disabled=!1))}),a.querySelectorAll("[data-member-link]").forEach(e=>{e.addEventListener("click",()=>{const i=e.dataset.memberLink;i&&S.push("member-detail",{memberId:i})})}),a.querySelectorAll("[data-event-member-id]").forEach(e=>{e.addEventListener("click",()=>{const i=e.dataset.eventMemberId,u=e.dataset.bioId;i?S.push("member-detail",{memberId:i}):u&&Y(u)})}),a.querySelectorAll("[data-checkout-id]").forEach(e=>{e.addEventListener("click",async i=>{i.stopPropagation();const u=e.dataset.checkoutId,_=e.dataset.checkoutName;e.disabled=!0,e.textContent="Checking out...";const C=await I(u,"EXIT");C.ok?(l(`${_} checked out`,"success"),await r()):(l(C.error?.message||"Check-out failed","error"),e.disabled=!1,e.textContent="Check Out")})})}function k(){const d=document.createElement("div");d.className="modal-overlay center",d.innerHTML=`
        <div class="confirm-dialog" style="max-width:440px;width:90%;max-height:85vh;display:flex;flex-direction:column;padding:var(--sp-lg)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-md)">
            <div style="font-weight:var(--fw-bold);font-size:var(--fs-lg)">Manual Check In</div>
            <button id="modal-close" style="background:none;border:none;cursor:pointer;padding:4px">${E("close",20,"var(--muted)")}</button>
          </div>
          <div style="margin-bottom:var(--sp-md)">
            <input type="text" id="checkin-search" class="form-input" placeholder="Search member by name or phone..." style="width:100%" autofocus />
          </div>
          <div id="checkin-members-list" style="overflow-y:auto;max-height:50vh;display:flex;flex-direction:column;gap:var(--sp-xs)">
            <div style="text-align:center;padding:var(--sp-lg);color:var(--muted)">Loading active members...</div>
          </div>
        </div>
      `,document.body.appendChild(d),d.querySelector("#modal-close").onclick=()=>d.remove(),d.onclick=o=>{o.target===d&&d.remove()};const a=d.querySelector("#checkin-search"),b=d.querySelector("#checkin-members-list");let p=null;async function m(o=""){const t=`/api/mobile/v1/members?page_size=20${o?`&q=${encodeURIComponent(o)}`:"&status=active"}`,w=await v(t);if(!w.ok){b.innerHTML='<div style="text-align:center;padding:var(--sp-md);color:var(--critical)">Failed to load members</div>';return}const g=w.data?.members||[];if(g.length===0){b.innerHTML=`<div style="text-align:center;padding:var(--sp-lg);color:var(--muted)">No members found matching "${c(o)}"</div>`;return}b.innerHTML=g.map(s=>`
          <div class="card card-body" style="padding:var(--sp-sm) var(--sp-md);display:flex;align-items:center;justify-content:space-between;gap:var(--sp-sm)">
            <div style="display:flex;align-items:center;gap:var(--sp-sm);min-width:0;flex:1">
              ${G(s.full_name||"Member","sm")}
              <div style="min-width:0">
                <div style="font-weight:var(--fw-semibold);font-size:var(--fs-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c(s.full_name)}</div>
                <div style="font-size:var(--fs-xs);color:var(--muted)">${c(s.phone||"")}${s.plan?` · ${c(s.plan.name)}`:""}</div>
              </div>
            </div>
            <button class="btn btn-primary btn-sm btn-do-checkin" data-mid="${s.id}" data-mname="${c(s.full_name)}" style="border-radius:var(--r-full);padding:4px 12px;font-size:var(--fs-xs);flex-shrink:0">
              Check In
            </button>
          </div>
        `).join(""),b.querySelectorAll(".btn-do-checkin").forEach(s=>{s.addEventListener("click",async()=>{const y=s.dataset.mid,$=s.dataset.mname;s.disabled=!0,s.textContent="Checking in...";const e=await I(y,"ENTRY");e.ok?(l(`${$} checked in successfully!`,"success"),d.remove(),await r()):(l(e.error?.message||"Check-in failed","error"),s.disabled=!1,s.textContent="Check In")})})}a.addEventListener("input",o=>{clearTimeout(p),p=setTimeout(()=>{m(o.target.value.trim())},300)}),m()}f.innerHTML=`
      ${B({title:"Live Access",showBack:H.depth>1,actions:[{icon:"access",label:"Check In",onClick:()=>k()},{icon:"refresh",label:"Refresh",onClick:()=>r()}]})}
      <div class="scroll-view" id="ac-scroll">${z()}</div>
    `,j(f,{onBack:()=>{S.pop()},actions:[{icon:"access",onClick:()=>k()},{icon:"refresh",onClick:()=>r()}]}),await r(),O(f,r,15e3),window.__refreshAccess=()=>{document.body.contains(f)&&r()}},async unmount(){window.__refreshAccess=null}};async function Y(f){const n=document.createElement("div");n.id="quick-assign-overlay",n.innerHTML=`
    <div class="qa-sheet">
      <div class="qa-handle"></div>
      <h3>Who is biometric ID ${c(f)}?</h3>
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
    </style>`,document.body.appendChild(n);const x=()=>n.remove();n.addEventListener("click",p=>{p.target===n&&x()}),n.querySelector("#qa-close").addEventListener("click",x);let h=[];const r=n.querySelector("#qa-results"),k=n.querySelector("#qa-search"),d=p=>{const m=(p||"").toLowerCase().trim(),o=m?h.filter(t=>t.full_name.toLowerCase().includes(m)||(t.phone||"").includes(m)).slice(0,30):h.slice(0,30);r.innerHTML=o.length?o.map(t=>`<div class="qa-row" data-qa-pick="${t.id}"><b>${c(t.full_name)}</b>${t.phone?`<span>${c(t.phone)}</span>`:""}</div>`).join(""):'<div class="qa-empty">No members found</div>',r.querySelectorAll("[data-qa-pick]").forEach(t=>{t.addEventListener("click",async()=>{const w=Number(t.dataset.qaPick);t.style.background="#dcfce7";const g=await v("/api/mobile/v1/rrr/mappings/bulk-resolve",{method:"POST",body:{mappings:[{external_id:f,member_id:w}]}});g.ok&&g.data.linked===1?(l(`ID ${f} linked ✓`),x(),window.__refreshAccess&&window.__refreshAccess()):(l("Link failed — try again"),t.style.background="")})})};let a;k.addEventListener("input",()=>{clearTimeout(a),a=setTimeout(async()=>{const p=k.value.trim(),m=await v(`/api/mobile/v1/members?page=1&page_size=30${p?`&q=${encodeURIComponent(p)}`:""}`);h=m.ok?m.data.members||[]:[],d(k.value)},300)});const b=await v("/api/mobile/v1/members?page=1&page_size=30");h=b.ok?b.data.members||[]:[],d(""),k.focus()}export{Q as default};
