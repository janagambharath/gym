import{a as Q,F as V,x as Y,b as W,d as J,e as _,z as X,s as l,w as H,f as c,k as N,i as j,A as Z,u as ee,n as K,G as te,V as ae}from"./index-CIkiyrdY.js";const re={async mount(u){document.getElementById("quick-assign-overlay")?.remove();let d="all",q=null,g=0,m=1,x=0,k=1,p=[];const T=e=>e.punch_key||(e.id??`${e.member_id||""}|${e.biometric_user_id||e.device_enroll_number||""}|${e.event_timestamp||e.timestamp||e.created_at||""}`),P=e=>{const a=new Set;return e.filter(s=>{const r=T(s);return a.has(r)?!1:(a.add(r),!0)})};let z=!1,O=!1,I=!1,D=null,v=null;const A={test_action:"test command",unlock_door:"door unlock",unresolvable_member:"unknown member",requeue_failed:"could not re-queue",unsupported_action:"other command",commands_disabled:"commands disabled",terminal_never_polled:"terminal never connected"};function f(e){const a={};for(const s of e||[])a[s.reason]=(a[s.reason]||0)+1;return Object.entries(a).map(([s,r])=>{const y=A[s]||"other command";return`${r} ${y}${r>1?"s":""}`}).join(", ")}function E(e){const a=(e.event_type||"ENTRY").toUpperCase(),s=a==="ENTRY"||a==="ATTENDANCE",r=a==="ACCESS_DENIED",y=r?"var(--critical-surface)":s?"var(--success-surface)":"var(--gray-100)",o=r?"var(--critical)":s?"var(--success)":"var(--muted)",S=r?"alert":s?"forward":"back",t=r?"expired":s?"active":"info",C=r?"Denied":a==="ATTENDANCE"?"Check In":s?"Entry":"Exit",i=e.biometric_user_id||e.device_enroll_number,$=!e.member_id&&i,R=e.member_id?c(e.member_name||"Unknown"):i?`Unknown · ID ${c(i)}`:"Unknown";return`
        <div class="list-item" style="cursor:pointer" data-event-member-id="${e.member_id||""}" data-bio-id="${!e.member_id&&i?c(i):""}">
          <div style="width:34px;height:34px;border-radius:var(--r-full);background:${y};display:flex;align-items:center;justify-content:center;flex-shrink:0">
            ${j(S,16,o)}
          </div>
          <div class="list-item-content">
            <div class="list-item-title">${R}${$?' <span style="font-size:11px;color:#3b82f6;font-weight:700">· tap to assign</span>':""}</div>
            <div class="list-item-subtitle">${H(e.event_timestamp||e.timestamp||e.created_at)}${e.device_name?` · ${c(e.device_name)}`:""}</div>
          </div>
          <span class="badge badge-${t}">${C}</span>
        </div>
      `}function L(e){e.querySelectorAll("[data-event-member-id]").forEach(a=>{a.dataset.wired||(a.dataset.wired="1",a.addEventListener("click",()=>{const s=a.dataset.eventMemberId,r=a.dataset.bioId;s?K.push("member-detail",{memberId:s}):r&&ne(r)}))})}async function B(){if(m>=k)return;const e=u.querySelector("#ac-load-more");e&&(e.disabled=!0,e.textContent="Loading…");const a=m+1,s=await _(`/api/mobile/v1/access/events?page=${a}&per_page=25${d==="all"?"":`&type=${d}`}`);if(!s.ok){l(s.error?.message||"Could not load more events.","error"),e&&(e.disabled=!1,e.textContent="Load more events");return}m=s.data?.pagination?.page??a,k=s.data?.pagination?.total_pages??k,x=s.data?.pagination?.total??x;const r=s.data?.events||s.data?.log||[],y=new Set(p.map(T)),o=r.filter(i=>{const $=T(i);return y.has($)?!1:(y.add($),!0)});p=[...p,...o];const S=u.querySelector("#ac-events-card");S&&(S.insertAdjacentHTML("beforeend",o.map(E).join("")),L(S));const t=u.querySelector("#ac-feed-count");t&&(t.textContent=`Showing ${p.length} of ${x} events`);const C=u.querySelector("#ac-more-wrap");C&&(C.style.display=m<k?"":"none"),e&&(e.disabled=!1,e.textContent="Load more events")}async function b(){const e=++g,a=u.querySelector("#ac-scroll");if(!a)return;const s=n=>`/api/mobile/v1/access/events?page=${n}&per_page=25${d==="all"?"":`&type=${d}`}`,[r,...y]=await Promise.all([_("/api/mobile/v1/access/summary"),...Array.from({length:m},(n,w)=>_(s(w+1)))]);if(e!==g||u.dataset.screenDisposed==="true")return;const o=y[y.length-1],S=[...y].reverse().find(n=>n.ok);if(!O&&(!r.ok||!o.ok)){const n=(r.ok?o.error?.message:r.error?.message)||"Check your connection and try again.";a.innerHTML=X(n),a.querySelector("#retry-btn")?.addEventListener("click",b);return}if(o.ok)z=!1;else if(z||(z=!0,l("Could not refresh the access feed — showing the last loaded events.","error")),q)return;const t=r.ok?r.data:q||{};q=t,r.ok?(I=!1,D=new Date):q&&!I&&(I=!0,l("Could not refresh the access summary — showing the last loaded stats.","error"));const C=!r.ok&&!!q,i=o.ok?o.data?.events||o.data?.log||[]:[],$=o.ok?o.data?.pagination||{}:{};x=$.total??S?.data?.pagination?.total??x,k=$.total_pages??k,m=$.page??m,p=P(y.slice(0,-1).flatMap(n=>n.ok?n.data?.events||n.data?.log||[]:[]).concat(i));const R=t.last_event_at?H(t.last_event_at):t.last_heartbeat?`Heartbeat: ${H(t.last_heartbeat)}`:"";a.innerHTML=`
        <div class="scroll-content">
          <!-- Summary Card -->
          <div style="padding:var(--sp-lg)">
            <div class="card card-body" style="text-align:center">
              <div style="display:flex;align-items:center;justify-content:center;gap:var(--sp-sm);margin-bottom:var(--sp-sm)">
                <span style="width:10px;height:10px;border-radius:50%;background:${t.device_online?"var(--success)":"var(--muted)"}"></span>
                <span style="font-weight:var(--fw-bold);font-size:var(--fs-base)">${t.device_online?"Biometric Device Online":"Biometric Device Offline"}</span>
                ${t.device_name?`<span style="font-size:var(--fs-xs);color:var(--muted)">· ${c(t.device_name)}</span>`:""}
              </div>
              ${R?`<div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:var(--sp-md)">Last event: ${c(R)}</div>`:'<div style="margin-bottom:var(--sp-md)"></div>'}
              ${C?`<div style="font-size:var(--fs-xs);color:var(--warning);margin-bottom:var(--sp-md)">${D?`Stats from ${c(H(D.toISOString()))} — could not refresh.`:"Stats could not be refreshed — showing the last loaded stats."}</div>`:""}
              <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:var(--sp-lg)">
                <div style="cursor:pointer" id="stat-entries">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--brand)">${N(t.entries_today||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Entries</div>
                </div>
                <div style="cursor:pointer" id="stat-exits">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--warning)">${N(t.exits_today||0)}</div>
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
              <p style="font-size:var(--fs-xs);color:var(--muted);margin:0">${t.adms_online?t.adms_commands_enabled?"Terminal polled recently. Membership block/restore commands are enabled.":"Terminal polled recently, but automatic membership commands are not enabled yet.":`No recent terminal poll${t.adms_last_seen_at?` (last seen ${c(H(t.adms_last_seen_at))})`:""}. It cannot receive block/unblock commands until it reconnects.`}</p>
            </div>
            `:""}

            ${t.failed_commands>0?`
              <div class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);background:rgba(245,158,11,0.1);border-color:rgba(245,158,11,0.3);display:flex;align-items:center;justify-content:space-between">
                <div style="font-size:var(--fs-xs);color:#B45309;display:flex;align-items:center;gap:var(--sp-xs)">
                  ${j("alert",16,"#B45309")}
                  <span><strong>${N(t.failed_commands)} command(s)</strong> failed to sync</span>
                </div>
                <div style="display:flex;gap:8px">
                  <button class="btn btn-sm btn-primary" id="btn-retry-sync" style="font-size:var(--fs-xs);padding:4px 10px">Retry All</button>
                  <button class="btn btn-sm" id="btn-clear-failed" style="font-size:var(--fs-xs);padding:4px 10px;background:#FEE2E2;color:#B91C1C;border:1px solid #FECACA">Clear</button>
                </div>
              </div>
            `:""}

            ${v?`
              <div id="retry-reasons" class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);font-size:var(--fs-xs);color:var(--muted)">
                <div style="font-weight:var(--fw-semibold);color:#B45309">Retry All result: ${N(v.retried_count||0)} queued${v.skipped_count?`, ${N(v.skipped_count)} skipped`:""}</div>
                ${v.skipped_count>0?`<div style="margin-top:var(--sp-xs)">Skipped — ${c(f(v.skipped))}.</div>`:""}
              </div>
            `:""}

            ${t.denied_today>0?`
              <div class="card" id="banner-denied" style="margin-top:var(--sp-md);padding:var(--sp-md);background:var(--critical-surface);border-color:var(--critical-border);display:flex;align-items:center;justify-content:space-between;cursor:pointer">
                <div style="display:flex;align-items:center;gap:var(--sp-sm)">
                  ${j("alert",18,"var(--critical)")}
                  <span style="font-size:var(--fs-sm);font-weight:var(--fw-semibold);color:var(--critical)">${N(t.denied_today)} access denied event${t.denied_today>1?"s":""} today</span>
                </div>
                ${j("forward",14,"var(--critical)")}
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
            ${[{id:"all",label:"All Events"},{id:"entry",label:"Entries"},{id:"exit",label:"Exits"},{id:"denied",label:"Denied"}].map(n=>`
              <button class="btn btn-sm ${d===n.id?"btn-primary":"btn-secondary"}" data-tab="${n.id}" style="border-radius:var(--r-full);white-space:nowrap;padding:4px 12px;font-size:var(--fs-xs)">
                ${n.label}
              </button>
            `).join("")}
          </div>

          <!-- List Section -->
          ${`
            ${p.length>0?`
              <div class="card" id="ac-events-card" style="margin:0 var(--sp-lg)">
                ${p.map(E).join("")}
              </div>
              <div id="ac-feed-count" style="padding:var(--sp-sm) 0;font-size:var(--fs-sm);color:var(--muted);text-align:center">Showing ${p.length} of ${x} events</div>
              ${m<k?'<div id="ac-more-wrap" style="text-align:center;padding:var(--sp-md)"><button class="btn btn-secondary" id="ac-load-more">Load more events</button></div>':""}
            `:Z({icon:"access",title:"No events",text:"Live access and check-in events will appear here"})}
          `}
        </div>
      `,a.querySelectorAll("[data-tab]").forEach(n=>{n.addEventListener("click",()=>{d=n.dataset.tab,m=1,p=[],a.innerHTML=Y(),b()})}),a.querySelector("#ac-load-more")?.addEventListener("click",B),a.querySelector("#stat-entries")?.addEventListener("click",()=>{d="entry",m=1,p=[],b()}),a.querySelector("#stat-exits")?.addEventListener("click",()=>{d="exit",m=1,p=[],b()}),a.querySelector("#banner-denied")?.addEventListener("click",()=>{d="denied",m=1,p=[],b()});const h=a.querySelector("#btn-remote-unlock");h&&h.addEventListener("click",async()=>{if(!window.confirm("Unlock the gym gate for 5 seconds?"))return;h.disabled=!0,h.textContent="Sending unlock...";const n=await _("/api/mobile/v1/access/remote-unlock",{method:"POST",body:{delay_seconds:5,confirm:!0}});n.ok?l(n.data?.message||"Unlock command queued. Waiting for terminal acknowledgement.","success"):l(n.error?.message||"Could not unlock door","error"),h.disabled=!1,h.textContent="🔓 Unlock Gate"});const M=a.querySelector("#btn-reconcile-all");M&&M.addEventListener("click",async()=>{M.disabled=!0,M.textContent="Syncing...";const n=await _("/api/mobile/v1/access/reconcile",{method:"POST"});n.ok?(l(n.data?.message||"Re-sync queued for device","success"),await b()):l(n.error?.message||"Re-sync failed","error"),M.disabled=!1,M.textContent="🔄 Re-sync Members"});const F=a.querySelector("#btn-bridge-pairing");F&&F.addEventListener("click",async()=>{F.disabled=!0;const n=await _("/api/mobile/v1/settings/bridge/pairing-code",{method:"POST"});F.disabled=!1,n.ok&&n.data?.pairing_code?await ee({title:"Bridge Pairing Code",message:`Your 6-digit pairing code is:

