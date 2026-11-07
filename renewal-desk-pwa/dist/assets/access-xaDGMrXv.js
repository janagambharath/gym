import{a as U,F as G,x as O,b as Y,d as Q,e as w,z as K,s as c,w as N,f as m,k as j,i as P,A as V,u as W,n as F,G as J,V as X}from"./index-C7C1lUE0.js";const te={async mount(u){document.getElementById("quick-assign-overlay")?.remove();let l="all",_=null,g=0,p=1,h=0,x=1,v=[];const T=e=>e.punch_key||(e.id??`${e.member_id||""}|${e.biometric_user_id||e.device_enroll_number||""}|${e.event_timestamp||e.timestamp||e.created_at||""}`),R=e=>{const n=new Set;return e.filter(r=>{const i=T(r);return n.has(i)?!1:(n.add(i),!0)})};let z=!1,H=!1,I=!1,D=null;function k(e){const n=(e.event_type||"ENTRY").toUpperCase(),r=n==="ENTRY"||n==="ATTENDANCE",i=n==="ACCESS_DENIED",y=i?"var(--critical-surface)":r?"var(--success-surface)":"var(--gray-100)",d=i?"var(--critical)":r?"var(--success)":"var(--muted)",q=i?"alert":r?"forward":"back",t=i?"expired":r?"active":"info",E=i?"Denied":n==="ATTENDANCE"?"Check In":r?"Entry":"Exit",s=e.biometric_user_id||e.device_enroll_number,$=!e.member_id&&s,A=e.member_id?m(e.member_name||"Unknown"):s?`Unknown · ID ${m(s)}`:"Unknown";return`
        <div class="list-item" style="cursor:pointer" data-event-member-id="${e.member_id||""}" data-bio-id="${!e.member_id&&s?m(s):""}">
          <div style="width:34px;height:34px;border-radius:var(--r-full);background:${y};display:flex;align-items:center;justify-content:center;flex-shrink:0">
            ${P(q,16,d)}
          </div>
          <div class="list-item-content">
            <div class="list-item-title">${A}${$?' <span style="font-size:11px;color:#3b82f6;font-weight:700">· tap to assign</span>':""}</div>
            <div class="list-item-subtitle">${N(e.event_timestamp||e.timestamp||e.created_at)}${e.device_name?` · ${m(e.device_name)}`:""}</div>
          </div>
          <span class="badge badge-${t}">${E}</span>
        </div>
      `}function S(e){e.querySelectorAll("[data-event-member-id]").forEach(n=>{n.dataset.wired||(n.dataset.wired="1",n.addEventListener("click",()=>{const r=n.dataset.eventMemberId,i=n.dataset.bioId;r?F.push("member-detail",{memberId:r}):i&&Z(i)}))})}async function f(){if(p>=x)return;const e=u.querySelector("#ac-load-more");e&&(e.disabled=!0,e.textContent="Loading…");const n=p+1,r=await w(`/api/mobile/v1/access/events?page=${n}&per_page=25${l==="all"?"":`&type=${l}`}`);if(!r.ok){c(r.error?.message||"Could not load more events.","error"),e&&(e.disabled=!1,e.textContent="Load more events");return}p=r.data?.pagination?.page??n,x=r.data?.pagination?.total_pages??x,h=r.data?.pagination?.total??h;const i=r.data?.events||r.data?.log||[],y=new Set(v.map(T)),d=i.filter(s=>{const $=T(s);return y.has($)?!1:(y.add($),!0)});v=[...v,...d];const q=u.querySelector("#ac-events-card");q&&(q.insertAdjacentHTML("beforeend",d.map(k).join("")),S(q));const t=u.querySelector("#ac-feed-count");t&&(t.textContent=`Showing ${v.length} of ${h} events`);const E=u.querySelector("#ac-more-wrap");E&&(E.style.display=p<x?"":"none"),e&&(e.disabled=!1,e.textContent="Load more events")}async function o(){const e=++g,n=u.querySelector("#ac-scroll");if(!n)return;const r=a=>`/api/mobile/v1/access/events?page=${a}&per_page=25${l==="all"?"":`&type=${l}`}`,[i,...y]=await Promise.all([w("/api/mobile/v1/access/summary"),...Array.from({length:p},(a,C)=>w(r(C+1)))]);if(e!==g||u.dataset.screenDisposed==="true")return;const d=y[y.length-1],q=[...y].reverse().find(a=>a.ok);if(!H&&(!i.ok||!d.ok)){const a=(i.ok?d.error?.message:i.error?.message)||"Check your connection and try again.";n.innerHTML=K(a),n.querySelector("#retry-btn")?.addEventListener("click",o);return}if(d.ok)z=!1;else if(z||(z=!0,c("Could not refresh the access feed — showing the last loaded events.","error")),_)return;const t=i.ok?i.data:_||{};_=t,i.ok?(I=!1,D=new Date):_&&!I&&(I=!0,c("Could not refresh the access summary — showing the last loaded stats.","error"));const E=!i.ok&&!!_,s=d.ok?d.data?.events||d.data?.log||[]:[],$=d.ok?d.data?.pagination||{}:{};h=$.total??q?.data?.pagination?.total??h,x=$.total_pages??x,p=$.page??p,v=R(y.slice(0,-1).flatMap(a=>a.ok?a.data?.events||a.data?.log||[]:[]).concat(s));const A=t.last_event_at?N(t.last_event_at):t.last_heartbeat?`Heartbeat: ${N(t.last_heartbeat)}`:"";n.innerHTML=`
        <div class="scroll-content">
          <!-- Summary Card -->
          <div style="padding:var(--sp-lg)">
            <div class="card card-body" style="text-align:center">
              <div style="display:flex;align-items:center;justify-content:center;gap:var(--sp-sm);margin-bottom:var(--sp-sm)">
                <span style="width:10px;height:10px;border-radius:50%;background:${t.device_online?"var(--success)":"var(--muted)"}"></span>
                <span style="font-weight:var(--fw-bold);font-size:var(--fs-base)">${t.device_online?"Biometric Device Online":"Biometric Device Offline"}</span>
                ${t.device_name?`<span style="font-size:var(--fs-xs);color:var(--muted)">· ${m(t.device_name)}</span>`:""}
              </div>
              ${A?`<div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:var(--sp-md)">Last event: ${m(A)}</div>`:'<div style="margin-bottom:var(--sp-md)"></div>'}
              ${E?`<div style="font-size:var(--fs-xs);color:var(--warning);margin-bottom:var(--sp-md)">${D?`Stats from ${m(N(D.toISOString()))} — could not refresh.`:"Stats could not be refreshed — showing the last loaded stats."}</div>`:""}
              <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:var(--sp-lg)">
                <div style="cursor:pointer" id="stat-entries">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--brand)">${j(t.entries_today||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Entries</div>
                </div>
                <div style="cursor:pointer" id="stat-exits">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--warning)">${j(t.exits_today||0)}</div>
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
              ${t.adms_device_name?`<div style="font-size:var(--fs-xs);color:var(--muted)">${m(t.adms_device_name)}</div>`:""}
              <p style="font-size:var(--fs-xs);color:var(--muted);margin:0">${t.adms_online?t.adms_commands_enabled?"Terminal polled recently. Membership block/restore commands are enabled.":"Terminal polled recently, but automatic membership commands are not enabled yet.":`No recent terminal poll${t.adms_last_seen_at?` (last seen ${m(N(t.adms_last_seen_at))})`:""}. It cannot receive block/unblock commands until it reconnects.`}</p>
            </div>
            `:""}

            ${t.failed_commands>0?`
              <div class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);background:rgba(245,158,11,0.1);border-color:rgba(245,158,11,0.3);display:flex;align-items:center;justify-content:space-between">
                <div style="font-size:var(--fs-xs);color:#B45309;display:flex;align-items:center;gap:var(--sp-xs)">
                  ${P("alert",16,"#B45309")}
                  <span><strong>${j(t.failed_commands)} command(s)</strong> failed to sync</span>
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
                  ${P("alert",18,"var(--critical)")}
                  <span style="font-size:var(--fs-sm);font-weight:var(--fw-semibold);color:var(--critical)">${j(t.denied_today)} access denied event${t.denied_today>1?"s":""} today</span>
                </div>
                ${P("forward",14,"var(--critical)")}
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
            ${[{id:"all",label:"All Events"},{id:"entry",label:"Entries"},{id:"exit",label:"Exits"},{id:"denied",label:"Denied"}].map(a=>`
              <button class="btn btn-sm ${l===a.id?"btn-primary":"btn-secondary"}" data-tab="${a.id}" style="border-radius:var(--r-full);white-space:nowrap;padding:4px 12px;font-size:var(--fs-xs)">
                ${a.label}
              </button>
            `).join("")}
          </div>

          <!-- List Section -->
          ${`
            ${v.length>0?`
              <div class="card" id="ac-events-card" style="margin:0 var(--sp-lg)">
                ${v.map(k).join("")}
              </div>
              <div id="ac-feed-count" style="padding:var(--sp-sm) 0;font-size:var(--fs-sm);color:var(--muted);text-align:center">Showing ${v.length} of ${h} events</div>
              ${p<x?'<div id="ac-more-wrap" style="text-align:center;padding:var(--sp-md)"><button class="btn btn-secondary" id="ac-load-more">Load more events</button></div>':""}
            `:V({icon:"access",title:"No events",text:"Live access and check-in events will appear here"})}
          `}
        </div>
      `,n.querySelectorAll("[data-tab]").forEach(a=>{a.addEventListener("click",()=>{l=a.dataset.tab,p=1,v=[],n.innerHTML=O(),o()})}),n.querySelector("#ac-load-more")?.addEventListener("click",f),n.querySelector("#stat-entries")?.addEventListener("click",()=>{l="entry",p=1,v=[],o()}),n.querySelector("#stat-exits")?.addEventListener("click",()=>{l="exit",p=1,v=[],o()}),n.querySelector("#banner-denied")?.addEventListener("click",()=>{l="denied",p=1,v=[],o()});const b=n.querySelector("#btn-remote-unlock");b&&b.addEventListener("click",async()=>{if(!window.confirm("Unlock the gym gate for 5 seconds?"))return;b.disabled=!0,b.textContent="Sending unlock...";const a=await w("/api/mobile/v1/access/remote-unlock",{method:"POST",body:{delay_seconds:5,confirm:!0}});a.ok?c(a.data?.message||"Unlock command queued. Waiting for terminal acknowledgement.","success"):c(a.error?.message||"Could not unlock door","error"),b.disabled=!1,b.textContent="🔓 Unlock Gate"});const M=n.querySelector("#btn-reconcile-all");M&&M.addEventListener("click",async()=>{M.disabled=!0,M.textContent="Syncing...";const a=await w("/api/mobile/v1/access/reconcile",{method:"POST"});a.ok?(c(a.data?.message||"Re-sync queued for device","success"),await o()):c(a.error?.message||"Re-sync failed","error"),M.disabled=!1,M.textContent="🔄 Re-sync Members"});const B=n.querySelector("#btn-bridge-pairing");B&&B.addEventListener("click",async()=>{B.disabled=!0;const a=await w("/api/mobile/v1/settings/bridge/pairing-code",{method:"POST"});B.disabled=!1,a.ok&&a.data?.pairing_code?await W({title:"Bridge Pairing Code",message:`Your 6-digit pairing code is:

