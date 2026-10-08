import{a as H,C as T,o as L,b as j,e as p,H as w,f as n,g as b,i as o,t as S,s as v,n as $,N as M,y as q}from"./index-CIoZzya4.js";const R={async mount(g){let r="all",C=null,h=null;async function i(){const a=g.querySelector("#ac-scroll");if(!a)return;const E=p("/api/mobile/v1/access/summary"),m=r==="inside"?p("/api/mobile/v1/access/inside?per_page=50"):p(`/api/mobile/v1/access/events?per_page=25${r==="all"?"":`&type=${r}`}`),[u,c]=await Promise.all([E,m]),t=u.ok?u.data:C||{};C=t;const x=c.ok?c.data?.events||c.data?.log||[]:[],f=c.ok?c.data?.members||[]:[],y=t.last_event_at?w(t.last_event_at):t.last_heartbeat?`Heartbeat: ${w(t.last_heartbeat)}`:"";a.innerHTML=`
        <div class="scroll-content">
          <!-- Summary Card -->
          <div style="padding:var(--sp-lg)">
            <div class="card card-body" style="text-align:center">
              <div style="display:flex;align-items:center;justify-content:center;gap:var(--sp-sm);margin-bottom:var(--sp-sm)">
                <span style="width:10px;height:10px;border-radius:50%;background:${t.device_online?"var(--success)":"var(--muted)"}"></span>
                <span style="font-weight:var(--fw-bold);font-size:var(--fs-base)">${t.device_online?"Biometric Device Online":"Biometric Device Offline"}</span>
                ${t.device_name?`<span style="font-size:var(--fs-xs);color:var(--muted)">· ${n(t.device_name)}</span>`:""}
              </div>
              ${y?`<div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:var(--sp-md)">Last event: ${n(y)}</div>`:'<div style="margin-bottom:var(--sp-md)"></div>'}
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-lg)">
                <div style="cursor:pointer" id="stat-inside">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--status-active)">${b(t.inside_now||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Inside Now</div>
                </div>
                <div style="cursor:pointer" id="stat-entries">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--brand)">${b(t.entries_today||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Entries</div>
                </div>
                <div style="cursor:pointer" id="stat-exits">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--warning)">${b(t.exits_today||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Exits</div>
                </div>
              </div>

              <!-- Quick Gate Control & Attendance CTA Buttons -->
              <div style="margin-top:var(--sp-lg);padding-top:var(--sp-md);border-top:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-sm)">
                <button class="btn btn-primary" id="btn-open-checkin" style="font-weight:var(--fw-semibold);display:flex;align-items:center;justify-content:center;gap:var(--sp-xs);font-size:var(--fs-xs)">
                  ${o("access",16,"white")} + Check In
                </button>
                <button class="btn btn-secondary" id="btn-quick-unlock" style="font-weight:var(--fw-semibold);display:flex;align-items:center;justify-content:center;gap:var(--sp-xs);font-size:var(--fs-xs);background:rgba(16,185,129,0.1);color:#059669;border-color:rgba(16,185,129,0.3)">
                  ${o("lock",16)} Open Gate (5s)
                </button>
              </div>
            </div>

            ${t.failed_commands>0?`
              <div class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);background:rgba(245,158,11,0.1);border-color:rgba(245,158,11,0.3);display:flex;align-items:center;justify-content:space-between">
                <div style="font-size:var(--fs-xs);color:#B45309;display:flex;align-items:center;gap:var(--sp-xs)">
                  ${o("alert",16,"#B45309")}
                  <span><strong>${b(t.failed_commands)} command(s)</strong> failed to sync</span>
                </div>
                <button class="btn btn-sm btn-primary" id="btn-retry-sync" style="font-size:var(--fs-xs);padding:4px 10px">Retry All</button>
              </div>
            `:""}

            ${t.denied_today>0?`
              <div class="card" id="banner-denied" style="margin-top:var(--sp-md);padding:var(--sp-md);background:var(--critical-surface);border-color:var(--critical-border);display:flex;align-items:center;justify-content:space-between;cursor:pointer">
                <div style="display:flex;align-items:center;gap:var(--sp-sm)">
                  ${o("alert",18,"var(--critical)")}
                  <span style="font-size:var(--fs-sm);font-weight:var(--fw-semibold);color:var(--critical)">${b(t.denied_today)} access denied event${t.denied_today>1?"s":""} today</span>
                </div>
                ${o("forward",14,"var(--critical)")}
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
              <button class="btn btn-sm ${r===e.id?"btn-primary":"btn-secondary"}" data-tab="${e.id}" style="border-radius:var(--r-full);white-space:nowrap;padding:4px 12px;font-size:var(--fs-xs)">
                ${e.label}
              </button>
            `).join("")}
          </div>

          <!-- List Section -->
          ${r==="inside"?`
            ${f.length>0?`
              <div class="card" style="margin:0 var(--sp-lg)">
                ${f.map(e=>`
                  <div class="list-item" style="display:flex;align-items:center;justify-content:space-between;gap:var(--sp-sm)">
                    <div style="display:flex;align-items:center;gap:var(--sp-sm);cursor:pointer;flex:1;min-width:0" data-member-link="${e.id}">
                      ${q(e.full_name||"Member","md")}
                      <div class="list-item-content" style="min-width:0">
                        <div class="list-item-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${n(e.full_name||"Member")}</div>
                        <div class="list-item-subtitle">${e.phone?n(e.phone)+" · ":""}In ${e.entered_at?w(e.entered_at):"recently"}</div>
                      </div>
                    </div>
                    <button class="btn btn-outline btn-sm btn-checkout" data-checkout-id="${e.id}" data-checkout-name="${n(e.full_name||"Member")}" style="padding:4px 10px;font-size:var(--fs-xs);border-radius:var(--r-full);flex-shrink:0">
                      Check Out
                    </button>
                  </div>
                `).join("")}
              </div>
            `:S({icon:"access",title:"No members inside",text:"Members currently inside the gym will appear here when checked in"})}
          `:`
            ${x.length>0?`
              <div class="card" style="margin:0 var(--sp-lg)">
                ${x.map(e=>{const s=(e.event_type||"ENTRY").toUpperCase(),l=s==="ENTRY"||s==="ATTENDANCE",d=s==="ACCESS_DENIED",k=d?"var(--critical-surface)":l?"var(--success-surface)":"var(--gray-100)",z=d?"var(--critical)":l?"var(--success)":"var(--muted)",I=d?"alert":l?"forward":"back",A=d?"expired":l?"active":"info",N=d?"Denied":s==="ATTENDANCE"?"Check In":l?"Entry":"Exit";return`
                    <div class="list-item" style="cursor:pointer" data-event-member-id="${e.member_id||""}">
                      <div style="width:34px;height:34px;border-radius:var(--r-full);background:${k};display:flex;align-items:center;justify-content:center;flex-shrink:0">
                        ${o(I,16,z)}
                      </div>
                      <div class="list-item-content">
                        <div class="list-item-title">${n(e.member_name||"Unknown")}</div>
                        <div class="list-item-subtitle">${w(e.event_timestamp||e.timestamp||e.created_at)}${e.device_name?` · ${n(e.device_name)}`:""}</div>
                      </div>
                      <span class="badge badge-${A}">${N}</span>
                    </div>
                  `}).join("")}
              </div>
            `:S({icon:"access",title:"No events",text:"Live access and check-in events will appear here"})}
          `}
        </div>
      `,a.querySelectorAll("[data-tab]").forEach(e=>{e.addEventListener("click",()=>{r=e.dataset.tab,a.innerHTML=L(),i()})}),a.querySelector("#stat-inside")?.addEventListener("click",()=>{r="inside",i()}),a.querySelector("#stat-entries")?.addEventListener("click",()=>{r="entry",i()}),a.querySelector("#stat-exits")?.addEventListener("click",()=>{r="exit",i()}),a.querySelector("#banner-denied")?.addEventListener("click",()=>{r="denied",i()}),a.querySelector("#btn-open-checkin")?.addEventListener("click",()=>_()),a.querySelector("#btn-quick-unlock")?.addEventListener("click",async()=>{const e=a.querySelector("#btn-quick-unlock");e&&(e.disabled=!0,e.innerHTML=`${o("lock",16)} Unlocking (5s)...`);const s=await p("/api/mobile/v1/access/remote-unlock",{method:"POST",body:{pulse_seconds:5}});s.ok?(v("Turnstile gate unlocked for 5 seconds!","success"),setTimeout(()=>{e&&(e.disabled=!1,e.innerHTML=`${o("lock",16)} Open Gate (5s)`)},5e3),await i()):(v(s.error?.message||"Remote unlock failed","error"),e&&(e.disabled=!1,e.innerHTML=`${o("lock",16)} Open Gate (5s)`))}),a.querySelector("#btn-retry-sync")?.addEventListener("click",async()=>{const e=a.querySelector("#btn-retry-sync");e&&(e.disabled=!0);const s=await p("/api/mobile/v1/access/retry-sync",{method:"POST"});s.ok?(v(s.data?.message||"Commands queued for retry","success"),await i()):(v(s.error?.message||"Could not retry syncs","error"),e&&(e.disabled=!1))}),a.querySelectorAll("[data-member-link]").forEach(e=>{e.addEventListener("click",()=>{const s=e.dataset.memberLink;s&&$.push("member-detail",{id:s})})}),a.querySelectorAll("[data-event-member-id]").forEach(e=>{e.addEventListener("click",()=>{const s=e.dataset.eventMemberId;s&&$.push("member-detail",{id:s})})}),a.querySelectorAll("[data-checkout-id]").forEach(e=>{e.addEventListener("click",async s=>{s.stopPropagation();const l=e.dataset.checkoutId,d=e.dataset.checkoutName;e.disabled=!0,e.textContent="Checking out...";const k=await M(l,"EXIT");k.ok?(v(`${d} checked out`,"success"),await i()):(v(k.error?.message||"Check-out failed","error"),e.disabled=!1,e.textContent="Check Out")})})}function _(){const a=document.createElement("div");a.className="modal-overlay center",a.innerHTML=`
        <div class="confirm-dialog" style="max-width:440px;width:90%;max-height:85vh;display:flex;flex-direction:column;padding:var(--sp-lg)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-md)">
            <div style="font-weight:var(--fw-bold);font-size:var(--fs-lg)">Manual Check In</div>
            <button id="modal-close" style="background:none;border:none;cursor:pointer;padding:4px">${o("close",20,"var(--muted)")}</button>
          </div>
          <div style="margin-bottom:var(--sp-md)">
            <input type="text" id="checkin-search" class="form-input" placeholder="Search member by name or phone..." style="width:100%" autofocus />
          </div>
          <div id="checkin-members-list" style="overflow-y:auto;max-height:50vh;display:flex;flex-direction:column;gap:var(--sp-xs)">
            <div style="text-align:center;padding:var(--sp-lg);color:var(--muted)">Loading active members...</div>
          </div>
        </div>
      `,document.body.appendChild(a),a.querySelector("#modal-close").onclick=()=>a.remove(),a.onclick=t=>{t.target===a&&a.remove()};const E=a.querySelector("#checkin-search"),m=a.querySelector("#checkin-members-list");let u=null;async function c(t=""){const x=`/api/mobile/v1/members?per_page=20${t?`&search=${encodeURIComponent(t)}`:"&status=active"}`,f=await p(x);if(!f.ok){m.innerHTML='<div style="text-align:center;padding:var(--sp-md);color:var(--critical)">Failed to load members</div>';return}const y=f.data?.members||[];if(y.length===0){m.innerHTML=`<div style="text-align:center;padding:var(--sp-lg);color:var(--muted)">No members found matching "${n(t)}"</div>`;return}m.innerHTML=y.map(e=>`
          <div class="card card-body" style="padding:var(--sp-sm) var(--sp-md);display:flex;align-items:center;justify-content:space-between;gap:var(--sp-sm)">
            <div style="display:flex;align-items:center;gap:var(--sp-sm);min-width:0;flex:1">
              ${q(e.full_name||"Member","sm")}
              <div style="min-width:0">
                <div style="font-weight:var(--fw-semibold);font-size:var(--fs-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${n(e.full_name)}</div>
                <div style="font-size:var(--fs-xs);color:var(--muted)">${n(e.phone||"")}${e.plan?` · ${n(e.plan.name)}`:""}</div>
              </div>
            </div>
            <button class="btn btn-primary btn-sm btn-do-checkin" data-mid="${e.id}" data-mname="${n(e.full_name)}" style="border-radius:var(--r-full);padding:4px 12px;font-size:var(--fs-xs);flex-shrink:0">
              Check In
            </button>
          </div>
        `).join(""),m.querySelectorAll(".btn-do-checkin").forEach(e=>{e.addEventListener("click",async()=>{const s=e.dataset.mid,l=e.dataset.mname;e.disabled=!0,e.textContent="Checking in...";const d=await M(s,"ENTRY");d.ok?(v(`${l} checked in successfully!`,"success"),a.remove(),await i()):(v(d.error?.message||"Check-in failed","error"),e.disabled=!1,e.textContent="Check In")})})}E.addEventListener("input",t=>{clearTimeout(u),u=setTimeout(()=>{c(t.target.value.trim())},300)}),c()}g.innerHTML=`
      ${H({title:"Live Access",showBack:T.depth>1,actions:[{icon:"access",label:"Check In",onClick:()=>_()},{icon:"refresh",label:"Refresh",onClick:()=>i()}]})}
      <div class="scroll-view" id="ac-scroll">${L()}</div>
    `,j(g,{onBack:()=>{h&&clearInterval(h),T.depth>1?$.pop():$.switchTab("dashboard")},actions:[{icon:"access",onClick:()=>_()},{icon:"refresh",onClick:()=>i()}]}),await i(),h=setInterval(()=>{document.body.contains(g)?i():clearInterval(h)},15e3)}};export{R as default};
