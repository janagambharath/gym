import{a as B,A as j,q as I,b as P,f as v,F as C,g as r,j as x,i as b,v as z,s as d,n as L,P as q,B as M}from"./index-BBvTqkkK.js";const O={async mount(k){let o="all",S=null,w=null;async function n(){const a=k.querySelector("#ac-scroll");if(!a)return;const T=v("/api/mobile/v1/access/summary"),f=o==="inside"?v("/api/mobile/v1/access/inside?per_page=50"):v(`/api/mobile/v1/access/events?per_page=25${o==="all"?"":`&type=${o}`}`),[y,l]=await Promise.all([T,f]),t=y.ok?y.data:S||{};S=t;const $=l.ok?l.data?.events||l.data?.log||[]:[],g=l.ok?l.data?.members||[]:[],h=t.last_event_at?C(t.last_event_at):t.last_heartbeat?`Heartbeat: ${C(t.last_heartbeat)}`:"";a.innerHTML=`
        <div class="scroll-content">
          <!-- Summary Card -->
          <div style="padding:var(--sp-lg)">
            <div class="card card-body" style="text-align:center">
              <div style="display:flex;align-items:center;justify-content:center;gap:var(--sp-sm);margin-bottom:var(--sp-sm)">
                <span style="width:10px;height:10px;border-radius:50%;background:${t.device_online?"var(--success)":"var(--muted)"}"></span>
                <span style="font-weight:var(--fw-bold);font-size:var(--fs-base)">${t.device_online?"Biometric Device Online":"Biometric Device Offline"}</span>
                ${t.device_name?`<span style="font-size:var(--fs-xs);color:var(--muted)">· ${r(t.device_name)}</span>`:""}
              </div>
              ${h?`<div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:var(--sp-md)">Last event: ${r(h)}</div>`:'<div style="margin-bottom:var(--sp-md)"></div>'}
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-lg)">
                <div style="cursor:pointer" id="stat-inside">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--status-active)">${x(t.inside_now||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Inside Now</div>
                </div>
                <div style="cursor:pointer" id="stat-entries">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--brand)">${x(t.entries_today||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Entries</div>
                </div>
                <div style="cursor:pointer" id="stat-exits">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--warning)">${x(t.exits_today||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Exits</div>
                </div>
              </div>

              <!-- Attendance & Remote Physical Gate Control -->
              <div style="margin-top:var(--sp-lg);padding-top:var(--sp-md);border-top:1px solid var(--border);display:grid;grid-template-columns:${t.remote_unlock_available?"1fr 1fr":"1fr"};gap:var(--sp-sm)">
                <button class="btn btn-primary" id="btn-open-checkin" style="font-weight:var(--fw-semibold);display:flex;align-items:center;justify-content:center;gap:var(--sp-xs);font-size:var(--fs-xs)">
                  ${b("access",16,"white")} + Check In
                </button>
                ${t.remote_unlock_available?`
                  <button class="btn" id="btn-remote-unlock" style="font-weight:var(--fw-semibold);display:flex;align-items:center;justify-content:center;gap:var(--sp-xs);font-size:var(--fs-xs);background:#16a34a;color:white;border:none">
                    🔓 Unlock Gate
                  </button>
                `:""}
              </div>
              ${t.remote_unlock_available?"":`<p style="margin:var(--sp-sm) 0 0;font-size:var(--fs-xs);color:var(--muted)">${r(t.remote_unlock_reason||"Bridge PC is offline. Open RenewalDeskConnector on gym PC to enable remote unlock.")}</p>`}
            </div>

            <!-- Hardware Bridge Controls -->
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

            ${t.failed_commands>0?`
              <div class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);background:rgba(245,158,11,0.1);border-color:rgba(245,158,11,0.3);display:flex;align-items:center;justify-content:space-between">
                <div style="font-size:var(--fs-xs);color:#B45309;display:flex;align-items:center;gap:var(--sp-xs)">
                  ${b("alert",16,"#B45309")}
                  <span><strong>${x(t.failed_commands)} command(s)</strong> failed to sync</span>
                </div>
                <button class="btn btn-sm btn-primary" id="btn-retry-sync" style="font-size:var(--fs-xs);padding:4px 10px">Retry All</button>
              </div>
            `:""}

            ${t.denied_today>0?`
              <div class="card" id="banner-denied" style="margin-top:var(--sp-md);padding:var(--sp-md);background:var(--critical-surface);border-color:var(--critical-border);display:flex;align-items:center;justify-content:space-between;cursor:pointer">
                <div style="display:flex;align-items:center;gap:var(--sp-sm)">
                  ${b("alert",18,"var(--critical)")}
                  <span style="font-size:var(--fs-sm);font-weight:var(--fw-semibold);color:var(--critical)">${x(t.denied_today)} access denied event${t.denied_today>1?"s":""} today</span>
                </div>
                ${b("forward",14,"var(--critical)")}
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
            ${[{id:"all",label:"All Events"},{id:"inside",label:`Inside (${t.inside_now||0})`},{id:"entry",label:`Entries (${t.entries_today||0})`},{id:"exit",label:`Exits (${t.exits_today||0})`},{id:"denied",label:`Denied (${t.denied_today||0})`}].map(e=>`
              <button class="btn btn-sm ${o===e.id?"btn-primary":"btn-secondary"}" data-tab="${e.id}" style="border-radius:var(--r-full);white-space:nowrap;padding:4px 12px;font-size:var(--fs-xs)">
                ${e.label}
              </button>
            `).join("")}
          </div>

          <!-- List Section -->
          ${o==="inside"?`
            ${g.length>0?`
              <div class="card" style="margin:0 var(--sp-lg)">
                ${g.map(e=>`
                  <div class="list-item" style="display:flex;align-items:center;justify-content:space-between;gap:var(--sp-sm)">
                    <div style="display:flex;align-items:center;gap:var(--sp-sm);cursor:pointer;flex:1;min-width:0" data-member-link="${e.id}">
                      ${M(e.full_name||"Member","md")}
                      <div class="list-item-content" style="min-width:0">
                        <div class="list-item-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r(e.full_name||"Member")}</div>
                        <div class="list-item-subtitle">${e.phone?r(e.phone)+" · ":""}In ${e.entered_at?C(e.entered_at):"recently"}</div>
                      </div>
                    </div>
                    <button class="btn btn-outline btn-sm btn-checkout" data-checkout-id="${e.id}" data-checkout-name="${r(e.full_name||"Member")}" style="padding:4px 10px;font-size:var(--fs-xs);border-radius:var(--r-full);flex-shrink:0">
                      Check Out
                    </button>
                  </div>
                `).join("")}
              </div>
            `:z({icon:"access",title:"No members inside",text:"Members currently inside the gym will appear here when checked in"})}
          `:`
            ${$.length>0?`
              <div class="card" style="margin:0 var(--sp-lg)">
                ${$.map(e=>{const i=(e.event_type||"ENTRY").toUpperCase(),m=i==="ENTRY"||i==="ATTENDANCE",p=i==="ACCESS_DENIED",_=p?"var(--critical-surface)":m?"var(--success-surface)":"var(--gray-100)",R=p?"var(--critical)":m?"var(--success)":"var(--muted)",D=p?"alert":m?"forward":"back",N=p?"expired":m?"active":"info",A=p?"Denied":i==="ATTENDANCE"?"Check In":m?"Entry":"Exit";return`
                    <div class="list-item" style="cursor:pointer" data-event-member-id="${e.member_id||""}">
                      <div style="width:34px;height:34px;border-radius:var(--r-full);background:${_};display:flex;align-items:center;justify-content:center;flex-shrink:0">
                        ${b(D,16,R)}
                      </div>
                      <div class="list-item-content">
                        <div class="list-item-title">${r(e.member_name||"Unknown")}</div>
                        <div class="list-item-subtitle">${C(e.event_timestamp||e.timestamp||e.created_at)}${e.device_name?` · ${r(e.device_name)}`:""}</div>
                      </div>
                      <span class="badge badge-${N}">${A}</span>
                    </div>
                  `}).join("")}
              </div>
            `:z({icon:"access",title:"No events",text:"Live access and check-in events will appear here"})}
          `}
        </div>
      `,a.querySelectorAll("[data-tab]").forEach(e=>{e.addEventListener("click",()=>{o=e.dataset.tab,a.innerHTML=I(),n()})}),a.querySelector("#stat-inside")?.addEventListener("click",()=>{o="inside",n()}),a.querySelector("#stat-entries")?.addEventListener("click",()=>{o="entry",n()}),a.querySelector("#stat-exits")?.addEventListener("click",()=>{o="exit",n()}),a.querySelector("#banner-denied")?.addEventListener("click",()=>{o="denied",n()}),a.querySelector("#btn-open-checkin")?.addEventListener("click",()=>E());const s=a.querySelector("#btn-remote-unlock");s&&s.addEventListener("click",async()=>{s.disabled=!0,s.textContent="Unlocking...";const e=await v("/api/mobile/v1/access/remote-unlock",{method:"POST",body:{delay_seconds:5}});e.ok?d("🔓 Turnstile / Door unlocked for 5s!","success"):d(e.error?.message||"Could not unlock door","error"),s.disabled=!1,s.textContent="🔓 Unlock Gate"});const c=a.querySelector("#btn-reconcile-all");c&&c.addEventListener("click",async()=>{c.disabled=!0,c.textContent="Syncing...";const e=await v("/api/mobile/v1/access/reconcile",{method:"POST"});e.ok?(d(e.data?.message||"Re-sync queued for device","success"),await n()):d(e.error?.message||"Re-sync failed","error"),c.disabled=!1,c.textContent="🔄 Re-sync Members"});const u=a.querySelector("#btn-bridge-pairing");u&&u.addEventListener("click",async()=>{u.disabled=!0;const e=await v("/api/mobile/v1/settings/bridge/pairing-code",{method:"POST"});u.disabled=!1,e.ok&&e.data?.pairing_code?await showConfirm({title:"Bridge Pairing Code",message:`Your 6-digit pairing code is:

${e.data.pairing_code}

Valid for 10 minutes. Enter this code into RenewalDeskConnector.exe on your gym PC to connect.`,confirmText:"Done"}):d(e.error?.message||"Could not generate pairing code","error")}),a.querySelector("#btn-retry-sync")?.addEventListener("click",async()=>{const e=a.querySelector("#btn-retry-sync");e&&(e.disabled=!0);const i=await v("/api/mobile/v1/access/retry-sync",{method:"POST"});i.ok?(d(i.data?.message||"Commands queued for retry","success"),await n()):(d(i.error?.message||"Could not retry syncs","error"),e&&(e.disabled=!1))}),a.querySelectorAll("[data-member-link]").forEach(e=>{e.addEventListener("click",()=>{const i=e.dataset.memberLink;i&&L.push("member-detail",{memberId:i})})}),a.querySelectorAll("[data-event-member-id]").forEach(e=>{e.addEventListener("click",()=>{const i=e.dataset.eventMemberId;i&&L.push("member-detail",{memberId:i})})}),a.querySelectorAll("[data-checkout-id]").forEach(e=>{e.addEventListener("click",async i=>{i.stopPropagation();const m=e.dataset.checkoutId,p=e.dataset.checkoutName;e.disabled=!0,e.textContent="Checking out...";const _=await q(m,"EXIT");_.ok?(d(`${p} checked out`,"success"),await n()):(d(_.error?.message||"Check-out failed","error"),e.disabled=!1,e.textContent="Check Out")})})}function E(){const a=document.createElement("div");a.className="modal-overlay center",a.innerHTML=`
        <div class="confirm-dialog" style="max-width:440px;width:90%;max-height:85vh;display:flex;flex-direction:column;padding:var(--sp-lg)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-md)">
            <div style="font-weight:var(--fw-bold);font-size:var(--fs-lg)">Manual Check In</div>
            <button id="modal-close" style="background:none;border:none;cursor:pointer;padding:4px">${b("close",20,"var(--muted)")}</button>
          </div>
          <div style="margin-bottom:var(--sp-md)">
            <input type="text" id="checkin-search" class="form-input" placeholder="Search member by name or phone..." style="width:100%" autofocus />
          </div>
          <div id="checkin-members-list" style="overflow-y:auto;max-height:50vh;display:flex;flex-direction:column;gap:var(--sp-xs)">
            <div style="text-align:center;padding:var(--sp-lg);color:var(--muted)">Loading active members...</div>
          </div>
        </div>
      `,document.body.appendChild(a),a.querySelector("#modal-close").onclick=()=>a.remove(),a.onclick=t=>{t.target===a&&a.remove()};const T=a.querySelector("#checkin-search"),f=a.querySelector("#checkin-members-list");let y=null;async function l(t=""){const $=`/api/mobile/v1/members?per_page=20${t?`&search=${encodeURIComponent(t)}`:"&status=active"}`,g=await v($);if(!g.ok){f.innerHTML='<div style="text-align:center;padding:var(--sp-md);color:var(--critical)">Failed to load members</div>';return}const h=g.data?.members||[];if(h.length===0){f.innerHTML=`<div style="text-align:center;padding:var(--sp-lg);color:var(--muted)">No members found matching "${r(t)}"</div>`;return}f.innerHTML=h.map(s=>`
          <div class="card card-body" style="padding:var(--sp-sm) var(--sp-md);display:flex;align-items:center;justify-content:space-between;gap:var(--sp-sm)">
            <div style="display:flex;align-items:center;gap:var(--sp-sm);min-width:0;flex:1">
              ${M(s.full_name||"Member","sm")}
              <div style="min-width:0">
                <div style="font-weight:var(--fw-semibold);font-size:var(--fs-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r(s.full_name)}</div>
                <div style="font-size:var(--fs-xs);color:var(--muted)">${r(s.phone||"")}${s.plan?` · ${r(s.plan.name)}`:""}</div>
              </div>
            </div>
            <button class="btn btn-primary btn-sm btn-do-checkin" data-mid="${s.id}" data-mname="${r(s.full_name)}" style="border-radius:var(--r-full);padding:4px 12px;font-size:var(--fs-xs);flex-shrink:0">
              Check In
            </button>
          </div>
        `).join(""),f.querySelectorAll(".btn-do-checkin").forEach(s=>{s.addEventListener("click",async()=>{const c=s.dataset.mid,u=s.dataset.mname;s.disabled=!0,s.textContent="Checking in...";const e=await q(c,"ENTRY");e.ok?(d(`${u} checked in successfully!`,"success"),a.remove(),await n()):(d(e.error?.message||"Check-in failed","error"),s.disabled=!1,s.textContent="Check In")})})}T.addEventListener("input",t=>{clearTimeout(y),y=setTimeout(()=>{l(t.target.value.trim())},300)}),l()}k.innerHTML=`
      ${B({title:"Live Access",showBack:j.depth>1,actions:[{icon:"access",label:"Check In",onClick:()=>E()},{icon:"refresh",label:"Refresh",onClick:()=>n()}]})}
      <div class="scroll-view" id="ac-scroll">${I()}</div>
    `,P(k,{onBack:()=>{w&&clearInterval(w),L.pop()},actions:[{icon:"access",onClick:()=>E()},{icon:"refresh",onClick:()=>n()}]}),await n(),w=setInterval(()=>{document.body.contains(k)?n():clearInterval(w)},15e3)}};export{O as default};
