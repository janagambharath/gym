import{a as J,C as Z,u as Q,b as ee,f as te,g as $,s as c,H as P,j as m,k as U,i as H,x as ae,G as ne,D as K,n as V,R as W}from"./index-Ca8zdeLr.js";const re={async mount(l){document.getElementById("quick-assign-overlay")?.remove();let d="all",M=null,h=0,u=1,_=0,q=1,g=[],w=[],C=0,b=1,S=1;const A=e=>e.id??`${e.member_id||""}|${e.biometric_user_id||e.device_enroll_number||""}|${e.event_timestamp||e.timestamp||e.created_at||""}`,j=e=>{const t=new Set;return e.filter(s=>{const r=A(s);return t.has(r)?!1:(t.add(r),!0)})};function L(e){return`
        <div class="list-item" style="cursor:pointer" data-event-member-id="${e.id}">
          ${K(e.full_name||"Member","sm")}
          <div class="list-item-content">
            <div class="list-item-title">${m(e.full_name)}</div>
            <div class="list-item-subtitle">Entered ${e.entered_at?P(e.entered_at):"—"}</div>
          </div>
          <button class="btn btn-secondary btn-sm" data-checkout-id="${e.id}" data-checkout-name="${m(e.full_name)}">Check Out</button>
        </div>`}let T=!1;function p(e){const t=(e.event_type||"ENTRY").toUpperCase(),s=t==="ENTRY"||t==="ATTENDANCE",r=t==="ACCESS_DENIED",y=r?"var(--critical-surface)":s?"var(--success-surface)":"var(--gray-100)",o=r?"var(--critical)":s?"var(--success)":"var(--muted)",k=r?"alert":s?"forward":"back",v=r?"expired":s?"active":"info",f=r?"Denied":t==="ATTENDANCE"?"Check In":s?"Entry":"Exit",i=e.biometric_user_id||e.device_enroll_number,I=!e.member_id&&i,n=e.member_id?m(e.member_name||"Unknown"):i?`Unknown · ID ${m(i)}`:"Unknown";return`
        <div class="list-item" style="cursor:pointer" data-event-member-id="${e.member_id||""}" data-bio-id="${!e.member_id&&i?m(i):""}">
          <div style="width:34px;height:34px;border-radius:var(--r-full);background:${y};display:flex;align-items:center;justify-content:center;flex-shrink:0">
            ${H(k,16,o)}
          </div>
          <div class="list-item-content">
            <div class="list-item-title">${n}${I?' <span style="font-size:11px;color:#3b82f6;font-weight:700">· tap to assign</span>':""}</div>
            <div class="list-item-subtitle">${P(e.event_timestamp||e.timestamp||e.created_at)}${e.device_name?` · ${m(e.device_name)}`:""}</div>
          </div>
          <span class="badge badge-${v}">${f}</span>
        </div>
      `}function R(e){e.querySelectorAll("[data-event-member-id]").forEach(t=>{t.dataset.wired||(t.dataset.wired="1",t.addEventListener("click",()=>{const s=t.dataset.eventMemberId,r=t.dataset.bioId;s?V.push("member-detail",{memberId:s}):r&&se(r)}))}),e.querySelectorAll("[data-checkout-id]").forEach(t=>{t.dataset.wired||(t.dataset.wired="1",t.addEventListener("click",async s=>{s.stopPropagation();const r=t.dataset.checkoutId,y=t.dataset.checkoutName;t.disabled=!0,t.textContent="Checking out...";const o=await W(r,"EXIT");o.ok?(c(`${y} checked out`,"success"),await x()):(c(o.error?.message||"Check-out failed","error"),t.disabled=!1,t.textContent="Check Out")}))})}async function z(){if(u>=q)return;const e=l.querySelector("#ac-load-more");e&&(e.disabled=!0,e.textContent="Loading…");const t=u+1,s=await $(`/api/mobile/v1/access/events?page=${t}&per_page=25${d==="all"?"":`&type=${d}`}`);if(!s.ok){c(s.error?.message||"Could not load more events.","error"),e&&(e.disabled=!1,e.textContent="Load more events");return}u=s.data?.pagination?.page??t,q=s.data?.pagination?.total_pages??q,_=s.data?.pagination?.total??_;const r=s.data?.events||s.data?.log||[],y=new Set(g.map(A)),o=r.filter(i=>{const I=A(i);return y.has(I)?!1:(y.add(I),!0)});g=[...g,...o];const k=l.querySelector("#ac-events-card");k&&(k.insertAdjacentHTML("beforeend",o.map(p).join("")),R(k));const v=l.querySelector("#ac-feed-count");v&&(v.textContent=`Showing ${g.length} of ${_} events`);const f=l.querySelector("#ac-more-wrap");f&&(f.style.display=u<q?"":"none"),e&&(e.disabled=!1,e.textContent="Load more events")}async function X(){if(b>=S)return;const e=l.querySelector("#ac-inside-more");e&&(e.disabled=!0,e.textContent="Loading…");const t=b+1,s=await $(`/api/mobile/v1/access/inside?page=${t}&per_page=50`);if(!s.ok){c(s.error?.message||"Could not load more members inside.","error"),e&&(e.disabled=!1,e.textContent="Load more");return}b=s.data?.pagination?.page??t,S=s.data?.pagination?.total_pages??S,C=s.data?.pagination?.total??C;const r=new Set(w.map(f=>f.id)),y=(s.data?.members||[]).filter(f=>r.has(f.id)?!1:(r.add(f.id),!0));w=[...w,...y];const o=l.querySelector("#ac-inside-list");o&&(o.insertAdjacentHTML("beforeend",y.map(L).join("")),R(o));const k=l.querySelector("#ac-inside-count");k&&(k.textContent=`Showing ${w.length} of ${C} inside now`);const v=l.querySelector("#ac-inside-more-wrap");v&&(v.style.display=b<S?"":"none"),e&&(e.disabled=!1,e.textContent="Load more")}async function x(){const e=++h,t=l.querySelector("#ac-scroll");if(!t)return;const s=a=>`/api/mobile/v1/access/events?page=${a}&per_page=25${d==="all"?"":`&type=${d}`}`,r=a=>`/api/mobile/v1/access/inside?page=${a}&per_page=50`,[y,...o]=await Promise.all([$("/api/mobile/v1/access/summary"),...Array.from({length:b},(a,E)=>$(r(E+1))),...Array.from({length:u},(a,E)=>$(s(E+1)))]);if(e!==h||l.dataset.screenDisposed==="true")return;const k=o.slice(0,b),v=k[k.length-1],f=o.slice(b),i=f[f.length-1],I=[...f].reverse().find(a=>a.ok);if(i.ok)T=!1;else if(T||(T=!0,c("Could not refresh the access feed — showing the last loaded events.","error")),M)return;const n=y.ok?y.data:M||{};M=n;const B=i.ok?i.data?.events||i.data?.log||[]:[],F=i.ok?i.data?.pagination||{}:{};_=F.total??I?.data?.pagination?.total??_,q=F.total_pages??q,u=F.page??u,g=j(f.slice(0,-1).flatMap(a=>a.ok?a.data?.events||a.data?.log||[]:[]).concat(B)),w=[...new Map(k.flatMap(a=>a.ok?a.data?.members||[]:[]).map(a=>[a.id,a])).values()],C=v.ok?v.data?.pagination?.total??w.length:C,S=v.ok?v.data?.pagination?.total_pages??S:S,b=v.ok?v.data?.pagination?.page??b:b;const Y=n.last_event_at?P(n.last_event_at):n.last_heartbeat?`Heartbeat: ${P(n.last_heartbeat)}`:"";t.innerHTML=`
        <div class="scroll-content">
          <!-- Summary Card -->
          <div style="padding:var(--sp-lg)">
            <div class="card card-body" style="text-align:center">
              <div style="display:flex;align-items:center;justify-content:center;gap:var(--sp-sm);margin-bottom:var(--sp-sm)">
                <span style="width:10px;height:10px;border-radius:50%;background:${n.device_online?"var(--success)":"var(--muted)"}"></span>
                <span style="font-weight:var(--fw-bold);font-size:var(--fs-base)">${n.device_online?"Biometric Device Online":"Biometric Device Offline"}</span>
                ${n.device_name?`<span style="font-size:var(--fs-xs);color:var(--muted)">· ${m(n.device_name)}</span>`:""}
              </div>
              ${Y?`<div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:var(--sp-md)">Last event: ${m(Y)}</div>`:'<div style="margin-bottom:var(--sp-md)"></div>'}
              <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:var(--sp-lg)">
                <div style="cursor:pointer" id="stat-entries">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--brand)">${U(n.entries_today||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Entries</div>
                </div>
                <div style="cursor:pointer" id="stat-exits">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--warning)">${U(n.exits_today||0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Exits</div>
                </div>
              </div>

              ${n.remote_unlock_available?`
              <!-- Remote Physical Gate Control -->
              <div style="margin-top:var(--sp-lg);padding-top:var(--sp-md);border-top:1px solid var(--border);display:grid;grid-template-columns:1fr;gap:var(--sp-sm)">
                <button class="btn" id="btn-remote-unlock" style="font-weight:var(--fw-semibold);display:flex;align-items:center;justify-content:center;gap:var(--sp-xs);font-size:var(--fs-xs);background:#16a34a;color:white;border:none">
                  🔓 Unlock Gate
                </button>
              </div>
              `:""}
            </div>

            ${n.adms_integration_id?"":`
            <!-- Hardware Bridge Controls (only when NOT on Direct Cloud) -->
            <div class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);display:flex;flex-direction:column;gap:var(--sp-sm)">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <div style="font-weight:var(--fw-bold);font-size:var(--fs-xs);text-transform:uppercase;color:var(--muted);letter-spacing:0.5px">Hardware Bridge Controls</div>
                <span style="font-size:10px;font-weight:var(--fw-bold);padding:2px 8px;border-radius:12px;background:${n.bridge_online?"#dcfce7":"#fee2e2"};color:${n.bridge_online?"#15803d":"#b91c1c"}">
                  ${n.bridge_online?"BRIDGE ONLINE":"BRIDGE OFFLINE"}
                </span>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-xs)">
                <button class="btn btn-secondary btn-sm" id="btn-reconcile-all" style="font-size:var(--fs-xs);padding:6px 10px">🔄 Re-sync Members</button>
                <button class="btn btn-secondary btn-sm" id="btn-bridge-pairing" style="font-size:var(--fs-xs);padding:6px 10px">🔑 Pairing Code</button>
              </div>
            </div>
            `}

            ${n.adms_integration_id?`
            <!-- Direct Cloud (ADMS) Status -->
            <div class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);display:flex;flex-direction:column;gap:var(--sp-sm)">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <div style="font-weight:var(--fw-bold);font-size:var(--fs-xs);text-transform:uppercase;color:var(--muted);letter-spacing:0.5px">Direct Cloud Terminal</div>
                <span style="font-size:10px;font-weight:var(--fw-bold);padding:2px 8px;border-radius:12px;background:${n.adms_online?"#dcfce7":"#fee2e2"};color:${n.adms_online?"#15803d":"#b91c1c"}">
                  ${n.adms_online?"ONLINE":"OFFLINE"}
                </span>
              </div>
              ${n.adms_device_name?`<div style="font-size:var(--fs-xs);color:var(--muted)">${m(n.adms_device_name)}</div>`:""}
              <p style="font-size:var(--fs-xs);color:var(--muted);margin:0">${n.adms_online?n.adms_commands_enabled?"Terminal polled recently. Membership block/restore commands are enabled.":"Terminal polled recently, but automatic membership commands are not enabled yet.":`No recent terminal poll${n.adms_last_seen_at?` (last seen ${m(P(n.adms_last_seen_at))})`:""}. It cannot receive block/unblock commands until it reconnects.`}</p>
            </div>
            `:""}

            ${n.failed_commands>0?`
              <div class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);background:rgba(245,158,11,0.1);border-color:rgba(245,158,11,0.3);display:flex;align-items:center;justify-content:space-between">
                <div style="font-size:var(--fs-xs);color:#B45309;display:flex;align-items:center;gap:var(--sp-xs)">
                  ${H("alert",16,"#B45309")}
                  <span><strong>${U(n.failed_commands)} command(s)</strong> failed to sync</span>
                </div>
                <div style="display:flex;gap:8px">
                  <button class="btn btn-sm btn-primary" id="btn-retry-sync" style="font-size:var(--fs-xs);padding:4px 10px">Retry All</button>
                  <button class="btn btn-sm" id="btn-clear-failed" style="font-size:var(--fs-xs);padding:4px 10px;background:#FEE2E2;color:#B91C1C;border:1px solid #FECACA">Clear</button>
                </div>
              </div>
            `:""}

            ${n.denied_today>0?`
              <div class="card" id="banner-denied" style="margin-top:var(--sp-md);padding:var(--sp-md);background:var(--critical-surface);border-color:var(--critical-border);display:flex;align-items:center;justify-content:space-between;cursor:pointer">
                <div style="display:flex;align-items:center;gap:var(--sp-sm)">
                  ${H("alert",18,"var(--critical)")}
                  <span style="font-size:var(--fs-sm);font-weight:var(--fw-semibold);color:var(--critical)">${U(n.denied_today)} access denied event${n.denied_today>1?"s":""} today</span>
                </div>
                ${H("forward",14,"var(--critical)")}
              </div>
            `:""}

            ${!n.device_online&&(n.inside_now||0)===0&&(n.entries_today||0)===0?`
              <div style="margin-top:var(--sp-md);padding:var(--sp-sm) var(--sp-md);background:var(--gray-50, #f8f9fa);border:1px dashed var(--border);border-radius:var(--r-md);font-size:var(--fs-xs);color:var(--muted);text-align:center">
                💡 Tip: Tap <b>"+ Check In Member"</b> above to log attendance manually anytime, or connect your biometric turnstile/machine.
              </div>
            `:""}
          </div>

          <!-- Inside Now (V3-M21) — from /access/inside, not the feed -->
          ${w.length?`
            <div class="card" style="margin:var(--sp-md) var(--sp-lg) 0">
              <div style="padding:var(--sp-md) var(--sp-md) var(--sp-xs);font-weight:var(--fw-bold);font-size:var(--fs-sm)">Inside now (${C})</div>
              <div id="ac-inside-list">${w.map(L).join("")}</div>
              <div id="ac-inside-count" style="padding:var(--sp-sm) 0;font-size:var(--fs-sm);color:var(--muted);text-align:center">Showing ${w.length} of ${C} inside now</div>
              ${b<S?'<div id="ac-inside-more-wrap" style="text-align:center;padding:var(--sp-md)"><button class="btn btn-secondary" id="ac-inside-more">Load more</button></div>':""}
            </div>`:""}

          <!-- Filter Tabs -->
          <div style="display:flex;gap:var(--sp-xs);padding:0 var(--sp-lg) var(--sp-md);overflow-x:auto;-webkit-overflow-scrolling:touch">
            ${[{id:"all",label:"All Events"},{id:"entry",label:"Entries"},{id:"exit",label:"Exits"},{id:"denied",label:"Denied"}].map(a=>`
              <button class="btn btn-sm ${d===a.id?"btn-primary":"btn-secondary"}" data-tab="${a.id}" style="border-radius:var(--r-full);white-space:nowrap;padding:4px 12px;font-size:var(--fs-xs)">
                ${a.label}
              </button>
            `).join("")}
          </div>

          <!-- List Section -->
          ${`
            ${g.length>0?`
              <div class="card" id="ac-events-card" style="margin:0 var(--sp-lg)">
                ${g.map(p).join("")}
              </div>
              <div id="ac-feed-count" style="padding:var(--sp-sm) 0;font-size:var(--fs-sm);color:var(--muted);text-align:center">Showing ${g.length} of ${_} events</div>
              ${u<q?'<div id="ac-more-wrap" style="text-align:center;padding:var(--sp-md)"><button class="btn btn-secondary" id="ac-load-more">Load more events</button></div>':""}
            `:ae({icon:"access",title:"No events",text:"Live access and check-in events will appear here"})}
          `}
        </div>
      `,t.querySelectorAll("[data-tab]").forEach(a=>{a.addEventListener("click",()=>{d=a.dataset.tab,u=1,g=[],t.innerHTML=Q(),x()})}),t.querySelector("#ac-load-more")?.addEventListener("click",z),t.querySelector("#ac-inside-more")?.addEventListener("click",X),t.querySelector("#stat-entries")?.addEventListener("click",()=>{d="entry",u=1,g=[],x()}),t.querySelector("#stat-exits")?.addEventListener("click",()=>{d="exit",u=1,g=[],x()}),t.querySelector("#banner-denied")?.addEventListener("click",()=>{d="denied",u=1,g=[],x()});const D=t.querySelector("#btn-remote-unlock");D&&D.addEventListener("click",async()=>{if(!window.confirm("Unlock the gym gate for 5 seconds?"))return;D.disabled=!0,D.textContent="Sending unlock...";const a=await $("/api/mobile/v1/access/remote-unlock",{method:"POST",body:{delay_seconds:5,confirm:!0}});a.ok?c(a.data?.message||"Unlock command queued. Waiting for terminal acknowledgement.","success"):c(a.error?.message||"Could not unlock door","error"),D.disabled=!1,D.textContent="🔓 Unlock Gate"});const N=t.querySelector("#btn-reconcile-all");N&&N.addEventListener("click",async()=>{N.disabled=!0,N.textContent="Syncing...";const a=await $("/api/mobile/v1/access/reconcile",{method:"POST"});a.ok?(c(a.data?.message||"Re-sync queued for device","success"),await x()):c(a.error?.message||"Re-sync failed","error"),N.disabled=!1,N.textContent="🔄 Re-sync Members"});const O=t.querySelector("#btn-bridge-pairing");O&&O.addEventListener("click",async()=>{O.disabled=!0;const a=await $("/api/mobile/v1/settings/bridge/pairing-code",{method:"POST"});O.disabled=!1,a.ok&&a.data?.pairing_code?await ne({title:"Bridge Pairing Code",message:`Your 6-digit pairing code is:

${a.data.pairing_code}

Valid for 10 minutes. Enter this code into RenewalDeskConnector.exe on your gym PC to connect.`,confirmText:"Done"}):c(a.error?.message||"Could not generate pairing code","error")}),t.querySelector("#btn-retry-sync")?.addEventListener("click",async()=>{const a=t.querySelector("#btn-retry-sync");a&&(a.disabled=!0);const E=await $("/api/mobile/v1/access/retry-sync",{method:"POST"});E.ok?(c(E.data?.message||"Commands queued for retry","success"),await x()):(c(E.error?.message||"Could not retry syncs","error"),a&&(a.disabled=!1))}),t.querySelector("#btn-clear-failed")?.addEventListener("click",async()=>{if(!confirm("Permanently delete all failed biometric commands? This cannot be undone."))return;const a=t.querySelector("#btn-clear-failed");a&&(a.disabled=!0);const E=await $("/api/mobile/v1/access/clear-failed",{method:"POST"});E.ok?(c(E.data?.message||"Failed commands cleared","success"),await x()):(c(E.error?.message||"Could not clear commands","error"),a&&(a.disabled=!1))}),R(t)}function G(){const e=document.createElement("div");e.className="modal-overlay center",e.innerHTML=`
        <div class="confirm-dialog" style="max-width:440px;width:90%;max-height:85vh;display:flex;flex-direction:column;padding:var(--sp-lg)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-md)">
            <div style="font-weight:var(--fw-bold);font-size:var(--fs-lg)">Manual Check In</div>
            <button id="modal-close" style="background:none;border:none;cursor:pointer;padding:4px">${H("close",20,"var(--muted)")}</button>
          </div>
          <div style="margin-bottom:var(--sp-md)">
            <input type="text" id="checkin-search" class="form-input" placeholder="Search member by name or phone..." style="width:100%" autofocus />
          </div>
          <div id="checkin-members-list" style="overflow-y:auto;max-height:50vh;display:flex;flex-direction:column;gap:var(--sp-xs)">
            <div style="text-align:center;padding:var(--sp-lg);color:var(--muted)">Loading active members...</div>
          </div>
        </div>
      `,document.body.appendChild(e),e.querySelector("#modal-close").onclick=()=>e.remove(),e.onclick=o=>{o.target===e&&e.remove()};const t=e.querySelector("#checkin-search"),s=e.querySelector("#checkin-members-list");let r=null;async function y(o=""){const k=`/api/mobile/v1/members?page_size=20&status=active${o?`&q=${encodeURIComponent(o)}`:""}`,v=await $(k);if(!v.ok){s.innerHTML='<div style="text-align:center;padding:var(--sp-md);color:var(--critical)">Failed to load members</div>';return}const f=v.data?.members||[];if(f.length===0){s.innerHTML=`<div style="text-align:center;padding:var(--sp-lg);color:var(--muted)">No members found matching "${m(o)}"</div>`;return}s.innerHTML=f.map(i=>`
          <div class="card card-body" style="padding:var(--sp-sm) var(--sp-md);display:flex;align-items:center;justify-content:space-between;gap:var(--sp-sm)">
            <div style="display:flex;align-items:center;gap:var(--sp-sm);min-width:0;flex:1">
              ${K(i.full_name||"Member","sm")}
              <div style="min-width:0">
                <div style="font-weight:var(--fw-semibold);font-size:var(--fs-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m(i.full_name)}</div>
                <div style="font-size:var(--fs-xs);color:var(--muted)">${m(i.phone||"")}${i.plan?` · ${m(i.plan.name)}`:""}</div>
              </div>
            </div>
            <button class="btn btn-primary btn-sm btn-do-checkin" data-mid="${i.id}" data-mname="${m(i.full_name)}" style="border-radius:var(--r-full);padding:4px 12px;font-size:var(--fs-xs);flex-shrink:0">
              Check In
            </button>
          </div>
        `).join(""),s.querySelectorAll(".btn-do-checkin").forEach(i=>{i.addEventListener("click",async()=>{const I=i.dataset.mid,n=i.dataset.mname;i.disabled=!0,i.textContent="Checking in...";const B=await W(I,"ENTRY");B.ok?(c(`${n} checked in successfully!`,"success"),e.remove(),await x()):(c(B.error?.message||"Check-in failed","error"),i.disabled=!1,i.textContent="Check In")})})}t.addEventListener("input",o=>{clearTimeout(r),r=setTimeout(()=>{y(o.target.value.trim())},300)}),y()}l.innerHTML=`
      ${J({title:"Live Access",showBack:Z.depth>1,actions:[{icon:"access",label:"Check In",onClick:()=>G()},{icon:"refresh",label:"Refresh",onClick:()=>x()}]})}
      <div class="scroll-view" id="ac-scroll">${Q()}</div>
    `,ee(l,{onBack:()=>{V.pop()},actions:[{icon:"access",onClick:()=>G()},{icon:"refresh",onClick:()=>x()}]}),await x(),te(l,x,15e3),window.__refreshAccess=()=>{document.body.contains(l)&&x()}},async unmount(){window.__refreshAccess=null}};async function se(l){const d=document.createElement("div");d.id="quick-assign-overlay",d.innerHTML=`
    <div class="qa-sheet">
      <div class="qa-handle"></div>
      <h3>Who is biometric ID ${m(l)}?</h3>
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
    </style>`,document.body.appendChild(d);const M=()=>d.remove();d.addEventListener("click",L=>{L.target===d&&M()}),d.querySelector("#qa-close").addEventListener("click",M);let h=[],u=1,_=0,q="",g=!1,w=!1;const C=d.querySelector("#qa-results"),b=d.querySelector("#qa-search"),S=()=>{const L=h.map(p=>`<div class="qa-row" data-qa-pick="${p.id}"><b>${m(p.full_name)}</b>${p.phone?`<span>${m(p.phone)}</span>`:""}</div>`).join(""),T=h.length<_?`<button id="qa-more" style="width:100%;padding:12px;border:none;background:none;color:#2563eb;font-weight:700;font-size:14px;cursor:pointer">Show more (${h.length} of ${_})</button>`:h.length?`<div style="padding:10px;text-align:center;color:#94a3b8;font-size:12px">Showing ${h.length} of ${_} members</div>`:"";C.innerHTML=h.length||T?L+T:'<div class="qa-empty">No members found</div>',C.querySelectorAll("[data-qa-pick]").forEach(p=>{p.addEventListener("click",async()=>{if(w)return;w=!0;const R=Number(p.dataset.qaPick);p.style.background="#dcfce7";const z=await $("/api/mobile/v1/rrr/mappings/bulk-resolve",{method:"POST",body:{mappings:[{external_id:l,member_id:R}]}});z.ok&&z.data.linked===1?(c(`ID ${l} linked ✓`),M(),window.__refreshAccess&&window.__refreshAccess()):(c(z.error?.message||"Link failed — try again","error"),p.style.background="",w=!1)})}),C.querySelector("#qa-more")?.addEventListener("click",()=>{u+=1,A(!1)})};async function A(L){if(g)return;g=!0,L&&(u=1,h=[]);const T=await $(`/api/mobile/v1/members?page=${u}&page_size=30${q?`&q=${encodeURIComponent(q)}`:""}`);if(g=!1,T.ok){const p=T.data.members||[];_=T.data.pagination?.total??(L?p.length:h.length+p.length);const R=new Set(h.map(z=>z.id));h=L?p:[...h,...p.filter(z=>!R.has(z.id))]}S()}let j;b.addEventListener("input",()=>{clearTimeout(j),j=setTimeout(()=>{q=b.value.trim(),A(!0)},300)}),A(!0),b.focus()}export{re as default};
