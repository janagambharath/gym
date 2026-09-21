import{i,e as l,f as _,g as q,n as s,j as k,k as u,o as R,p as S,q as z,t as o,u as c,v as n,w as b,x as T,y as A}from"./index-DcA9rnoc.js";const C={async mount(r){const t=k(),v=t?.tenantName||"Your Gym",p=t?.userName||"";r.innerHTML=`
      <div class="app-header has-safe-top dash-top-bar">
        <div class="dash-brand-block">
          <img src="/icons/logo.png" alt="Renewal Desk" class="dash-brand-logo">
          <span class="dash-brand-name">Renewal Desk</span>
        </div>
        ${`
          <div class="dash-gym-pill">
            ${i("fitness",14,"var(--text-secondary)")}
            <span class="dash-gym-name">${l(v)}</span>
          </div>
        `}
        <div class="header-right">
          <button class="header-action" id="dash-notifications-btn" aria-label="Notifications">${i("notifications",22)}</button>
          <button class="header-action avatar-action" id="dash-settings-btn" aria-label="Settings">${_(p||v,"sm")}</button>
        </div>
      </div>
      <div class="scroll-view" id="dash-scroll">
        ${q()}
      </div>`,r.querySelector("#dash-notifications-btn")?.addEventListener("click",()=>s.push("notifications")),r.querySelector("#dash-settings-btn")?.addEventListener("click",()=>s.push("settings")),await x(r)}};async function x(r){const t=r.querySelector("#dash-scroll");if(!t)return;const p=k()?.userName||"",[d,y,g]=await Promise.all([u("/api/mobile/v1/dashboard"),u("/api/mobile/v1/renewals/upcoming"),u("/api/mobile/v1/payments?page_size=5")]);if(!d.ok){t.innerHTML=R(d.error.message,"dash-retry"),t.querySelector("#dash-retry")?.addEventListener("click",()=>x(r)),d.error.status===401&&S();return}const e=d.data,m=y.ok?y.data.members||[]:[],f=g.ok?g.data.payments||[]:[];t.innerHTML=`<div class="scroll-content">
    <div class="dash-greeting-card">
      <div style="font-size:var(--fs-2xl);font-weight:var(--fw-bold);color:var(--text)">${z()}, ${l(p.split(" ")[0]||"there")}</div>
      <div style="font-size:var(--fs-sm);color:var(--text-secondary);margin-top:2px">Here's the live view of what needs your attention today.</div>
    </div>
    <!-- Metrics Grid -->
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="metric-grid">
        ${o({label:"Active",value:c(e.total_active),iconName:"members",color:"var(--status-active)",bgColor:"var(--status-active-surface)",onClick:"members-active"})}
        ${o({label:"Expiring Soon",value:c(e.expiring_soon),iconName:"warning",color:"var(--status-expiring)",bgColor:"var(--status-expiring-surface)",onClick:"renewals"})}
        ${o({label:"Expired",value:c(e.expired),iconName:"time",color:"var(--status-expired)",bgColor:"var(--status-expired-surface)",onClick:"members-expired"})}
        ${o({label:"Pending Pay",value:c(e.pending_payments),iconName:"wallet",color:"var(--status-pending)",bgColor:"var(--status-pending-surface)",onClick:"payments-pending"})}
      </div>
    </div>

    <!-- Revenue Card -->
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="revenue-card">
        <div class="revenue-card-label">Revenue Today</div>
        <div class="revenue-card-value">${n(e.revenue_today||"0")}</div>
        <div class="revenue-breakdown">
          <div class="revenue-breakdown-item">
            <div class="revenue-breakdown-label">This Week</div>
            <div class="revenue-breakdown-value">${n(e.revenue_week||"0")}</div>
          </div>
          <div class="revenue-breakdown-item">
            <div class="revenue-breakdown-label">This Month</div>
            <div class="revenue-breakdown-value">${n(e.revenue_month||"0")}</div>
          </div>
        </div>
      </div>
    </div>

    ${e.recovery_rate?`
    <!-- Recovery Rate -->
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="card card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-md)">
          <div>
            <div style="font-size:var(--fs-sm);color:var(--text-secondary)">Revenue at Risk</div>
            <div style="font-size:var(--fs-3xl);font-weight:var(--fw-extrabold);color:var(--status-expiring)">${n(e.recovery_rate.revenue_at_risk)}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:var(--fs-sm);color:var(--text-secondary)">Recovered</div>
            <div style="font-size:var(--fs-3xl);font-weight:var(--fw-extrabold);color:var(--status-active)">${n(e.recovery_rate.revenue_recovered)}</div>
          </div>
        </div>
        <div class="progress-bar">
          <div class="progress-bar-fill" style="width:${Math.min(parseFloat(e.recovery_rate.recovery_rate)||0,100)}%;background:var(--success)"></div>
        </div>
        <div style="font-size:var(--fs-xs);color:var(--muted);margin-top:var(--sp-xs);text-align:center">${e.recovery_rate.recovery_rate}% recovery rate</div>
      </div>
    </div>`:""}

    <!-- Quick Actions -->
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="quick-actions">
        <button class="quick-action" data-action="add-member">
          <div class="quick-action-icon" style="background:var(--brand-subtle)">${i("add",20,"var(--brand)")}</div>
          <div class="quick-action-label">Add Member</div>
        </button>
        <button class="quick-action" data-action="renew">
          <div class="quick-action-icon" style="background:var(--success-surface)">${i("renewals",20,"var(--success)")}</div>
          <div class="quick-action-label">Renew</div>
        </button>
        <button class="quick-action" data-action="payment">
          <div class="quick-action-icon" style="background:var(--status-pending-surface)">${i("wallet",20,"var(--status-pending)")}</div>
          <div class="quick-action-label">Payment</div>
        </button>
        <button class="quick-action" data-action="whatsapp">
          <div class="quick-action-icon" style="background:#dcfce7">${i("whatsapp",20,"var(--whatsapp)")}</div>
          <div class="quick-action-label">WhatsApp</div>
        </button>
      </div>
    </div>

    ${e.bot_summary&&e.bot_summary.handover_count>0?`
    <!-- Handover Alert -->
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="card card-body" style="background:var(--warning-surface);border-color:var(--warning-border)" data-action="bot-conversations">
        <div style="display:flex;align-items:center;gap:var(--sp-md)">
          ${i("chatbubble",24,"var(--warning)")}
          <div style="flex:1">
            <div style="font-weight:var(--fw-bold);color:var(--warning-dark)">${e.bot_summary.handover_count} customer${e.bot_summary.handover_count>1?"s":""} need attention</div>
            <div style="font-size:var(--fs-sm);color:var(--warning)">AI bot has flagged conversations requiring human response</div>
          </div>
          ${i("chevronRight",18,"var(--warning)")}
        </div>
      </div>
    </div>`:""}

    ${e.todays_actions&&e.todays_actions.length>0?`
    <!-- Today's Actions -->
    ${b("Today's Actions")}
    <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;flex-direction:column;gap:var(--sp-sm)">
      ${e.todays_actions.map(a=>`
        <div class="card card-body" style="padding:var(--sp-md) var(--sp-lg);cursor:pointer" data-action="action-${a.type}">
          <div style="display:flex;align-items:center;gap:var(--sp-md)">
            <div style="width:36px;height:36px;border-radius:var(--r-md);background:var(--brand-subtle);display:flex;align-items:center;justify-content:center">
              ${i(a.type==="expiring_today"?"warning":a.type==="pending_payments"?"wallet":"person",18,"var(--brand)")}
            </div>
            <div style="flex:1">
              <div style="font-weight:var(--fw-semibold)">${l(a.label)}</div>
              <div style="font-size:var(--fs-sm);color:var(--brand)">${l(a.action)}</div>
            </div>
            <span class="badge badge-pending">${a.count}</span>
          </div>
        </div>
      `).join("")}
    </div>`:""}

    <!-- Upcoming Renewals -->
    ${m.length>0?`
      ${b("Upcoming Renewals","View All","view-all-renewals")}
      <div class="card" style="margin:0 var(--sp-lg) var(--sp-lg)">
        ${m.slice(0,5).map(a=>T(a)).join("")}
      </div>
    `:""}

    <!-- Recent Payments -->
    ${f.length>0?`
      ${b("Recent Payments","View All","view-all-payments")}
      <div class="card" style="margin:0 var(--sp-lg) var(--sp-lg)">
        ${f.slice(0,5).map(a=>A(a)).join("")}
      </div>
    `:""}

    ${e.access_summary?`
    <!-- Access Summary -->
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="card card-body" data-action="access">
        <div style="display:flex;align-items:center;gap:var(--sp-md);margin-bottom:var(--sp-md)">
          ${i("access",20,"var(--brand)")}
          <div style="font-weight:var(--fw-bold)">Access Control</div>
          <div style="margin-left:auto;display:flex;align-items:center;gap:var(--sp-xs)">
            <span style="width:8px;height:8px;border-radius:50%;background:${e.access_summary.device_online?"var(--success)":"var(--muted)"}"></span>
            <span style="font-size:var(--fs-xs);color:var(--muted)">${e.access_summary.device_online?"Online":"Offline"}</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-md);text-align:center">
          <div>
            <div style="font-size:var(--fs-3xl);font-weight:var(--fw-extrabold);color:var(--brand)">${e.access_summary.inside_now}</div>
            <div style="font-size:var(--fs-xs);color:var(--muted)">Inside Now</div>
          </div>
          <div>
            <div style="font-size:var(--fs-3xl);font-weight:var(--fw-extrabold);color:var(--success)">${e.access_summary.entries_today}</div>
            <div style="font-size:var(--fs-xs);color:var(--muted)">Entries</div>
          </div>
          <div>
            <div style="font-size:var(--fs-3xl);font-weight:var(--fw-extrabold);color:var(--text-secondary)">${e.access_summary.exits_today}</div>
            <div style="font-size:var(--fs-xs);color:var(--muted)">Exits</div>
          </div>
        </div>
      </div>
    </div>`:""}
  </div>`,t.querySelectorAll("[data-action]").forEach(a=>{a.addEventListener("click",()=>{switch(a.dataset.action){case"add-member":s.push("add-member");break;case"renew":s.switchTab("renewals");break;case"payment":s.push("record-payment");break;case"whatsapp":s.push("whatsapp");break;case"bot-conversations":s.push("bot-conversations");break;case"members-active":s.switchTab("members");break;case"members-expired":s.switchTab("members");break;case"renewals":s.switchTab("renewals");break;case"payments-pending":s.switchTab("payments");break;case"access":s.push("access");break;case"action-expiring_today":s.switchTab("renewals");break;case"action-pending_payments":s.switchTab("payments");break;case"action-new_leads":s.push("bot-leads");break}})}),t.querySelector("#view-all-renewals")?.addEventListener("click",()=>s.switchTab("renewals")),t.querySelector("#view-all-payments")?.addEventListener("click",()=>s.switchTab("payments")),t.querySelectorAll("[data-member-id]").forEach(a=>{a.addEventListener("click",()=>{const h=a.dataset.memberId,w=m.find($=>String($.id)===h);w&&s.push("member-detail",{member:JSON.stringify(w)})})}),t.querySelectorAll("[data-payment-id]").forEach(a=>{a.addEventListener("click",()=>{s.push("payment-detail",{paymentId:a.dataset.paymentId})})})}export{C as default};
