import{a as se,C as ne,u as W,b as ie,d as re,e as _,s as d,t as B,f as c,g as G,i as O,x as oe,G as de,D as X,n as J,T as Z}from"./index-Be_aVmFu.js";const pe={async mount(m){document.getElementById("quick-assign-overlay")?.remove();let l="all",z=null,w=0,g=1,q=0,C=1,b=[],h=[],E=0,x=1,L=1;const R=e=>e.id??`${e.member_id||""}|${e.biometric_user_id||e.device_enroll_number||""}|${e.event_timestamp||e.timestamp||e.created_at||""}`,F=e=>{const t=new Set;return e.filter(n=>{const o=R(n);return t.has(o)?!1:(t.add(o),!0)})};function S(e){return`
        <div class="list-item" style="cursor:pointer" data-event-member-id="${e.id}">
          ${X(e.full_name||"Member","sm")}
          <div class="list-item-content">
            <div class="list-item-title">${c(e.full_name)}</div>
            <div class="list-item-subtitle">Entered ${e.entered_at?B(e.entered_at):"—"}</div>
          </div>
          <button class="btn btn-secondary btn-sm" data-checkout-id="${e.id}" data-checkout-name="${c(e.full_name)}">Check Out</button>
        </div>`}let I=!1,p=!1,T=null,M=!1;function P(e){const t=(e.event_type||"ENTRY").toUpperCase(),n=t==="ENTRY"||t==="ATTENDANCE",o=t==="ACCESS_DENIED",v=o?"var(--critical-surface)":n?"var(--success-surface)":"var(--gray-100)",r=o?"var(--critical)":n?"var(--success)":"var(--muted)",y=o?"alert":n?"forward":"back",f=o?"expired":n?"active":"info",u=o?"Denied":t==="ATTENDANCE"?"Check In":n?"Entry":"Exit",i=e.biometric_user_id||e.device_enroll_number,A=!e.member_id&&i,s=e.member_id?c(e.member_name||"Unknown"):i?`Unknown · ID ${c(i)}`:"Unknown";return`
        <div class="list-item" style="cursor:pointer" data-event-member-id="${e.member_id||""}" data-bio-id="${!e.member_id&&i?c(i):""}">
          <div style="width:34px;height:34px;border-radius:var(--r-full);background:${v};display:flex;align-items:center;justify-content:center;flex-shrink:0">
            ${O(y,16,r)}
          </div>
          <div class="list-item-content">
            <div class="list-item-title">${s}${A?' <span style="font-size:11px;color:#3b82f6;font-weight:700">· tap to assign</span>':""}</div>
            <div class="list-item-subtitle">${B(e.event_timestamp||e.timestamp||e.created_at)}${e.device_name?` · ${c(e.device_name)}`:""}</div>
          </div>
          <span class="badge badge-${f}">${u}</span>
        </div>
      `}function Y(e){e.querySelectorAll("[data-event-member-id]").forEach(t=>{t.dataset.wired||(t.dataset.wired="1",t.addEventListener("click",()=>{const n=t.dataset.eventMemberId,o=t.dataset.bioId;n?J.push("member-detail",{memberId:n}):o&&le(o)}))}),e.querySelectorAll("[data-checkout-id]").forEach(t=>{t.dataset.wired||(t.dataset.wired="1",t.addEventListener("click",async n=>{n.stopPropagation();const o=t.dataset.checkoutId,v=t.dataset.checkoutName;t.disabled=!0,t.textContent="Checking out...";const r=await Z(o,"EXIT");r.ok&&r.data?.event_type==="ACCESS_DENIED"?(d(r.message||r.data?.message||`${v} was denied access — membership is not active.`,"error"),t.disabled=!1,t.textContent="Check Out"):r.ok?(d(`${v} checked out`,"success"),await k()):(d(r.error?.message||"Check-out failed","error"),t.disabled=!1,t.textContent="Check Out")}))})}async function ee(){if(g>=C)return;const e=m.querySelector("#ac-load-more");e&&(e.disabled=!0,e.textContent="Loading…");const t=g+1,n=await _(`/api/mobile/v1/access/events?page=${t}&per_page=25${l==="all"?"":`&type=${l}`}`);if(!n.ok){d(n.error?.message||"Could not load more events.","error"),e&&(e.disabled=!1,e.textContent="Load more events");return}g=n.data?.pagination?.page??t,C=n.data?.pagination?.total_pages??C,q=n.data?.pagination?.total??q;const o=n.data?.events||n.data?.log||[],v=new Set(b.map(R)),r=o.filter(i=>{const A=R(i);return v.has(A)?!1:(v.add(A),!0)});b=[...b,...r];const y=m.querySelector("#ac-events-card");y&&(y.insertAdjacentHTML("beforeend",r.map(P).join("")),Y(y));const f=m.querySelector("#ac-feed-count");f&&(f.textContent=`Showing ${b.length} of ${q} events`);const u=m.querySelector("#ac-more-wrap");u&&(u.style.display=g<C?"":"none"),e&&(e.disabled=!1,e.textContent="Load more events")}async function te(){if(x>=L)return;const e=m.querySelector("#ac-inside-more");e&&(e.disabled=!0,e.textContent="Loading…");const t=x+1,n=await _(`/api/mobile/v1/access/inside?page=${t}&per_page=50`);if(!n.ok){d(n.error?.message||"Could not load more members inside.","error"),e&&(e.disabled=!1,e.textContent="Load more");return}x=n.data?.pagination?.page??t,L=n.data?.pagination?.total_pages??L,E=n.data?.pagination?.total??E;const o=new Set(h.map(u=>u.id)),v=(n.data?.members||[]).filter(u=>o.has(u.id)?!1:(o.add(u.id),!0));h=[...h,...v];const r=m.querySelector("#ac-inside-list");r&&(r.insertAdjacentHTML("beforeend",v.map(S).join("")),Y(r));const y=m.querySelector("#ac-inside-count");y&&(y.textContent=`Showing ${h.length} of ${E} inside now`);const f=m.querySelector("#ac-inside-more-wrap");f&&(f.style.display=x<L?"":"none"),e&&(e.disabled=!1,e.textContent="Load more")}async function k(){const e=++w,t=m.querySelector("#ac-scroll");if(!t)return;const n=a=>`/api/mobile/v1/access/events?page=${a}&per_page=25${l==="all"?"":`&type=${l}`}`,o=a=>`/api/mobile/v1/access/inside?page=${a}&per_page=50`,[v,...r]=await Promise.all([_("/api/mobile/v1/access/summary"),...Array.from({length:x},(a,$)=>_(o($+1))),...Array.from({length:g},(a,$)=>_(n($+1)))]);if(e!==w||m.dataset.screenDisposed==="true")return;const y=r.slice(0,x),f=y[y.length-1],u=r.slice(x),i=u[u.length-1],A=[...u].reverse().find(a=>a.ok);if(i.ok)I=!1;else if(I||(I=!0,d("Could not refresh the access feed — showing the last loaded events.","error")),z)return;const s=v.ok?v.data:z||{};z=s,v.ok?(p=!1,T=new Date):z&&!p&&(p=!0,d("Could not refresh the access summary — showing the last loaded stats.","error"));const D=!v.ok&&!!z,ae=i.ok?i.data?.events||i.data?.log||[]:[],Q=i.ok?i.data?.pagination||{}:{};if(q=Q.total??A?.data?.pagination?.total??q,C=Q.total_pages??C,g=Q.page??g,b=F(u.slice(0,-1).flatMap(a=>a.ok?a.data?.events||a.data?.log||[]:[]).concat(ae)),y.some(a=>!a.ok)){M||(M=!0,d("Could not refresh the inside-now list — showing the last loaded members.","error"));const a=y.flatMap(N=>N.ok?N.data?.members||[]:[]),$=new Map(h.map(N=>[N.id,N]));a.forEach(N=>$.set(N.id,N)),h=[...$.values()]}else M=!1,h=[...new Map(y.flatMap(a=>a.ok?a.data?.members||[]:[]).map(a=>[a.id,a])).values()];E=f.ok?f.data?.pagination?.total??h.length:E,L=f.ok?f.data?.pagination?.total_pages??L:L,x=f.ok?f.data?.pagination?.page??x:x;const V=s.last_event_at?B(s.last_event_at):s.last_heartbeat?`Heartbeat: ${B(s.last_heartbeat)}`:"";t.innerHTML=`
        <div class="scroll-content">
          <!-- Summary Card -->
          <div style="padding:var(--sp-lg)">
            <div class="card card-body" style="text-align:center">
              <div style="display:flex;align-items:center;justify-content:center;gap:var(--sp-sm);margin-bottom:var(--sp-sm)">
                <span style="width:10px;height:10px;border-radius:50%;background:${s.device_online?"var(--success)":"var(--muted)"}"></span>
                <span style="font-weight:var(--fw-bold);font-size:var(--fs-base)">${s.device_online?"Biometric Device Online":"Biometric Device Offline"}</span>
                ${s.device_name?`<span style="font-size:var(--fs-xs);color:var(--muted)">· ${c(s.device_name)}</span>`:""}
              </div>
              ${V?`<div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:var(--sp-md)">Last event: ${c(V)}</div>`:'<div style="margin-bottom:var(--sp-md)"></div>'}
              ${D?`<div style="font-size:var(--fs-xs);color:var(--warning);margin-bottom:var(--sp-md)">Stats from ${T?c(B(T.toISOString())):"an earlier load"} — could not refresh.</div>`:""}
              <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:var(--sp-lg)">
                <div style="cursor:pointer" id="stat-entries">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--brand)">${G(s.entries_today||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Entries</div>
                </div>
                <div style="cursor:pointer" id="stat-exits">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--warning)">${G(s.exits_today||0)}</div>
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
              <p style="font-size:var(--fs-xs);color:var(--muted);margin:0">${s.adms_online?s.adms_commands_enabled?"Terminal polled recently. Membership block/restore commands are enabled.":"Terminal polled recently, but automatic membership commands are not enabled yet.":`No recent terminal poll${s.adms_last_seen_at?` (last seen ${c(B(s.adms_last_seen_at))})`:""}. It cannot receive block/unblock commands until it reconnects.`}</p>
            </div>
            `:""}

            ${s.failed_commands>0?`
              <div class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);background:rgba(245,158,11,0.1);border-color:rgba(245,158,11,0.3);display:flex;align-items:center;justify-content:space-between">
                <div style="font-size:var(--fs-xs);color:#B45309;display:flex;align-items:center;gap:var(--sp-xs)">
                  ${O("alert",16,"#B45309")}
                  <span><strong>${G(s.failed_commands)} command(s)</strong> failed to sync</span>
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
                  ${O("alert",18,"var(--critical)")}
                  <span style="font-size:var(--fs-sm);font-weight:var(--fw-semibold);color:var(--critical)">${G(s.denied_today)} access denied event${s.denied_today>1?"s":""} today</span>
                </div>
                ${O("forward",14,"var(--critical)")}
              </div>
            `:""}

            ${!s.device_online&&(s.inside_now||0)===0&&(s.entries_today||0)===0?`
              <div style="margin-top:var(--sp-md);padding:var(--sp-sm) var(--sp-md);background:var(--gray-50, #f8f9fa);border:1px dashed var(--border);border-radius:var(--r-md);font-size:var(--fs-xs);color:var(--muted);text-align:center">
                💡 Tip: Tap <b>"+ Check In Member"</b> above to log attendance manually anytime, or connect your biometric turnstile/machine.
              </div>
            `:""}
          </div>

          <!-- Inside Now (V3-M21) — from /access/inside, not the feed -->
          ${h.length?`
            <div class="card" style="margin:var(--sp-md) var(--sp-lg) 0">
              <div style="padding:var(--sp-md) var(--sp-md) var(--sp-xs);font-weight:var(--fw-bold);font-size:var(--fs-sm)">Inside now (${E})</div>
              <div id="ac-inside-list">${h.map(S).join("")}</div>
              <div id="ac-inside-count" style="padding:var(--sp-sm) 0;font-size:var(--fs-sm);color:var(--muted);text-align:center">Showing ${h.length} of ${E} inside now</div>
              ${x<L?'<div id="ac-inside-more-wrap" style="text-align:center;padding:var(--sp-md)"><button class="btn btn-secondary" id="ac-inside-more">Load more</button></div>':""}
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
            ${b.length>0?`
              <div class="card" id="ac-events-card" style="margin:0 var(--sp-lg)">
                ${b.map(P).join("")}
              </div>
              <div id="ac-feed-count" style="padding:var(--sp-sm) 0;font-size:var(--fs-sm);color:var(--muted);text-align:center">Showing ${b.length} of ${q} events</div>
              ${g<C?'<div id="ac-more-wrap" style="text-align:center;padding:var(--sp-md)"><button class="btn btn-secondary" id="ac-load-more">Load more events</button></div>':""}
            `:oe({icon:"access",title:"No events",text:"Live access and check-in events will appear here"})}
          `}
        </div>
      `,t.querySelectorAll("[data-tab]").forEach(a=>{a.addEventListener("click",()=>{l=a.dataset.tab,g=1,b=[],t.innerHTML=W(),k()})}),t.querySelector("#ac-load-more")?.addEventListener("click",ee),t.querySelector("#ac-inside-more")?.addEventListener("click",te),t.querySelector("#stat-entries")?.addEventListener("click",()=>{l="entry",g=1,b=[],k()}),t.querySelector("#stat-exits")?.addEventListener("click",()=>{l="exit",g=1,b=[],k()}),t.querySelector("#banner-denied")?.addEventListener("click",()=>{l="denied",g=1,b=[],k()});const H=t.querySelector("#btn-remote-unlock");H&&H.addEventListener("click",async()=>{if(!window.confirm("Unlock the gym gate for 5 seconds?"))return;H.disabled=!0,H.textContent="Sending unlock...";const a=await _("/api/mobile/v1/access/remote-unlock",{method:"POST",body:{delay_seconds:5,confirm:!0}});a.ok?d(a.data?.message||"Unlock command queued. Waiting for terminal acknowledgement.","success"):d(a.error?.message||"Could not unlock door","error"),H.disabled=!1,H.textContent="🔓 Unlock Gate"});const j=t.querySelector("#btn-reconcile-all");j&&j.addEventListener("click",async()=>{j.disabled=!0,j.textContent="Syncing...";const a=await _("/api/mobile/v1/access/reconcile",{method:"POST"});a.ok?(d(a.data?.message||"Re-sync queued for device","success"),await k()):d(a.error?.message||"Re-sync failed","error"),j.disabled=!1,j.textContent="🔄 Re-sync Members"});const U=t.querySelector("#btn-bridge-pairing");U&&U.addEventListener("click",async()=>{U.disabled=!0;const a=await _("/api/mobile/v1/settings/bridge/pairing-code",{method:"POST"});U.disabled=!1,a.ok&&a.data?.pairing_code?await de({title:"Bridge Pairing Code",message:`Your 6-digit pairing code is:

${a.data.pairing_code}

Valid for 10 minutes. Enter this code into RenewalDeskConnector.exe on your gym PC to connect.`,confirmText:"Done"}):d(a.error?.message||"Could not generate pairing code","error")}),t.querySelector("#btn-retry-sync")?.addEventListener("click",async()=>{const a=t.querySelector("#btn-retry-sync");a&&(a.disabled=!0);const $=await _("/api/mobile/v1/access/retry-sync",{method:"POST"});$.ok?(d($.data?.message||"Commands queued for retry","success"),await k()):(d($.error?.message||"Could not retry syncs","error"),a&&(a.disabled=!1))}),t.querySelector("#btn-clear-failed")?.addEventListener("click",async()=>{if(!confirm("Permanently delete all failed biometric commands? This cannot be undone."))return;const a=t.querySelector("#btn-clear-failed");a&&(a.disabled=!0);const $=await _("/api/mobile/v1/access/clear-failed",{method:"POST"});$.ok?(d($.data?.message||"Failed commands cleared","success"),await k()):(d($.error?.message||"Could not clear commands","error"),a&&(a.disabled=!1))}),Y(t)}function K(){const e=document.createElement("div");e.className="modal-overlay center",e.innerHTML=`
        <div class="confirm-dialog" style="max-width:440px;width:90%;max-height:85vh;display:flex;flex-direction:column;padding:var(--sp-lg)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-md)">
            <div style="font-weight:var(--fw-bold);font-size:var(--fs-lg)">Manual Check In</div>
            <button id="modal-close" style="background:none;border:none;cursor:pointer;padding:4px">${O("close",20,"var(--muted)")}</button>
          </div>
          <div style="margin-bottom:var(--sp-md)">
            <input type="text" id="checkin-search" class="form-input" placeholder="Search member by name or phone..." style="width:100%" autofocus />
          </div>
          <div id="checkin-members-list" style="overflow-y:auto;max-height:50vh;display:flex;flex-direction:column;gap:var(--sp-xs)">
            <div style="text-align:center;padding:var(--sp-lg);color:var(--muted)">Loading active members...</div>
          </div>
        </div>
      `,document.body.appendChild(e),e.querySelector("#modal-close").onclick=()=>e.remove(),e.onclick=r=>{r.target===e&&e.remove()};const t=e.querySelector("#checkin-search"),n=e.querySelector("#checkin-members-list");let o=null;async function v(r=""){const y=`/api/mobile/v1/members?page_size=20&status=active${r?`&q=${encodeURIComponent(r)}`:""}`,f=await _(y);if(!f.ok){n.innerHTML='<div style="text-align:center;padding:var(--sp-md);color:var(--critical)">Failed to load members</div>';return}const u=f.data?.members||[];if(u.length===0){n.innerHTML=`<div style="text-align:center;padding:var(--sp-lg);color:var(--muted)">No members found matching "${c(r)}"</div>`;return}n.innerHTML=u.map(i=>`
          <div class="card card-body" style="padding:var(--sp-sm) var(--sp-md);display:flex;align-items:center;justify-content:space-between;gap:var(--sp-sm)">
            <div style="display:flex;align-items:center;gap:var(--sp-sm);min-width:0;flex:1">
              ${X(i.full_name||"Member","sm")}
              <div style="min-width:0">
                <div style="font-weight:var(--fw-semibold);font-size:var(--fs-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c(i.full_name)}</div>
                <div style="font-size:var(--fs-xs);color:var(--muted)">${c(i.phone||"")}${i.plan?` · ${c(i.plan.name)}`:""}</div>
              </div>
            </div>
            <button class="btn btn-primary btn-sm btn-do-checkin" data-mid="${i.id}" data-mname="${c(i.full_name)}" style="border-radius:var(--r-full);padding:4px 12px;font-size:var(--fs-xs);flex-shrink:0">
              Check In
            </button>
          </div>
        `).join(""),n.querySelectorAll(".btn-do-checkin").forEach(i=>{i.addEventListener("click",async()=>{const A=i.dataset.mid,s=i.dataset.mname;i.disabled=!0,i.textContent="Checking in...";const D=await Z(A,"ENTRY");D.ok&&D.data?.event_type==="ACCESS_DENIED"?(d(D.message||D.data?.message||`${s} was denied access — membership is not active.`,"error"),i.disabled=!1,i.textContent="Check In"):D.ok?(d(`${s} checked in successfully!`,"success"),e.remove(),await k()):(d(D.error?.message||"Check-in failed","error"),i.disabled=!1,i.textContent="Check In")})})}t.addEventListener("input",r=>{clearTimeout(o),o=setTimeout(()=>{v(r.target.value.trim())},300)}),v()}m.innerHTML=`
      ${se({title:"Live Access",showBack:ne.depth>1,actions:[{icon:"access",label:"Check In",onClick:()=>K()},{icon:"refresh",label:"Refresh",onClick:()=>k()}]})}
      <div class="scroll-view" id="ac-scroll">${W()}</div>
    `,ie(m,{onBack:()=>{J.pop()},actions:[{icon:"access",onClick:()=>K()},{icon:"refresh",onClick:()=>k()}]}),await k(),re(m,k,15e3),window.__refreshAccess=()=>{document.body.contains(m)&&k()}},async unmount(){window.__refreshAccess=null}};async function le(m){const l=document.createElement("div");l.id="quick-assign-overlay",l.innerHTML=`
    <div class="qa-sheet">
      <div class="qa-handle"></div>
      <h3>Who is biometric ID ${c(m)}?</h3>
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
    </style>`,document.body.appendChild(l);const z=()=>l.remove();l.addEventListener("click",S=>{S.target===l&&z()}),l.querySelector("#qa-close").addEventListener("click",z);let w=[],g=1,q=0,C="",b=!1,h=!1;const E=l.querySelector("#qa-results"),x=l.querySelector("#qa-search"),L=()=>{const S=w.map(p=>`<div class="qa-row" data-qa-pick="${p.id}"><b>${c(p.full_name)}</b>${p.phone?`<span>${c(p.phone)}</span>`:""}</div>`).join(""),I=w.length<q?`<button id="qa-more" style="width:100%;padding:12px;border:none;background:none;color:#2563eb;font-weight:700;font-size:14px;cursor:pointer">Show more (${w.length} of ${q})</button>`:w.length?`<div style="padding:10px;text-align:center;color:#94a3b8;font-size:12px">Showing ${w.length} of ${q} members</div>`:"";E.innerHTML=w.length||I?S+I:'<div class="qa-empty">No members found</div>',E.querySelectorAll("[data-qa-pick]").forEach(p=>{p.addEventListener("click",async()=>{if(h)return;h=!0;const T=Number(p.dataset.qaPick);p.style.background="#dcfce7";const M=await _("/api/mobile/v1/rrr/mappings/bulk-resolve",{method:"POST",body:{mappings:[{external_id:m,member_id:T}]}});M.ok&&M.data.linked===1?(d(`ID ${m} linked ✓`),z(),window.__refreshAccess&&window.__refreshAccess()):(d(M.error?.message||"Link failed — try again","error"),p.style.background="",h=!1)})}),E.querySelector("#qa-more")?.addEventListener("click",()=>{R(!1)})};async function R(S){if(b)return;b=!0;const I=S?1:g+1,p=await _(`/api/mobile/v1/members?page=${I}&page_size=30${C?`&q=${encodeURIComponent(C)}`:""}`);if(b=!1,p.ok){S&&(g=1,w=[]);const T=p.data.members||[];q=p.data.pagination?.total??(S?T.length:w.length+T.length);const M=new Set(w.map(P=>P.id));w=S?T:[...w,...T.filter(P=>!M.has(P.id))],g=I}else d(p.error?.message||"Could not load more members.","error");L()}let F;x.addEventListener("input",()=>{clearTimeout(F),F=setTimeout(()=>{C=x.value.trim(),R(!0)},300)}),R(!0),x.focus()}export{pe as default};