${n.data.pairing_code}

Valid for 10 minutes. Enter this code into RenewalDeskConnector.exe on your gym PC to connect.`,confirmText:"Done"}):l(n.error?.message||"Could not generate pairing code","error")}),a.querySelector("#btn-retry-sync")?.addEventListener("click",async()=>{const n=a.querySelector("#btn-retry-sync");n&&(n.disabled=!0);const w=await _("/api/mobile/v1/access/retry-sync",{method:"POST"});w.ok?(v=w.data||null,l(w.data?.message||"Commands queued for retry","success"),await b()):(l(w.error?.message||"Could not retry syncs","error"),n&&(n.disabled=!1))}),a.querySelector("#btn-clear-failed")?.addEventListener("click",async()=>{const n=t.adms_integration_id?"Clear all failed biometric commands? They will be marked cleared and hidden from this list (their history is kept).":"Permanently delete all failed biometric commands? This cannot be undone.";if(!confirm(n))return;const w=a.querySelector("#btn-clear-failed");w&&(w.disabled=!0);const U=await _("/api/mobile/v1/access/clear-failed",{method:"POST"});U.ok?(l(U.data?.message||"Failed commands cleared","success"),await b()):(l(U.error?.message||"Could not clear commands","error"),w&&(w.disabled=!1))}),L(a),O=!0}function G(){const e=document.createElement("div");e.className="modal-overlay center",e.innerHTML=`
        <div class="confirm-dialog" style="max-width:440px;width:90%;max-height:85vh;display:flex;flex-direction:column;padding:var(--sp-lg)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-md)">
            <div style="font-weight:var(--fw-bold);font-size:var(--fs-lg)">Manual Check In</div>
            <button id="modal-close" style="background:none;border:none;cursor:pointer;padding:4px">${j("close",20,"var(--muted)")}</button>
          </div>
          <div style="margin-bottom:var(--sp-md)">
            <input type="text" id="checkin-search" class="form-input" placeholder="Search member by name or phone..." style="width:100%" autofocus />
          </div>
          <div id="checkin-members-list" style="overflow-y:auto;max-height:50vh;display:flex;flex-direction:column;gap:var(--sp-xs)">
            <div style="text-align:center;padding:var(--sp-lg);color:var(--muted)">Loading active members...</div>
          </div>
        </div>
      `,document.body.appendChild(e),e.querySelector("#modal-close").onclick=()=>e.remove(),e.onclick=o=>{o.target===e&&e.remove()};const a=e.querySelector("#checkin-search"),s=e.querySelector("#checkin-members-list");let r=null;async function y(o=""){const S=`/api/mobile/v1/members?page_size=20&status=active${o?`&q=${encodeURIComponent(o)}`:""}`,t=await _(S);if(!t.ok){s.innerHTML='<div style="text-align:center;padding:var(--sp-md);color:var(--critical)">Failed to load members</div>';return}const C=t.data?.members||[];if(C.length===0){s.innerHTML=`<div style="text-align:center;padding:var(--sp-lg);color:var(--muted)">No members found matching "${c(o)}"</div>`;return}s.innerHTML=C.map(i=>`
          <div class="card card-body" style="padding:var(--sp-sm) var(--sp-md);display:flex;align-items:center;justify-content:space-between;gap:var(--sp-sm)">
            <div style="display:flex;align-items:center;gap:var(--sp-sm);min-width:0;flex:1">
              ${te(i.full_name||"Member","sm")}
              <div style="min-width:0">
                <div style="font-weight:var(--fw-semibold);font-size:var(--fs-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c(i.full_name)}</div>
                <div style="font-size:var(--fs-xs);color:var(--muted)">${c(i.phone||"")}${i.plan?` · ${c(i.plan.name)}`:""}</div>
              </div>
            </div>
            <button class="btn btn-primary btn-sm btn-do-checkin" data-mid="${i.id}" data-mname="${c(i.full_name)}" style="border-radius:var(--r-full);padding:4px 12px;font-size:var(--fs-xs);flex-shrink:0">
              Check In
            </button>
          </div>
        `).join(""),s.querySelectorAll(".btn-do-checkin").forEach(i=>{i.addEventListener("click",async()=>{const $=i.dataset.mid,R=i.dataset.mname;i.disabled=!0,i.textContent="Checking in...";const h=await ae($,"ENTRY");h.ok&&h.data?.event_type==="ACCESS_DENIED"?(l(h.message||h.data?.message||`${R} was denied access — membership is not active.`,"error"),i.disabled=!1,i.textContent="Check In"):h.ok?(l(`${R} checked in successfully!`,"success"),e.remove(),await b()):(l(h.error?.message||"Check-in failed","error"),i.disabled=!1,i.textContent="Check In")})})}a.addEventListener("input",o=>{clearTimeout(r),r=setTimeout(()=>{y(o.target.value.trim())},300)}),y()}u.innerHTML=`
      ${Q({title:"Live Access",showBack:V.depth>1,actions:[{icon:"access",label:"Check In",onClick:()=>G()},{icon:"refresh",label:"Refresh",onClick:()=>b()}]})}
      <div class="scroll-view" id="ac-scroll">${Y()}</div>
    `,W(u,{onBack:()=>{K.pop()},actions:[{icon:"access",onClick:()=>G()},{icon:"refresh",onClick:()=>b()}]}),await b(),J(u,b,15e3),window.__refreshAccess=()=>{document.body.contains(u)&&b()}},async unmount(){window.__refreshAccess=null}};async function ne(u){const d=document.createElement("div");d.id="quick-assign-overlay",d.innerHTML=`
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
    </style>`,document.body.appendChild(d);const q=()=>d.remove();d.addEventListener("click",v=>{v.target===d&&q()}),d.querySelector("#qa-close").addEventListener("click",q);let g=[],m=1,x=0,k="",p=!1,T=!1;const P=d.querySelector("#qa-results"),z=d.querySelector("#qa-search"),O=()=>{const v=g.map(f=>`<div class="qa-row" data-qa-pick="${f.id}"><b>${c(f.full_name)}</b>${f.phone?`<span>${c(f.phone)}</span>`:""}</div>`).join(""),A=g.length<x?`<button id="qa-more" style="width:100%;padding:12px;border:none;background:none;color:#2563eb;font-weight:700;font-size:14px;cursor:pointer">Show more (${g.length} of ${x})</button>`:g.length?`<div style="padding:10px;text-align:center;color:#94a3b8;font-size:12px">Showing ${g.length} of ${x} members</div>`:"";P.innerHTML=g.length||A?v+A:'<div class="qa-empty">No members found</div>',P.querySelectorAll("[data-qa-pick]").forEach(f=>{f.addEventListener("click",async()=>{if(T)return;T=!0;const E=Number(f.dataset.qaPick);f.style.background="#dcfce7";const L=await _("/api/mobile/v1/rrr/mappings/bulk-resolve",{method:"POST",body:{mappings:[{external_id:u,member_id:E}]}});L.ok&&L.data.linked===1?(l(`ID ${u} linked ✓`),q(),window.__refreshAccess&&window.__refreshAccess()):(l(L.error?.message||"Link failed — try again","error"),f.style.background="",T=!1)})}),P.querySelector("#qa-more")?.addEventListener("click",()=>{I(!1)})};async function I(v){if(p)return;p=!0;const A=v?1:m+1,f=await _(`/api/mobile/v1/members?page=${A}&page_size=30${k?`&q=${encodeURIComponent(k)}`:""}`);if(p=!1,f.ok){v&&(m=1,g=[]);const E=f.data.members||[];x=f.data.pagination?.total??(v?E.length:g.length+E.length);const L=new Set(g.map(B=>B.id));g=v?E:[...g,...E.filter(B=>!L.has(B.id))],m=A}else l(f.error?.message||"Could not load more members.","error");O()}let D;z.addEventListener("input",()=>{clearTimeout(D),D=setTimeout(()=>{k=z.value.trim(),I(!0)},300)}),I(!0),z.focus()}export{re as default};
