import{a as q,z as T,b as D,k as g,N as x,e as s,u as k,i as u,A as L,n as E,Q as I,s as $,f as M}from"./index-BxLO4bma.js";const H={async mount(f){let r="all",C=null,y=null;async function n(){const a=f.querySelector("#ac-scroll");if(!a)return;const _=g("/api/mobile/v1/access/summary"),c=r==="inside"?g("/api/mobile/v1/access/inside?per_page=50"):g(`/api/mobile/v1/access/events?per_page=25${r==="all"?"":`&type=${r}`}`),[v,o]=await Promise.all([_,c]),t=v.ok?v.data:C||{};C=t;const b=o.ok?o.data?.events||o.data?.log||[]:[],m=o.ok?o.data?.members||[]:[],p=t.last_event_at?x(t.last_event_at):t.last_heartbeat?`Heartbeat: ${x(t.last_heartbeat)}`:"";a.innerHTML=`
        <div class="scroll-content">
          <!-- Summary Card -->
          <div style="padding:var(--sp-lg)">
            <div class="card card-body" style="text-align:center">
              <div style="display:flex;align-items:center;justify-content:center;gap:var(--sp-sm);margin-bottom:var(--sp-sm)">
                <span style="width:10px;height:10px;border-radius:50%;background:${t.device_online?"var(--success)":"var(--muted)"}"></span>
                <span style="font-weight:var(--fw-bold);font-size:var(--fs-base)">${t.device_online?"Biometric Device Online":"Biometric Device Offline"}</span>
                ${t.device_name?`<span style="font-size:var(--fs-xs);color:var(--muted)">· ${s(t.device_name)}</span>`:""}
              </div>
              ${p?`<div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:var(--sp-md)">Last event: ${s(p)}</div>`:'<div style="margin-bottom:var(--sp-md)"></div>'}
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-lg)">
                <div style="cursor:pointer" id="stat-inside">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--brand)">${k(t.inside_now||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Inside Now</div>
                </div>
                <div style="cursor:pointer" id="stat-entries">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--success)">${k(t.entries_today||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Entries</div>
                </div>
                <div style="cursor:pointer" id="stat-exits">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--text-secondary)">${k(t.exits_today||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Exits</div>
                </div>
              </div>

              <!-- Quick Manual Check-In CTA Button -->
              <div style="margin-top:var(--sp-lg);padding-top:var(--sp-md);border-top:1px solid var(--border)">
                <button class="btn btn-primary btn-full" id="btn-open-checkin" style="font-weight:var(--fw-semibold);display:flex;align-items:center;justify-content:center;gap:var(--sp-sm)">
                  ${u("access",18,"white")} + Check In Member (Attendance)
                </button>
              </div>
            </div>

            ${t.denied_today>0?`
              <div class="card" id="banner-denied" style="margin-top:var(--sp-md);padding:var(--sp-md);background:var(--critical-surface);border-color:var(--critical-border);display:flex;align-items:center;justify-content:space-between;cursor:pointer">
                <div style="display:flex;align-items:center;gap:var(--sp-sm)">
                  ${u("alert",18,"var(--critical)")}
                  <span style="font-size:var(--fs-sm);font-weight:var(--fw-semibold);color:var(--critical)">${k(t.denied_today)} access denied event${t.denied_today>1?"s":""} today</span>
                </div>
                ${u("forward",14,"var(--critical)")}
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
            ${m.length>0?`
              <div class="card" style="margin:0 var(--sp-lg)">
                ${m.map(e=>`
                  <div class="list-item" style="display:flex;align-items:center;justify-content:space-between;gap:var(--sp-sm)">
                    <div style="display:flex;align-items:center;gap:var(--sp-sm);cursor:pointer;flex:1;min-width:0" data-member-link="${e.id}">
                      ${M(e.full_name||"Member","md")}
                      <div class="list-item-content" style="min-width:0">
                        <div class="list-item-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s(e.full_name||"Member")}</div>
                        <div class="list-item-subtitle">${e.phone?s(e.phone)+" · ":""}In ${e.entered_at?x(e.entered_at):"recently"}</div>
                      </div>
                    </div>
                    <button class="btn btn-outline btn-sm btn-checkout" data-checkout-id="${e.id}" data-checkout-name="${s(e.full_name||"Member")}" style="padding:4px 10px;font-size:var(--fs-xs);border-radius:var(--r-full);flex-shrink:0">
                      Check Out
                    </button>
                  </div>
                `).join("")}
              </div>
            `:L({icon:"access",title:"No members inside",text:"Members currently inside the gym will appear here when checked in"})}
          `:`
            ${b.length>0?`
              <div class="card" style="margin:0 var(--sp-lg)">
                ${b.map(e=>{const i=(e.event_type||"ENTRY").toUpperCase(),l=i==="ENTRY"||i==="ATTENDANCE",d=i==="ACCESS_DENIED",h=d?"var(--critical-surface)":l?"var(--success-surface)":"var(--gray-100)",S=d?"var(--critical)":l?"var(--success)":"var(--muted)",z=d?"alert":l?"forward":"back",A=d?"expired":l?"active":"info",N=d?"Denied":i==="ATTENDANCE"?"Check In":l?"Entry":"Exit";return`
                    <div class="list-item" style="cursor:pointer" data-event-member-id="${e.member_id||""}">
                      <div style="width:34px;height:34px;border-radius:var(--r-full);background:${h};display:flex;align-items:center;justify-content:center;flex-shrink:0">
                        ${u(z,16,S)}
                      </div>
                      <div class="list-item-content">
                        <div class="list-item-title">${s(e.member_name||"Unknown")}</div>
                        <div class="list-item-subtitle">${x(e.event_timestamp||e.timestamp||e.created_at)}${e.device_name?` · ${s(e.device_name)}`:""}</div>
                      </div>
                      <span class="badge badge-${A}">${N}</span>
                    </div>
                  `}).join("")}
              </div>
            `:L({icon:"access",title:"No events",text:"Live access and check-in events will appear here"})}
          `}
        </div>
      `,a.querySelectorAll("[data-tab]").forEach(e=>{e.addEventListener("click",()=>{r=e.dataset.tab,a.innerHTML=T(),n()})}),a.querySelector("#stat-inside")?.addEventListener("click",()=>{r="inside",n()}),a.querySelector("#stat-entries")?.addEventListener("click",()=>{r="entry",n()}),a.querySelector("#stat-exits")?.addEventListener("click",()=>{r="exit",n()}),a.querySelector("#banner-denied")?.addEventListener("click",()=>{r="denied",n()}),a.querySelector("#btn-open-checkin")?.addEventListener("click",()=>w()),a.querySelectorAll("[data-member-link]").forEach(e=>{e.addEventListener("click",()=>{const i=e.dataset.memberLink;i&&E.push("member-detail",{id:i})})}),a.querySelectorAll("[data-event-member-id]").forEach(e=>{e.addEventListener("click",()=>{const i=e.dataset.eventMemberId;i&&E.push("member-detail",{id:i})})}),a.querySelectorAll("[data-checkout-id]").forEach(e=>{e.addEventListener("click",async i=>{i.stopPropagation();const l=e.dataset.checkoutId,d=e.dataset.checkoutName;e.disabled=!0,e.textContent="Checking out...";const h=await I(l,"EXIT");h.ok?($(`${d} checked out`,"success"),await n()):($(h.error?.message||"Check-out failed","error"),e.disabled=!1,e.textContent="Check Out")})})}function w(){const a=document.createElement("div");a.className="modal-overlay center",a.innerHTML=`
        <div class="confirm-dialog" style="max-width:440px;width:90%;max-height:85vh;display:flex;flex-direction:column;padding:var(--sp-lg)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-md)">
            <div style="font-weight:var(--fw-bold);font-size:var(--fs-lg)">Manual Check In</div>
            <button id="modal-close" style="background:none;border:none;cursor:pointer;padding:4px">${u("close",20,"var(--muted)")}</button>
          </div>
          <div style="margin-bottom:var(--sp-md)">
            <input type="text" id="checkin-search" class="form-input" placeholder="Search member by name or phone..." style="width:100%" autofocus />
          </div>
          <div id="checkin-members-list" style="overflow-y:auto;max-height:50vh;display:flex;flex-direction:column;gap:var(--sp-xs)">
            <div style="text-align:center;padding:var(--sp-lg);color:var(--muted)">Loading active members...</div>
          </div>
        </div>
      `,document.body.appendChild(a),a.querySelector("#modal-close").onclick=()=>a.remove(),a.onclick=t=>{t.target===a&&a.remove()};const _=a.querySelector("#checkin-search"),c=a.querySelector("#checkin-members-list");let v=null;async function o(t=""){const b=`/api/mobile/v1/members?per_page=20${t?`&search=${encodeURIComponent(t)}`:"&status=active"}`,m=await g(b);if(!m.ok){c.innerHTML='<div style="text-align:center;padding:var(--sp-md);color:var(--critical)">Failed to load members</div>';return}const p=m.data?.members||[];if(p.length===0){c.innerHTML=`<div style="text-align:center;padding:var(--sp-lg);color:var(--muted)">No members found matching "${s(t)}"</div>`;return}c.innerHTML=p.map(e=>`
          <div class="card card-body" style="padding:var(--sp-sm) var(--sp-md);display:flex;align-items:center;justify-content:space-between;gap:var(--sp-sm)">
            <div style="display:flex;align-items:center;gap:var(--sp-sm);min-width:0;flex:1">
              ${M(e.full_name||"Member","sm")}
              <div style="min-width:0">
                <div style="font-weight:var(--fw-semibold);font-size:var(--fs-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s(e.full_name)}</div>
                <div style="font-size:var(--fs-xs);color:var(--muted)">${s(e.phone||"")}${e.plan?` · ${s(e.plan.name)}`:""}</div>
              </div>
            </div>
            <button class="btn btn-primary btn-sm btn-do-checkin" data-mid="${e.id}" data-mname="${s(e.full_name)}" style="border-radius:var(--r-full);padding:4px 12px;font-size:var(--fs-xs);flex-shrink:0">
              Check In
            </button>
          </div>
        `).join(""),c.querySelectorAll(".btn-do-checkin").forEach(e=>{e.addEventListener("click",async()=>{const i=e.dataset.mid,l=e.dataset.mname;e.disabled=!0,e.textContent="Checking in...";const d=await I(i,"ENTRY");d.ok?($(`${l} checked in successfully!`,"success"),a.remove(),await n()):($(d.error?.message||"Check-in failed","error"),e.disabled=!1,e.textContent="Check In")})})}_.addEventListener("input",t=>{clearTimeout(v),v=setTimeout(()=>{o(t.target.value.trim())},300)}),o()}f.innerHTML=`
      ${q({title:"Access Control",showBack:!0,actions:[{icon:"access",label:"Check In",onClick:()=>w()},{icon:"refresh",label:"Refresh",onClick:()=>n()}]})}
      <div class="scroll-view" id="ac-scroll">${T()}</div>
    `,D(f,{onBack:()=>{y&&clearInterval(y),E.pop()},actions:[{icon:"access",onClick:()=>w()},{icon:"refresh",onClick:()=>n()}]}),await n(),y=setInterval(()=>{document.body.contains(f)?n():clearInterval(y)},15e3)}};export{H as default};