${a.data.pairing_code}

Valid for 10 minutes. Enter this code into RenewalDeskConnector.exe on your gym PC to connect.`,confirmText:"Done"}):c(a.error?.message||"Could not generate pairing code","error")}),n.querySelector("#btn-retry-sync")?.addEventListener("click",async()=>{const a=n.querySelector("#btn-retry-sync");a&&(a.disabled=!0);const C=await w("/api/mobile/v1/access/retry-sync",{method:"POST"});C.ok?(c(C.data?.message||"Commands queued for retry","success"),await o()):(c(C.error?.message||"Could not retry syncs","error"),a&&(a.disabled=!1))}),n.querySelector("#btn-clear-failed")?.addEventListener("click",async()=>{if(!confirm("Permanently delete all failed biometric commands? This cannot be undone."))return;const a=n.querySelector("#btn-clear-failed");a&&(a.disabled=!0);const C=await w("/api/mobile/v1/access/clear-failed",{method:"POST"});C.ok?(c(C.data?.message||"Failed commands cleared","success"),await o()):(c(C.error?.message||"Could not clear commands","error"),a&&(a.disabled=!1))}),S(n),H=!0}function L(){const e=document.createElement("div");e.className="modal-overlay center",e.innerHTML=`
        <div class="confirm-dialog" style="max-width:440px;width:90%;max-height:85vh;display:flex;flex-direction:column;padding:var(--sp-lg)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-md)">
            <div style="font-weight:var(--fw-bold);font-size:var(--fs-lg)">Manual Check In</div>
            <button id="modal-close" style="background:none;border:none;cursor:pointer;padding:4px">${P("close",20,"var(--muted)")}</button>
          </div>
          <div style="margin-bottom:var(--sp-md)">
            <input type="text" id="checkin-search" class="form-input" placeholder="Search member by name or phone..." style="width:100%" autofocus />
          </div>
          <div id="checkin-members-list" style="overflow-y:auto;max-height:50vh;display:flex;flex-direction:column;gap:var(--sp-xs)">
            <div style="text-align:center;padding:var(--sp-lg);color:var(--muted)">Loading active members...</div>
          </div>
        </div>
      `,document.body.appendChild(e),e.querySelector("#modal-close").onclick=()=>e.remove(),e.onclick=d=>{d.target===e&&e.remove()};const n=e.querySelector("#checkin-search"),r=e.querySelector("#checkin-members-list");let i=null;async function y(d=""){const q=`/api/mobile/v1/members?page_size=20&status=active${d?`&q=${encodeURIComponent(d)}`:""}`,t=await w(q);if(!t.ok){r.innerHTML='<div style="text-align:center;padding:var(--sp-md);color:var(--critical)">Failed to load members</div>';return}const E=t.data?.members||[];if(E.length===0){r.innerHTML=`<div style="text-align:center;padding:var(--sp-lg);color:var(--muted)">No members found matching "${m(d)}"</div>`;return}r.innerHTML=E.map(s=>`
          <div class="card card-body" style="padding:var(--sp-sm) var(--sp-md);display:flex;align-items:center;justify-content:space-between;gap:var(--sp-sm)">
            <div style="display:flex;align-items:center;gap:var(--sp-sm);min-width:0;flex:1">
              ${J(s.full_name||"Member","sm")}
              <div style="min-width:0">
                <div style="font-weight:var(--fw-semibold);font-size:var(--fs-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m(s.full_name)}</div>
                <div style="font-size:var(--fs-xs);color:var(--muted)">${m(s.phone||"")}${s.plan?` · ${m(s.plan.name)}`:""}</div>
              </div>
            </div>
            <button class="btn btn-primary btn-sm btn-do-checkin" data-mid="${s.id}" data-mname="${m(s.full_name)}" style="border-radius:var(--r-full);padding:4px 12px;font-size:var(--fs-xs);flex-shrink:0">
              Check In
            </button>
          </div>
        `).join(""),r.querySelectorAll(".btn-do-checkin").forEach(s=>{s.addEventListener("click",async()=>{const $=s.dataset.mid,A=s.dataset.mname;s.disabled=!0,s.textContent="Checking in...";const b=await X($,"ENTRY");b.ok&&b.data?.event_type==="ACCESS_DENIED"?(c(b.message||b.data?.message||`${A} was denied access — membership is not active.`,"error"),s.disabled=!1,s.textContent="Check In"):b.ok?(c(`${A} checked in successfully!`,"success"),e.remove(),await o()):(c(b.error?.message||"Check-in failed","error"),s.disabled=!1,s.textContent="Check In")})})}n.addEventListener("input",d=>{clearTimeout(i),i=setTimeout(()=>{y(d.target.value.trim())},300)}),y()}u.innerHTML=`
      ${U({title:"Live Access",showBack:G.depth>1,actions:[{icon:"access",label:"Check In",onClick:()=>L()},{icon:"refresh",label:"Refresh",onClick:()=>o()}]})}
      <div class="scroll-view" id="ac-scroll">${O()}</div>
    `,Y(u,{onBack:()=>{F.pop()},actions:[{icon:"access",onClick:()=>L()},{icon:"refresh",onClick:()=>o()}]}),await o(),Q(u,o,15e3),window.__refreshAccess=()=>{document.body.contains(u)&&o()}},async unmount(){window.__refreshAccess=null}};async function Z(u){const l=document.createElement("div");l.id="quick-assign-overlay",l.innerHTML=`
    <div class="qa-sheet">
      <div class="qa-handle"></div>
      <h3>Who is biometric ID ${m(u)}?</h3>
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
    </style>`,document.body.appendChild(l);const _=()=>l.remove();l.addEventListener("click",k=>{k.target===l&&_()}),l.querySelector("#qa-close").addEventListener("click",_);let g=[],p=1,h=0,x="",v=!1,T=!1;const R=l.querySelector("#qa-results"),z=l.querySelector("#qa-search"),H=()=>{const k=g.map(f=>`<div class="qa-row" data-qa-pick="${f.id}"><b>${m(f.full_name)}</b>${f.phone?`<span>${m(f.phone)}</span>`:""}</div>`).join(""),S=g.length<h?`<button id="qa-more" style="width:100%;padding:12px;border:none;background:none;color:#2563eb;font-weight:700;font-size:14px;cursor:pointer">Show more (${g.length} of ${h})</button>`:g.length?`<div style="padding:10px;text-align:center;color:#94a3b8;font-size:12px">Showing ${g.length} of ${h} members</div>`:"";R.innerHTML=g.length||S?k+S:'<div class="qa-empty">No members found</div>',R.querySelectorAll("[data-qa-pick]").forEach(f=>{f.addEventListener("click",async()=>{if(T)return;T=!0;const o=Number(f.dataset.qaPick);f.style.background="#dcfce7";const L=await w("/api/mobile/v1/rrr/mappings/bulk-resolve",{method:"POST",body:{mappings:[{external_id:u,member_id:o}]}});L.ok&&L.data.linked===1?(c(`ID ${u} linked ✓`),_(),window.__refreshAccess&&window.__refreshAccess()):(c(L.error?.message||"Link failed — try again","error"),f.style.background="",T=!1)})}),R.querySelector("#qa-more")?.addEventListener("click",()=>{I(!1)})};async function I(k){if(v)return;v=!0;const S=k?1:p+1,f=await w(`/api/mobile/v1/members?page=${S}&page_size=30${x?`&q=${encodeURIComponent(x)}`:""}`);if(v=!1,f.ok){k&&(p=1,g=[]);const o=f.data.members||[];h=f.data.pagination?.total??(k?o.length:g.length+o.length);const L=new Set(g.map(e=>e.id));g=k?o:[...g,...o.filter(e=>!L.has(e.id))],p=S}else c(f.error?.message||"Could not load more members.","error");H()}let D;z.addEventListener("input",()=>{clearTimeout(D),D=setTimeout(()=>{x=z.value.trim(),I(!0)},300)}),I(!0),z.focus()}export{te as default};
