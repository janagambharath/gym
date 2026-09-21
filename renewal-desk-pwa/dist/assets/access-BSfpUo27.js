import{a as A,z as $,b as N,k as p,N as o,e as r,u as v,i as y,A as w,f as S,D as C,n as L}from"./index-BNW__y8c.js";const H={async mount(m){let s="all",f=null;async function a(){const i=m.querySelector("#ac-scroll");if(!i)return;const _=p("/api/mobile/v1/access/summary"),h=s==="inside"?p("/api/mobile/v1/access/inside?per_page=50"):p(`/api/mobile/v1/access/events?per_page=25${s==="all"?"":`&type=${s}`}`),[b,n]=await Promise.all([_,h]),t=b.ok?b.data:f||{};f=t;const u=n.ok?n.data?.events||n.data?.log||[]:[],g=n.ok?n.data?.members||[]:[],x=t.last_event_at?o(t.last_event_at):t.last_heartbeat?`Heartbeat: ${o(t.last_heartbeat)}`:"";i.innerHTML=`
        <div class="scroll-content">
          <!-- Summary Card -->
          <div style="padding:var(--sp-lg)">
            <div class="card card-body" style="text-align:center">
              <div style="display:flex;align-items:center;justify-content:center;gap:var(--sp-sm);margin-bottom:var(--sp-sm)">
                <span style="width:10px;height:10px;border-radius:50%;background:${t.device_online?"var(--success)":"var(--muted)"}"></span>
                <span style="font-weight:var(--fw-bold);font-size:var(--fs-base)">${t.device_online?"Device Online":"Device Offline"}</span>
                ${t.device_name?`<span style="font-size:var(--fs-xs);color:var(--muted)">· ${r(t.device_name)}</span>`:""}
              </div>
              ${x?`<div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:var(--sp-md)">Last event: ${r(x)}</div>`:'<div style="margin-bottom:var(--sp-md)"></div>'}
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-lg)">
                <div style="cursor:pointer" id="stat-inside">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--brand)">${v(t.inside_now||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Inside Now</div>
                </div>
                <div style="cursor:pointer" id="stat-entries">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--success)">${v(t.entries_today||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Entries</div>
                </div>
                <div style="cursor:pointer" id="stat-exits">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--text-secondary)">${v(t.exits_today||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Exits</div>
                </div>
              </div>
            </div>

            ${t.denied_today>0?`
              <div class="card" id="banner-denied" style="margin-top:var(--sp-md);padding:var(--sp-md);background:var(--critical-surface);border-color:var(--critical-border);display:flex;align-items:center;justify-content:space-between;cursor:pointer">
                <div style="display:flex;align-items:center;gap:var(--sp-sm)">
                  ${y("alert",18,"var(--critical)")}
                  <span style="font-size:var(--fs-sm);font-weight:var(--fw-semibold);color:var(--critical)">${v(t.denied_today)} access denied event${t.denied_today>1?"s":""} today</span>
                </div>
                ${y("forward",14,"var(--critical)")}
              </div>
            `:""}
          </div>

          <!-- Filter Tabs -->
          <div style="display:flex;gap:var(--sp-xs);padding:0 var(--sp-lg) var(--sp-md);overflow-x:auto;-webkit-overflow-scrolling:touch">
            ${[{id:"all",label:"All"},{id:"inside",label:`Inside (${t.inside_now||0})`},{id:"entry",label:"Entries"},{id:"exit",label:"Exits"},{id:"denied",label:"Denied"}].map(e=>`
              <button class="btn btn-sm ${s===e.id?"btn-primary":"btn-secondary"}" data-tab="${e.id}" style="border-radius:var(--r-full);white-space:nowrap;padding:4px 12px;font-size:var(--fs-xs)">
                ${e.label}
              </button>
            `).join("")}
          </div>

          <!-- List Section -->
          ${s==="inside"?`
            ${g.length>0?`
              <div class="card" style="margin:0 var(--sp-lg)">
                ${g.map(e=>`
                  <div class="list-item">
                    ${S(e.full_name||"Member","md")}
                    <div class="list-item-content">
                      <div class="list-item-title">${r(e.full_name||"Member")}</div>
                      <div class="list-item-subtitle">${e.phone?r(e.phone)+" · ":""}Entered ${e.entered_at?o(e.entered_at):"recently"}</div>
                    </div>
                    ${C(e.status||"Active")}
                  </div>
                `).join("")}
              </div>
            `:w({icon:"access",title:"No members inside",text:"Members currently inside the gym will appear here"})}
          `:`
            ${u.length>0?`
              <div class="card" style="margin:0 var(--sp-lg)">
                ${u.map(e=>{const c=(e.event_type||"ENTRY").toUpperCase(),d=c==="ENTRY"||c==="ATTENDANCE",l=c==="ACCESS_DENIED",E=l?"var(--critical-surface)":d?"var(--success-surface)":"var(--gray-100)",k=l?"var(--critical)":d?"var(--success)":"var(--muted)",T=l?"alert":d?"forward":"back",D=l?"expired":d?"active":"info",z=l?"Denied":c==="ATTENDANCE"?"Check In":d?"Entry":"Exit";return`
                    <div class="list-item">
                      <div style="width:34px;height:34px;border-radius:var(--r-full);background:${E};display:flex;align-items:center;justify-content:center;flex-shrink:0">
                        ${y(T,16,k)}
                      </div>
                      <div class="list-item-content">
                        <div class="list-item-title">${r(e.member_name||"Unknown")}</div>
                        <div class="list-item-subtitle">${o(e.event_timestamp||e.timestamp||e.created_at)}${e.device_name?` · ${r(e.device_name)}`:""}</div>
                      </div>
                      <span class="badge badge-${D}">${z}</span>
                    </div>
                  `}).join("")}
              </div>
            `:w({icon:"access",title:"No events",text:"Access events will appear here"})}
          `}
        </div>
      `,i.querySelectorAll("[data-tab]").forEach(e=>{e.addEventListener("click",()=>{s=e.dataset.tab,i.innerHTML=$(),a()})}),i.querySelector("#stat-inside")?.addEventListener("click",()=>{s="inside",a()}),i.querySelector("#stat-entries")?.addEventListener("click",()=>{s="entry",a()}),i.querySelector("#stat-exits")?.addEventListener("click",()=>{s="exit",a()}),i.querySelector("#banner-denied")?.addEventListener("click",()=>{s="denied",a()})}m.innerHTML=`
      ${A({title:"Access Control",showBack:!0,actions:[{icon:"refresh",label:"Refresh",onClick:()=>a()}]})}
      <div class="scroll-view" id="ac-scroll">${$()}</div>
    `,N(m,{onBack:()=>L.pop(),actions:[{icon:"refresh",onClick:()=>a()}]}),await a()}};export{H as default};
