import{a as O,C as U,u as H,b as F,f as G,g as y,s as m,H as I,j as c,k as N,i as M,D as P,x as Y,G as Q,n as j,R as B}from"./index-C9y_aAuQ.js";const X={async mount(u){document.getElementById("quick-assign-overlay")?.remove();let l="all",q=null,g=0,p=1,h=0,x=1,v=[],E=[],L=0,C=!1;function A(e){const t=(e.event_type||"ENTRY").toUpperCase(),n=t==="ENTRY"||t==="ATTENDANCE",o=t==="ACCESS_DENIED",f=o?"var(--critical-surface)":n?"var(--success-surface)":"var(--gray-100)",d=o?"var(--critical)":n?"var(--success)":"var(--muted)",b=o?"alert":n?"forward":"back",s=o?"expired":n?"active":"info",S=o?"Denied":t==="ATTENDANCE"?"Check In":n?"Entry":"Exit",i=e.biometric_user_id||e.device_enroll_number,z=!e.member_id&&i,k=e.member_id?c(e.member_name||"Unknown"):i?`Unknown · ID ${c(i)}`:"Unknown";return`
        <div class="list-item" style="cursor:pointer" data-event-member-id="${e.member_id||""}" data-bio-id="${!e.member_id&&i?c(i):""}">
          <div style="width:34px;height:34px;border-radius:var(--r-full);background:${f};display:flex;align-items:center;justify-content:center;flex-shrink:0">
            ${M(b,16,d)}
          </div>
          <div class="list-item-content">
            <div class="list-item-title">${k}${z?' <span style="font-size:11px;color:#3b82f6;font-weight:700">· tap to assign</span>':""}</div>
            <div class="list-item-subtitle">${I(e.event_timestamp||e.timestamp||e.created_at)}${e.device_name?` · ${c(e.device_name)}`:""}</div>
          </div>
          <span class="badge badge-${s}">${S}</span>
        </div>
      `}function T(e){e.querySelectorAll("[data-event-member-id]").forEach(t=>{t.dataset.wired||(t.dataset.wired="1",t.addEventListener("click",()=>{const n=t.dataset.eventMemberId,o=t.dataset.bioId;n?j.push("member-detail",{memberId:n}):o&&V(o)}))}),e.querySelectorAll("[data-checkout-id]").forEach(t=>{t.dataset.wired||(t.dataset.wired="1",t.addEventListener("click",async n=>{n.stopPropagation();const o=t.dataset.checkoutId,f=t.dataset.checkoutName;t.disabled=!0,t.textContent="Checking out...";const d=await B(o,"EXIT");d.ok?(m(`${f} checked out`,"success"),await r()):(m(d.error?.message||"Check-out failed","error"),t.disabled=!1,t.textContent="Check Out")}))})}async function D(){if(p>=x)return;const e=u.querySelector("#ac-load-more");e&&(e.disabled=!0,e.textContent="Loading…");const t=p+1,n=await y(`/api/mobile/v1/access/events?page=${t}&per_page=25${l==="all"?"":`&type=${l}`}`);if(!n.ok){m(n.error?.message||"Could not load more events.","error"),e&&(e.disabled=!1,e.textContent="Load more events");return}p=n.data?.pagination?.page??t,x=n.data?.pagination?.total_pages??x,h=n.data?.pagination?.total??h;const o=n.data?.events||n.data?.log||[];v=[...v,...o];const f=u.querySelector("#ac-events-card");f&&(f.insertAdjacentHTML("beforeend",o.map(A).join("")),T(f));const d=u.querySelector("#ac-feed-count");d&&(d.textContent=`Showing ${v.length} of ${h} events`);const b=u.querySelector("#ac-more-wrap");b&&(b.style.display=p<x?"":"none"),e&&(e.disabled=!1,e.textContent="Load more events")}async function r(){const e=++g,t=u.querySelector("#ac-scroll");if(!t)return;const n=a=>`/api/mobile/v1/access/events?page=${a}&per_page=25${l==="all"?"":`&type=${l}`}`,[o,f,...d]=await Promise.all([y("/api/mobile/v1/access/summary"),y("/api/mobile/v1/access/inside?per_page=50"),...Array.from({length:p},(a,_)=>y(n(_+1)))]);if(e!==g||u.dataset.screenDisposed==="true")return;const b=d.find(a=>!a.ok)||d[d.length-1];if(!o.ok&&!b.ok&&q)return;if(b.ok)C=!1;else if(C||(C=!0,m("Could not refresh the access feed — showing the last loaded events.","error")),q)return;const s=o.ok?o.data:q||{};q=s;const S=b.ok?b.data?.events||b.data?.log||[]:[],i=b.ok?b.data?.pagination||{}:{};h=i.total??S.length,x=i.total_pages??1,p=i.page??p,v=d.slice(0,-1).flatMap(a=>a.ok?a.data?.events||a.data?.log||[]:[]).concat(S),E=f.ok?f.data?.members||[]:[],L=f.ok?f.data?.pagination?.total??E.length:0;const z=s.last_event_at?I(s.last_event_at):s.last_heartbeat?`Heartbeat: ${I(s.last_heartbeat)}`:"";t.innerHTML=`
        <div class="scroll-content">
          <!-- Summary Card -->
          <div style="padding:var(--sp-lg)">
            <div class="card card-body" style="text-align:center">
              <div style="display:flex;align-items:center;justify-content:center;gap:var(--sp-sm);margin-bottom:var(--sp-sm)">
                <span style="width:10px;height:10px;border-radius:50%;background:${s.device_online?"var(--success)":"var(--muted)"}"></span>
                <span style="font-weight:var(--fw-bold);font-size:var(--fs-base)">${s.device_online?"Biometric Device Online":"Biometric Device Offline"}</span>
                ${s.device_name?`<span style="font-size:var(--fs-xs);color:var(--muted)">· ${c(s.device_name)}</span>`:""}
              </div>
              ${z?`<div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:var(--sp-md)">Last event: ${c(z)}</div>`:'<div style="margin-bottom:var(--sp-md)"></div>'}
              <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:var(--sp-lg)">
                <div style="cursor:pointer" id="stat-entries">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--brand)">${N(s.entries_today||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Entries</div>
                </div>
                <div style="cursor:pointer" id="stat-exits">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--warning)">${N(s.exits_today||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Exits</div>
                </div>
              </div>

              ${s.remote_unlock_available?`
              <!-- Remote Physical Gate Control -->
              <div style="margin-top:var(--sp-lg);padding-top:var(--sp-md);border-top:1px solid var(--border);display:grid;grid-template-columns:1fr;gap:var(--sp-sm)">
                <button class="btn" id="btn-remote-unlock" style="font-weight:var(--fw-semibold);display:flex;align-items:center;justify-content:center;gap:var(--sp-xs);font-size:var(--fs-xs);background:#16a34a;color:white;border:none">
                  🔓 Unlock Gate
                </button>
              </div>
              `:""}
            </div>

            ${s.adms_integration_id?"":`
            <!-- Hardware Bridge Controls (only when NOT on Direct Cloud) -->
            <div class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);display:flex;flex-direction:column;gap:var(--sp-sm)">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <div style="font-weight:var(--fw-bold);font-size:var(--fs-xs);text-transform:uppercase;color:var(--muted);letter-spacing:0.5px">Hardware Bridge Controls</div>
                <span style="font-size:10px;font-weight:var(--fw-bold);padding:2px 8px;border-radius:12px;background:${s.bridge_online?"#dcfce7":"#fee2e2"};color:${s.bridge_online?"#15803d":"#b91c1c"}">
                  ${s.bridge_online?"BRIDGE ONLINE":"BRIDGE OFFLINE"}
                </span>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-xs)">
                <button class="btn btn-secondary btn-sm" id="btn-reconcile-all" style="font-size:var(--fs-xs);padding:6px 10px">🔄 Re-sync Members</button>
                <button class="btn btn-secondary btn-sm" id="btn-bridge-pairing" style="font-size:var(--fs-xs);padding:6px 10px">🔑 Pairing Code</button>
              </div>
            </div>
            `}

            ${s.adms_integration_id?`
            <!-- Direct Cloud (ADMS) Status -->
            <div class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);display:flex;flex-direction:column;gap:var(--sp-sm)">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <div style="font-weight:var(--fw-bold);font-size:var(--fs-xs);text-transform:uppercase;color:var(--muted);letter-spacing:0.5px">Direct Cloud Terminal</div>
                <span style="font-size:10px;font-weight:var(--fw-bold);padding:2px 8px;border-radius:12px;background:${s.adms_online?"#dcfce7":"#fee2e2"};color:${s.adms_online?"#15803d":"#b91c1c"}">
                  ${s.adms_online?"ONLINE":"OFFLINE"}
                </span>
              </div>
              ${s.adms_device_name?`<div style="font-size:var(--fs-xs);color:var(--muted)">${c(s.adms_device_name)}</div>`:""}
              <p style="font-size:var(--fs-xs);color:var(--muted);margin:0">${s.adms_online?s.adms_commands_enabled?"Terminal polled recently. Membership block/restore commands are enabled.":"Terminal polled recently, but automatic membership commands are not enabled yet.":`No recent terminal poll${s.adms_last_seen_at?` (last seen ${c(I(s.adms_last_seen_at))})`:""}. It cannot receive block/unblock commands until it reconnects.`}</p>
            </div>
            `:""}

            ${s.failed_commands>0?`
              <div class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);background:rgba(245,158,11,0.1);border-color:rgba(245,158,11,0.3);display:flex;align-items:center;justify-content:space-between">
                <div style="font-size:var(--fs-xs);color:#B45309;display:flex;align-items:center;gap:var(--sp-xs)">
                  ${M("alert",16,"#B45309")}
                  <span><strong>${N(s.failed_commands)} command(s)</strong> failed to sync</span>
                </div>
                <div style="display:flex;gap:8px">
                  <button class="btn btn-sm btn-primary" id="btn-retry-sync" style="font-size:var(--fs-xs);padding:4px 10px">Retry All</button>
                  <button class="btn btn-sm" id="btn-clear-failed" style="font-size:var(--fs-xs);padding:4px 10px;background:#FEE2E2;color:#B91C1C;border:1px solid #FECACA">Clear</button>
                </div>
              </div>
            `:""}

            ${s.denied_today>0?`
              <div class="card" id="banner-denied" style="margin-top:var(--sp-md);padding:var(--sp-md);background:var(--critical-surface);border-color:var(--critical-border);display:flex;align-items:center;justify-content:space-between;cursor:pointer">
                <div style="display:flex;align-items:center;gap:var(--sp-sm)">
                  ${M("alert",18,"var(--critical)")}
                  <span style="font-size:var(--fs-sm);font-weight:var(--fw-semibold);color:var(--critical)">${N(s.denied_today)} access denied event${s.denied_today>1?"s":""} today</span>
                </div>
                ${M("forward",14,"var(--critical)")}
              </div>
            `:""}

            ${!s.device_online&&(s.inside_now||0)===0&&(s.entries_today||0)===0?`
              <div style="margin-top:var(--sp-md);padding:var(--sp-sm) var(--sp-md);background:var(--gray-50, #f8f9fa);border:1px dashed var(--border);border-radius:var(--r-md);font-size:var(--fs-xs);color:var(--muted);text-align:center">
                💡 Tip: Tap <b>"+ Check In Member"</b> above to log attendance manually anytime, or connect your biometric turnstile/machine.
              </div>
            `:""}
          </div>

          <!-- Inside Now (V3-M21) — from /access/inside, not the feed -->
          ${E.length?`
            <div class="card" style="margin:var(--sp-md) var(--sp-lg) 0">
              <div style="padding:var(--sp-md) var(--sp-md) var(--sp-xs);font-weight:var(--fw-bold);font-size:var(--fs-sm)">Inside now (${L})</div>
              ${E.map(a=>`
                <div class="list-item" style="cursor:pointer" data-event-member-id="${a.id}">
                  ${P(a.full_name||"Member","sm")}
                  <div class="list-item-content">
                    <div class="list-item-title">${c(a.full_name)}</div>
                    <div class="list-item-subtitle">Entered ${a.entered_at?I(a.entered_at):"—"}</div>
                  </div>
                  <button class="btn btn-secondary btn-sm" data-checkout-id="${a.id}" data-checkout-name="${c(a.full_name)}">Check Out</button>
                </div>`).join("")}
            </div>`:""}

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
                ${v.map(A).join("")}
              </div>
              <div id="ac-feed-count" style="padding:var(--sp-sm) 0;font-size:var(--fs-sm);color:var(--muted);text-align:center">Showing ${v.length} of ${h} events</div>
              ${p<x?'<div id="ac-more-wrap" style="text-align:center;padding:var(--sp-md)"><button class="btn btn-secondary" id="ac-load-more">Load more events</button></div>':""}
            `:Y({icon:"access",title:"No events",text:"Live access and check-in events will appear here"})}
          `}
        </div>
      `,t.querySelectorAll("[data-tab]").forEach(a=>{a.addEventListener("click",()=>{l=a.dataset.tab,p=1,v=[],t.innerHTML=H(),r()})}),t.querySelector("#ac-load-more")?.addEventListener("click",D),t.querySelector("#stat-entries")?.addEventListener("click",()=>{l="entry",p=1,v=[],r()}),t.querySelector("#stat-exits")?.addEventListener("click",()=>{l="exit",p=1,v=[],r()}),t.querySelector("#banner-denied")?.addEventListener("click",()=>{l="denied",p=1,v=[],r()});const k=t.querySelector("#btn-remote-unlock");k&&k.addEventListener("click",async()=>{if(!window.confirm("Unlock the gym gate for 5 seconds?"))return;k.disabled=!0,k.textContent="Sending unlock...";const a=await y("/api/mobile/v1/access/remote-unlock",{method:"POST",body:{delay_seconds:5,confirm:!0}});a.ok?m(a.data?.message||"Unlock command queued. Waiting for terminal acknowledgement.","success"):m(a.error?.message||"Could not unlock door","error"),k.disabled=!1,k.textContent="🔓 Unlock Gate"});const $=t.querySelector("#btn-reconcile-all");$&&$.addEventListener("click",async()=>{$.disabled=!0,$.textContent="Syncing...";const a=await y("/api/mobile/v1/access/reconcile",{method:"POST"});a.ok?(m(a.data?.message||"Re-sync queued for device","success"),await r()):m(a.error?.message||"Re-sync failed","error"),$.disabled=!1,$.textContent="🔄 Re-sync Members"});const R=t.querySelector("#btn-bridge-pairing");R&&R.addEventListener("click",async()=>{R.disabled=!0;const a=await y("/api/mobile/v1/settings/bridge/pairing-code",{method:"POST"});R.disabled=!1,a.ok&&a.data?.pairing_code?await Q({title:"Bridge Pairing Code",message:`Your 6-digit pairing code is:

${a.data.pairing_code}

Valid for 10 minutes. Enter this code into RenewalDeskConnector.exe on your gym PC to connect.`,confirmText:"Done"}):m(a.error?.message||"Could not generate pairing code","error")}),t.querySelector("#btn-retry-sync")?.addEventListener("click",async()=>{const a=t.querySelector("#btn-retry-sync");a&&(a.disabled=!0);const _=await y("/api/mobile/v1/access/retry-sync",{method:"POST"});_.ok?(m(_.data?.message||"Commands queued for retry","success"),await r()):(m(_.error?.message||"Could not retry syncs","error"),a&&(a.disabled=!1))}),t.querySelector("#btn-clear-failed")?.addEventListener("click",async()=>{if(!confirm("Permanently delete all failed biometric commands? This cannot be undone."))return;const a=t.querySelector("#btn-clear-failed");a&&(a.disabled=!0);const _=await y("/api/mobile/v1/access/clear-failed",{method:"POST"});_.ok?(m(_.data?.message||"Failed commands cleared","success"),await r()):(m(_.error?.message||"Could not clear commands","error"),a&&(a.disabled=!1))}),T(t)}function w(){const e=document.createElement("div");e.className="modal-overlay center",e.innerHTML=`
        <div class="confirm-dialog" style="max-width:440px;width:90%;max-height:85vh;display:flex;flex-direction:column;padding:var(--sp-lg)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-md)">
            <div style="font-weight:var(--fw-bold);font-size:var(--fs-lg)">Manual Check In</div>
            <button id="modal-close" style="background:none;border:none;cursor:pointer;padding:4px">${M("close",20,"var(--muted)")}</button>
          </div>
          <div style="margin-bottom:var(--sp-md)">
            <input type="text" id="checkin-search" class="form-input" placeholder="Search member by name or phone..." style="width:100%" autofocus />
          </div>
          <div id="checkin-members-list" style="overflow-y:auto;max-height:50vh;display:flex;flex-direction:column;gap:var(--sp-xs)">
            <div style="text-align:center;padding:var(--sp-lg);color:var(--muted)">Loading active members...</div>
          </div>
        </div>
      `,document.body.appendChild(e),e.querySelector("#modal-close").onclick=()=>e.remove(),e.onclick=d=>{d.target===e&&e.remove()};const t=e.querySelector("#checkin-search"),n=e.querySelector("#checkin-members-list");let o=null;async function f(d=""){const b=`/api/mobile/v1/members?page_size=20&status=active${d?`&q=${encodeURIComponent(d)}`:""}`,s=await y(b);if(!s.ok){n.innerHTML='<div style="text-align:center;padding:var(--sp-md);color:var(--critical)">Failed to load members</div>';return}const S=s.data?.members||[];if(S.length===0){n.innerHTML=`<div style="text-align:center;padding:var(--sp-lg);color:var(--muted)">No members found matching "${c(d)}"</div>`;return}n.innerHTML=S.map(i=>`
          <div class="card card-body" style="padding:var(--sp-sm) var(--sp-md);display:flex;align-items:center;justify-content:space-between;gap:var(--sp-sm)">
            <div style="display:flex;align-items:center;gap:var(--sp-sm);min-width:0;flex:1">
              ${P(i.full_name||"Member","sm")}
              <div style="min-width:0">
                <div style="font-weight:var(--fw-semibold);font-size:var(--fs-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c(i.full_name)}</div>
                <div style="font-size:var(--fs-xs);color:var(--muted)">${c(i.phone||"")}${i.plan?` · ${c(i.plan.name)}`:""}</div>
              </div>
            </div>
            <button class="btn btn-primary btn-sm btn-do-checkin" data-mid="${i.id}" data-mname="${c(i.full_name)}" style="border-radius:var(--r-full);padding:4px 12px;font-size:var(--fs-xs);flex-shrink:0">
              Check In
            </button>
          </div>
        `).join(""),n.querySelectorAll(".btn-do-checkin").forEach(i=>{i.addEventListener("click",async()=>{const z=i.dataset.mid,k=i.dataset.mname;i.disabled=!0,i.textContent="Checking in...";const $=await B(z,"ENTRY");$.ok?(m(`${k} checked in successfully!`,"success"),e.remove(),await r()):(m($.error?.message||"Check-in failed","error"),i.disabled=!1,i.textContent="Check In")})})}t.addEventListener("input",d=>{clearTimeout(o),o=setTimeout(()=>{f(d.target.value.trim())},300)}),f()}u.innerHTML=`
      ${O({title:"Live Access",showBack:U.depth>1,actions:[{icon:"access",label:"Check In",onClick:()=>w()},{icon:"refresh",label:"Refresh",onClick:()=>r()}]})}
      <div class="scroll-view" id="ac-scroll">${H()}</div>
    `,F(u,{onBack:()=>{j.pop()},actions:[{icon:"access",onClick:()=>w()},{icon:"refresh",onClick:()=>r()}]}),await r(),G(u,r,15e3),window.__refreshAccess=()=>{document.body.contains(u)&&r()}},async unmount(){window.__refreshAccess=null}};async function V(u){const l=document.createElement("div");l.id="quick-assign-overlay",l.innerHTML=`
    <div class="qa-sheet">
      <div class="qa-handle"></div>
      <h3>Who is biometric ID ${c(u)}?</h3>
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
    </style>`,document.body.appendChild(l);const q=()=>l.remove();l.addEventListener("click",r=>{r.target===l&&q()}),l.querySelector("#qa-close").addEventListener("click",q);let g=[],p=1,h=0,x="",v=!1,E=!1;const L=l.querySelector("#qa-results"),C=l.querySelector("#qa-search"),A=()=>{const r=g.map(e=>`<div class="qa-row" data-qa-pick="${e.id}"><b>${c(e.full_name)}</b>${e.phone?`<span>${c(e.phone)}</span>`:""}</div>`).join(""),w=g.length<h?`<button id="qa-more" style="width:100%;padding:12px;border:none;background:none;color:#2563eb;font-weight:700;font-size:14px;cursor:pointer">Show more (${g.length} of ${h})</button>`:g.length?`<div style="padding:10px;text-align:center;color:#94a3b8;font-size:12px">Showing ${g.length} of ${h} members</div>`:"";L.innerHTML=g.length||w?r+w:'<div class="qa-empty">No members found</div>',L.querySelectorAll("[data-qa-pick]").forEach(e=>{e.addEventListener("click",async()=>{if(E)return;E=!0;const t=Number(e.dataset.qaPick);e.style.background="#dcfce7";const n=await y("/api/mobile/v1/rrr/mappings/bulk-resolve",{method:"POST",body:{mappings:[{external_id:u,member_id:t}]}});n.ok&&n.data.linked===1?(m(`ID ${u} linked ✓`),q(),window.__refreshAccess&&window.__refreshAccess()):(m(n.error?.message||"Link failed — try again","error"),e.style.background="",E=!1)})}),L.querySelector("#qa-more")?.addEventListener("click",()=>{p+=1,T(!1)})};async function T(r){if(v)return;v=!0,r&&(p=1,g=[]);const w=await y(`/api/mobile/v1/members?page=${p}&page_size=30${x?`&q=${encodeURIComponent(x)}`:""}`);if(v=!1,w.ok){const e=w.data.members||[];h=w.data.pagination?.total??(r?e.length:g.length+e.length);const t=new Set(g.map(n=>n.id));g=r?e:[...g,...e.filter(n=>!t.has(n.id))]}A()}let D;C.addEventListener("input",()=>{clearTimeout(D),D=setTimeout(()=>{x=C.value.trim(),T(!0)},300)}),T(!0),C.focus()}export{X as default};
