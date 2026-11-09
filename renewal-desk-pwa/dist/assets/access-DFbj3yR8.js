import{o as W,a as J,F as X,x as Q,b as Z,d as ee,e as _,z as te,s as o,w as P,f as d,k as D,i as B,A as ae,u as se,n as Y,g as ne,M as K,G as re,V as ie}from"./index-DYUtf5t4.js";const le={async mount(h){document.getElementById("quick-assign-overlay")?.remove();let c="all",E=null,x=0,p=1,$=0,q=1,v=[];const z=t=>t.punch_key||(t.id??`${t.member_id||""}|${t.biometric_user_id||t.device_enroll_number||""}|${t.event_timestamp||t.timestamp||t.created_at||""}`),j=t=>{const s=new Set;return t.filter(n=>{const r=z(n);return s.has(r)?!1:(s.add(r),!0)})};let I=!1,H=!1,A=!1,M=null,l=null;const R={test_action:{label:"test command",plural:"test commands"},unlock_door:{label:"door unlock",plural:"door unlocks"},unresolvable_member:{label:"unknown member",plural:"unknown members"},requeue_failed:{label:"could not re-queue",plural:"could not re-queue"},unsupported_action:{label:"other command",plural:"other commands"},commands_disabled:{label:"commands disabled",plural:"commands disabled"},terminal_never_polled:{label:"terminal never connected",plural:"terminals never connected"},no_terminal_identity:{label:"no terminal identity",plural:"no terminal identities"},not_enableable:{label:"member not eligible",plural:"members not eligible"}};function u(t){const s={};for(const n of t||[])s[n.reason]=(s[n.reason]||0)+1;return Object.entries(s).map(([n,r])=>{const g=R[n]||{label:"other command",plural:"other commands"};return`${r} ${r>1?g.plural:g.label}`}).join(", ")}const S=W()?.userRole!=="staff";function T(t){const s=(t.event_type||"ENTRY").toUpperCase(),n=s==="ENTRY"||s==="ATTENDANCE",r=s==="ACCESS_DENIED",g=r?"var(--critical-surface)":n?"var(--success-surface)":"var(--gray-100)",f=r?"var(--critical)":n?"var(--success)":"var(--muted)",y=r?"alert":n?"forward":"back",a=r?"expired":n?"active":"info",C=r?"Denied":s==="ATTENDANCE"?"Check In":n?"Entry":"Exit",w=t.biometric_user_id||t.device_enroll_number,i=!t.member_id&&w,O=t.member_id?d(t.member_name||"Unknown"):w?`Unknown · ID ${d(w)}`:"Unknown";return`
        <div class="list-item" style="cursor:pointer" data-event-member-id="${t.member_id||""}" data-bio-id="${!t.member_id&&w?d(w):""}">
          <div style="width:34px;height:34px;border-radius:var(--r-full);background:${g};display:flex;align-items:center;justify-content:center;flex-shrink:0">
            ${B(y,16,f)}
          </div>
          <div class="list-item-content">
            <div class="list-item-title">${O}${i?' <span style="font-size:11px;color:#3b82f6;font-weight:700">· tap to assign</span>':""}</div>
            <div class="list-item-subtitle">${P(t.event_timestamp||t.timestamp||t.created_at)}${t.device_name?` · ${d(t.device_name)}`:""}</div>
          </div>
          <span class="badge badge-${a}">${C}</span>
        </div>
      `}function N(t){t.querySelectorAll("[data-event-member-id]").forEach(s=>{s.dataset.wired||(s.dataset.wired="1",s.addEventListener("click",()=>{const n=s.dataset.eventMemberId,r=s.dataset.bioId;n?Y.push("member-detail",{memberId:n}):r&&oe(r)}))})}async function V(){if(p>=q)return;const t=h.querySelector("#ac-load-more");t&&(t.disabled=!0,t.textContent="Loading…");const s=p+1,n=await _(`/api/mobile/v1/access/events?page=${s}&per_page=25${c==="all"?"":`&type=${c}`}`);if(!n.ok){o(n.error?.message||"Could not load more events.","error"),t&&(t.disabled=!1,t.textContent="Load more events");return}p=n.data?.pagination?.page??s,q=n.data?.pagination?.total_pages??q,$=n.data?.pagination?.total??$;const r=n.data?.events||n.data?.log||[],g=new Set(v.map(z)),f=r.filter(w=>{const i=z(w);return g.has(i)?!1:(g.add(i),!0)});v=[...v,...f];const y=h.querySelector("#ac-events-card");y&&(y.insertAdjacentHTML("beforeend",f.map(T).join("")),N(y));const a=h.querySelector("#ac-feed-count");a&&(a.textContent=`Showing ${v.length} of ${$} events`);const C=h.querySelector("#ac-more-wrap");C&&(C.style.display=p<q?"":"none"),t&&(t.disabled=!1,t.textContent="Load more events")}async function b(){const t=++x,s=h.querySelector("#ac-scroll");if(!s)return;const n=e=>`/api/mobile/v1/access/events?page=${e}&per_page=25${c==="all"?"":`&type=${c}`}`,[r,...g]=await Promise.all([_("/api/mobile/v1/access/summary"),...Array.from({length:p},(e,m)=>_(n(m+1)))]);if(t!==x||h.dataset.screenDisposed==="true")return;const f=g[g.length-1],y=[...g].reverse().find(e=>e.ok);if(!H&&(!r.ok||!f.ok)){const e=(r.ok?f.error?.message:r.error?.message)||"Check your connection and try again.";s.innerHTML=te(e),s.querySelector("#retry-btn")?.addEventListener("click",b);return}if(f.ok)I=!1;else if(I||(I=!0,o("Could not refresh the access feed — showing the last loaded events.","error")),E)return;const a=r.ok?r.data:E||{};E=a,r.ok?(A=!1,M=new Date):E&&!A&&(A=!0,o("Could not refresh the access summary — showing the last loaded stats.","error"));const C=!r.ok&&!!E,w=f.ok?f.data?.events||f.data?.log||[]:[],i=f.ok?f.data?.pagination||{}:{};$=i.total??y?.data?.pagination?.total??$,q=i.total_pages??q,p=i.page??p,v=j(g.slice(0,-1).flatMap(e=>e.ok?e.data?.events||e.data?.log||[]:[]).concat(w));const O=a.last_event_at?P(a.last_event_at):a.last_heartbeat?`Heartbeat: ${P(a.last_heartbeat)}`:"";s.innerHTML=`
        <div class="scroll-content">
          <!-- Summary Card -->
          <div style="padding:var(--sp-lg)">
            <div class="card card-body" style="text-align:center">
              <div style="display:flex;align-items:center;justify-content:center;gap:var(--sp-sm);margin-bottom:var(--sp-sm)">
                <span style="width:10px;height:10px;border-radius:50%;background:${a.device_online?"var(--success)":"var(--muted)"}"></span>
                <span style="font-weight:var(--fw-bold);font-size:var(--fs-base)">${a.device_online?"Biometric Device Online":"Biometric Device Offline"}</span>
                ${a.device_name?`<span style="font-size:var(--fs-xs);color:var(--muted)">· ${d(a.device_name)}</span>`:""}
              </div>
              ${O?`<div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:var(--sp-md)">Last event: ${d(O)}</div>`:'<div style="margin-bottom:var(--sp-md)"></div>'}
              ${C?`<div style="font-size:var(--fs-xs);color:var(--warning);margin-bottom:var(--sp-md)">${M?`Stats from ${d(P(M.toISOString()))} — could not refresh.`:"Stats could not be refreshed — showing the last loaded stats."}</div>`:""}
              <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:var(--sp-lg)">
                <div style="cursor:pointer" id="stat-entries">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--brand)">${D(a.entries_today||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Entries</div>
                </div>
                <div style="cursor:pointer" id="stat-exits">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--warning)">${D(a.exits_today||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Exits</div>
                </div>
              </div>

              ${a.remote_unlock_available?`
              <!-- Remote Physical Gate Control -->
              <div style="margin-top:var(--sp-lg);padding-top:var(--sp-md);border-top:1px solid var(--border);display:grid;grid-template-columns:1fr;gap:var(--sp-sm)">
                <button class="btn" id="btn-remote-unlock" style="font-weight:var(--fw-semibold);display:flex;align-items:center;justify-content:center;gap:var(--sp-xs);font-size:var(--fs-xs);background:#16a34a;color:white;border:none">
                  🔓 Unlock Gate
                </button>
              </div>
              `:""}
            </div>

            ${a.adms_integration_id?"":`
            <!-- Hardware Bridge Controls (only when NOT on Direct Cloud) -->
            <div class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);display:flex;flex-direction:column;gap:var(--sp-sm)">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <div style="font-weight:var(--fw-bold);font-size:var(--fs-xs);text-transform:uppercase;color:var(--muted);letter-spacing:0.5px">Hardware Bridge Controls</div>
                <span style="font-size:10px;font-weight:var(--fw-bold);padding:2px 8px;border-radius:12px;background:${a.bridge_online?"#dcfce7":"#fee2e2"};color:${a.bridge_online?"#15803d":"#b91c1c"}">
                  ${a.bridge_online?"BRIDGE ONLINE":"BRIDGE OFFLINE"}
                </span>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-xs)">
                ${S?'<button class="btn btn-secondary btn-sm" id="btn-reconcile-all" style="font-size:var(--fs-xs);padding:6px 10px">🔄 Re-sync Members</button>':""}
                <button class="btn btn-secondary btn-sm" id="btn-bridge-pairing" style="font-size:var(--fs-xs);padding:6px 10px">🔑 Pairing Code</button>
              </div>
            </div>
            `}

            ${a.adms_integration_id?`
            <!-- Direct Cloud (ADMS) Status -->
            <div class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);display:flex;flex-direction:column;gap:var(--sp-sm)">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <div style="font-weight:var(--fw-bold);font-size:var(--fs-xs);text-transform:uppercase;color:var(--muted);letter-spacing:0.5px">Direct Cloud Terminal</div>
                <span style="font-size:10px;font-weight:var(--fw-bold);padding:2px 8px;border-radius:12px;background:${a.adms_online?"#dcfce7":"#fee2e2"};color:${a.adms_online?"#15803d":"#b91c1c"}">
                  ${a.adms_online?"ONLINE":"OFFLINE"}
                </span>
              </div>
              ${a.adms_device_name?`<div style="font-size:var(--fs-xs);color:var(--muted)">${d(a.adms_device_name)}</div>`:""}
              <p style="font-size:var(--fs-xs);color:var(--muted);margin:0">${a.adms_online?a.adms_commands_enabled?"Terminal polled recently. Membership block/restore commands are enabled.":"Terminal polled recently, but automatic membership commands are not enabled yet.":`No recent terminal poll${a.adms_last_seen_at?` (last seen ${d(P(a.adms_last_seen_at))})`:""}. It cannot receive block/unblock commands until it reconnects.`}</p>
            </div>
            `:""}

            ${a.failed_commands>0?`
              <div class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);background:rgba(245,158,11,0.1);border-color:rgba(245,158,11,0.3);display:flex;align-items:center;justify-content:space-between">
                <div style="font-size:var(--fs-xs);color:#B45309;display:flex;align-items:center;gap:var(--sp-xs)">
                  ${B("alert",16,"#B45309")}
                  <span><strong>${D(a.failed_commands)} command(s)</strong> failed to sync</span>
                </div>
                ${S?`<div style="display:flex;gap:8px">
                  <button class="btn btn-sm btn-primary" id="btn-retry-sync" style="font-size:var(--fs-xs);padding:4px 10px">Retry All</button>
                  <button class="btn btn-sm" id="btn-clear-failed" style="font-size:var(--fs-xs);padding:4px 10px;background:#FEE2E2;color:#B91C1C;border:1px solid #FECACA">Clear</button>
                </div>`:""}
              </div>
            `:""}

            ${Array.isArray(a.queued_adms_commands?.commands)&&a.queued_adms_commands.commands.length?`
              <div class="card" id="queued-commands" style="margin-top:var(--sp-md);padding:var(--sp-md)">
                <div style="font-weight:var(--fw-bold);font-size:var(--fs-xs);text-transform:uppercase;color:var(--muted);letter-spacing:0.5px;margin-bottom:var(--sp-sm)">Queued door commands (${D(a.queued_adms_commands.count??a.queued_adms_commands.commands.length)})</div>
                ${a.queued_adms_commands.commands.map(e=>`
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--sp-sm);padding:var(--sp-xs) 0;border-top:1px solid var(--border)">
                    <div style="font-size:var(--fs-sm);min-width:0">
                      <div style="font-weight:var(--fw-semibold)">${d(e.action||"command")}${e.enroll_number!=null?` · ID ${d(String(e.enroll_number))}`:""}</div>
                      ${e.queued_at?`<div style="font-size:var(--fs-xs);color:var(--muted)">Queued ${d(P(e.queued_at))}</div>`:""}
                    </div>
                    ${S?`<button class="btn btn-sm" data-cancel-adms="${e.id}" style="font-size:var(--fs-xs);padding:4px 10px;flex-shrink:0">Cancel</button>`:""}
                  </div>`).join("")}
              </div>
            `:""}

            ${l?`
              <div id="retry-reasons" class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);font-size:var(--fs-xs);color:var(--muted)">
                <div style="font-weight:var(--fw-semibold);color:#B45309">Retry All result: ${D(l.retried_count||0)} queued${l.skipped_count?`, ${D(l.skipped_count)} skipped`:""}${l.retried_at?` · Retried ${d(ne(l.retried_at))}`:""}</div>
                ${l.skipped_count>0?`<div style="margin-top:var(--sp-xs)">Skipped — ${d(u(l.skipped))}.</div>`:""}
              </div>
            `:""}

            ${a.denied_today>0?`
              <div class="card" id="banner-denied" style="margin-top:var(--sp-md);padding:var(--sp-md);background:var(--critical-surface);border-color:var(--critical-border);display:flex;align-items:center;justify-content:space-between;cursor:pointer">
                <div style="display:flex;align-items:center;gap:var(--sp-sm)">
                  ${B("alert",18,"var(--critical)")}
                  <span style="font-size:var(--fs-sm);font-weight:var(--fw-semibold);color:var(--critical)">${D(a.denied_today)} access denied event${a.denied_today>1?"s":""} today</span>
                </div>
                ${B("forward",14,"var(--critical)")}
              </div>
            `:""}

            ${!a.device_online&&(a.inside_now||0)===0&&(a.entries_today||0)===0?`
              <div style="margin-top:var(--sp-md);padding:var(--sp-sm) var(--sp-md);background:var(--gray-50, #f8f9fa);border:1px dashed var(--border);border-radius:var(--r-md);font-size:var(--fs-xs);color:var(--muted);text-align:center">
                💡 Tip: Tap <b>"+ Check In Member"</b> above to log attendance manually anytime, or connect your biometric turnstile/machine.
              </div>
            `:""}
          </div>

          <!-- Filter Tabs -->
          <div style="display:flex;gap:var(--sp-xs);padding:0 var(--sp-lg) var(--sp-md);overflow-x:auto;-webkit-overflow-scrolling:touch">
            ${[{id:"all",label:"All Events"},{id:"entry",label:"Entries"},{id:"exit",label:"Exits"},{id:"denied",label:"Denied"}].map(e=>`
              <button class="btn btn-sm ${c===e.id?"btn-primary":"btn-secondary"}" data-tab="${e.id}" style="border-radius:var(--r-full);white-space:nowrap;padding:4px 12px;font-size:var(--fs-xs)">
                ${e.label}
              </button>
            `).join("")}
          </div>

          <!-- List Section -->
          ${`
            ${v.length>0?`
              <div class="card" id="ac-events-card" style="margin:0 var(--sp-lg)">
                ${v.map(T).join("")}
              </div>
              <div id="ac-feed-count" style="padding:var(--sp-sm) 0;font-size:var(--fs-sm);color:var(--muted);text-align:center">Showing ${v.length} of ${$} events</div>
              ${p<q?'<div id="ac-more-wrap" style="text-align:center;padding:var(--sp-md)"><button class="btn btn-secondary" id="ac-load-more">Load more events</button></div>':""}
            `:ae({icon:"access",title:"No events",text:"Live access and check-in events will appear here"})}
          `}
        </div>
      `,s.querySelectorAll("[data-tab]").forEach(e=>{e.addEventListener("click",()=>{c=e.dataset.tab,p=1,v=[],s.innerHTML=Q(),b()})}),s.querySelector("#ac-load-more")?.addEventListener("click",V),s.querySelector("#stat-entries")?.addEventListener("click",()=>{c="entry",p=1,v=[],b()}),s.querySelector("#stat-exits")?.addEventListener("click",()=>{c="exit",p=1,v=[],b()}),s.querySelector("#banner-denied")?.addEventListener("click",()=>{c="denied",p=1,v=[],b()});const L=s.querySelector("#btn-remote-unlock");L&&L.addEventListener("click",async()=>{if(!window.confirm("Unlock the gym gate for 5 seconds?"))return;L.disabled=!0,L.textContent="Sending unlock...";const e=await _("/api/mobile/v1/access/remote-unlock",{method:"POST",body:{delay_seconds:5,confirm:!0}});e.ok?o(e.data?.message||"Unlock command queued. Waiting for terminal acknowledgement.","success"):o(e.error?.message||"Could not unlock door","error"),L.disabled=!1,L.textContent="🔓 Unlock Gate"});const k=s.querySelector("#btn-reconcile-all");k&&k.addEventListener("click",async()=>{k.disabled=!0,k.textContent="Syncing...";const e=await _("/api/mobile/v1/access/reconcile",{method:"POST"});e.ok?(o(e.data?.message||"Re-sync queued for device","success"),await b()):e.error?.status===403?o("Only the gym owner can re-sync members","error"):o(e.error?.message||"Re-sync failed","error"),k.disabled=!1,k.textContent="🔄 Re-sync Members"});const F=s.querySelector("#btn-bridge-pairing");F&&F.addEventListener("click",async()=>{F.disabled=!0;const e=await _("/api/mobile/v1/settings/bridge/pairing-code",{method:"POST"});F.disabled=!1,e.ok&&e.data?.pairing_code?await se({title:"Bridge Pairing Code",message:`Your 6-digit pairing code is:

${e.data.pairing_code}

Valid for 10 minutes. Enter this code into RenewalDeskConnector.exe on your gym PC to connect.`,confirmText:"Done"}):o(e.error?.message||"Could not generate pairing code","error")}),s.querySelector("#btn-retry-sync")?.addEventListener("click",async()=>{const e=s.querySelector("#btn-retry-sync");e&&(e.disabled=!0),l=null,s.querySelector("#retry-reasons")?.remove();const m=await _("/api/mobile/v1/access/retry-sync",{method:"POST"});m.ok?(l={...m.data||{},retried_at:new Date().toISOString()},o(m.data?.message||"Commands queued for retry","success"),await b()):(m.error?.status===403?o("Only the gym owner can retry failed commands","error"):o(m.error?.message||"Could not retry syncs","error"),e&&(e.disabled=!1))}),s.querySelectorAll("[data-cancel-adms]").forEach(e=>{e.addEventListener("click",async()=>{if(e.disabled)return;e.disabled=!0,e.textContent="Cancelling…";const m=await _(`/api/mobile/v1/access/adms-commands/${e.dataset.cancelAdms}/cancel`,{method:"POST"});m.ok?(o(m.message||m.data?.message||"Queued command cancelled","success"),await b()):(m.error?.status===403?o("Only the gym owner can cancel queued commands","error"):o(m.error?.message||"Could not cancel this command","error"),e.disabled=!1,e.textContent="Cancel")})}),s.querySelector("#btn-clear-failed")?.addEventListener("click",async()=>{const e=a.adms_integration_id?"Clear all failed biometric commands? They will be marked cleared and hidden from this list (their history is kept).":"Permanently delete all failed biometric commands? This cannot be undone.";if(!confirm(e))return;const m=s.querySelector("#btn-clear-failed");m&&(m.disabled=!0);const U=await _("/api/mobile/v1/access/clear-failed",{method:"POST"});U.ok?(l=null,o(U.data?.message||"Failed commands cleared","success"),await b()):(o(U.error?.message||"Could not clear commands","error"),m&&(m.disabled=!1))}),N(s),H=!0}function G(){const t=document.createElement("div");t.className="modal-overlay center",t.innerHTML=`
        <div class="confirm-dialog" style="max-width:440px;width:90%;max-height:85vh;display:flex;flex-direction:column;padding:var(--sp-lg)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-md)">
            <div style="font-weight:var(--fw-bold);font-size:var(--fs-lg)">Manual Check In</div>
            <button id="modal-close" style="background:none;border:none;cursor:pointer;padding:4px">${B("close",20,"var(--muted)")}</button>
          </div>
          <div style="margin-bottom:var(--sp-md)">
            <input type="text" id="checkin-search" class="form-input" placeholder="Search member by name or phone..." style="width:100%" autofocus />
          </div>
          <div id="checkin-members-list" style="overflow-y:auto;max-height:50vh;display:flex;flex-direction:column;gap:var(--sp-xs)">
            <div style="text-align:center;padding:var(--sp-lg);color:var(--muted)">Loading active members...</div>
          </div>
        </div>
      `,document.body.appendChild(t),t.querySelector("#modal-close").onclick=()=>t.remove(),t.onclick=y=>{y.target===t&&t.remove()};const s=t.querySelector("#checkin-search"),n=t.querySelector("#checkin-members-list");let r=null,g=K();async function f(y=""){const a=`/api/mobile/v1/members?page_size=20&status=active${y?`&q=${encodeURIComponent(y)}`:""}`,C=await _(a);if(!C.ok){n.innerHTML='<div style="text-align:center;padding:var(--sp-md);color:var(--critical)">Failed to load members</div>';return}const w=C.data?.members||[];if(w.length===0){n.innerHTML=`<div style="text-align:center;padding:var(--sp-lg);color:var(--muted)">No members found matching "${d(y)}"</div>`;return}n.innerHTML=w.map(i=>`
          <div class="card card-body" style="padding:var(--sp-sm) var(--sp-md);display:flex;align-items:center;justify-content:space-between;gap:var(--sp-sm)">
            <div style="display:flex;align-items:center;gap:var(--sp-sm);min-width:0;flex:1">
              ${re(i.full_name||"Member","sm")}
              <div style="min-width:0">
                <div style="font-weight:var(--fw-semibold);font-size:var(--fs-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${d(i.full_name)}</div>
                <div style="font-size:var(--fs-xs);color:var(--muted)">${d(i.phone||"")}${i.plan?` · ${d(i.plan.name)}`:""}</div>
              </div>
            </div>
            <button class="btn btn-primary btn-sm btn-do-checkin" data-mid="${i.id}" data-mname="${d(i.full_name)}" style="border-radius:var(--r-full);padding:4px 12px;font-size:var(--fs-xs);flex-shrink:0">
              Check In
            </button>
          </div>
        `).join(""),n.querySelectorAll(".btn-do-checkin").forEach(i=>{i.addEventListener("click",async()=>{if(i.disabled)return;const O=i.dataset.mid,L=i.dataset.mname;i.disabled=!0,i.textContent="Checking in...";const k=await ie(O,"ENTRY",{idempotencyKey:g});k.ok&&k.data?.event_type==="ACCESS_DENIED"?(o(k.message||k.data?.message||`${L} was denied access — membership is not active.`,"error"),i.disabled=!1,i.textContent="Check In"):k.ok?(o(`${L} checked in successfully!`,"success"),g=K(),t.remove(),await b()):(o(k.error?.message||"Check-in failed","error"),i.disabled=!1,i.textContent="Check In")})})}s.addEventListener("input",y=>{clearTimeout(r),r=setTimeout(()=>{f(y.target.value.trim())},300)}),f()}h.innerHTML=`
      ${J({title:"Live Access",showBack:X.depth>1,actions:[{icon:"access",label:"Check In",onClick:()=>G()},{icon:"refresh",label:"Refresh",onClick:()=>b()}]})}
      <div class="scroll-view" id="ac-scroll">${Q()}</div>
    `,Z(h,{onBack:()=>{Y.pop()},actions:[{icon:"access",onClick:()=>G()},{icon:"refresh",onClick:()=>b()}]}),await b(),ee(h,b,15e3),window.__refreshAccess=()=>{document.body.contains(h)&&b()}},async unmount(){window.__refreshAccess=null}};async function oe(h){const c=document.createElement("div");c.id="quick-assign-overlay",c.innerHTML=`
    <div class="qa-sheet">
      <div class="qa-handle"></div>
      <h3>Who is biometric ID ${d(h)}?</h3>
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
    </style>`,document.body.appendChild(c);const E=()=>c.remove();c.addEventListener("click",l=>{l.target===c&&E()}),c.querySelector("#qa-close").addEventListener("click",E);let x=[],p=1,$=0,q="",v=!1,z=!1;const j=c.querySelector("#qa-results"),I=c.querySelector("#qa-search"),H=()=>{const l=x.map(u=>`<div class="qa-row" data-qa-pick="${u.id}"><b>${d(u.full_name)}</b>${u.phone?`<span>${d(u.phone)}</span>`:""}</div>`).join(""),R=x.length<$?`<button id="qa-more" style="width:100%;padding:12px;border:none;background:none;color:#2563eb;font-weight:700;font-size:14px;cursor:pointer">Show more (${x.length} of ${$})</button>`:x.length?`<div style="padding:10px;text-align:center;color:#94a3b8;font-size:12px">Showing ${x.length} of ${$} members</div>`:"";j.innerHTML=x.length||R?l+R:'<div class="qa-empty">No members found</div>',j.querySelectorAll("[data-qa-pick]").forEach(u=>{u.addEventListener("click",async()=>{if(z)return;z=!0;const S=Number(u.dataset.qaPick);u.style.background="#dcfce7";const T=await _("/api/mobile/v1/rrr/mappings/bulk-resolve",{method:"POST",body:{mappings:[{external_id:h,member_id:S}]}});T.ok&&T.data.linked===1?(o(`ID ${h} linked ✓`),E(),window.__refreshAccess&&window.__refreshAccess()):(o(T.error?.message||"Link failed — try again","error"),u.style.background="",z=!1)})}),j.querySelector("#qa-more")?.addEventListener("click",()=>{A(!1)})};async function A(l){if(v)return;v=!0;const R=l?1:p+1,u=await _(`/api/mobile/v1/members?page=${R}&page_size=30${q?`&q=${encodeURIComponent(q)}`:""}`);if(v=!1,u.ok){l&&(p=1,x=[]);const S=u.data.members||[];$=u.data.pagination?.total??(l?S.length:x.length+S.length);const T=new Set(x.map(N=>N.id));x=l?S:[...x,...S.filter(N=>!T.has(N.id))],p=R}else o(u.error?.message||"Could not load more members.","error");H()}let M;I.addEventListener("input",()=>{clearTimeout(M),M=setTimeout(()=>{q=I.value.trim(),A(!0)},300)}),A(!0),I.focus()}export{le as default};
