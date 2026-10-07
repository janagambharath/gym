import{i as t,e as d,f as $,g as q,n as s,j as x,k as u,o as z,p as T,q as R,t as c,u as l,v as n,w as b,x as S,y as A}from"./index-DlIBw6ly.js";const L={async mount(r){const i=x(),v=i?.tenantName||"Your Gym",m=i?.userName||"";r.innerHTML=`
      <div class="app-header has-safe-top dash-top-bar">
        <div class="dash-brand-block">
          <img src="/icons/logo.png" alt="Renewal Desk" class="dash-brand-logo">
          <span class="dash-brand-name">Renewal Desk</span>
        </div>
        ${`
          <div class="dash-gym-pill">
            ${t("fitness",14,"var(--text-secondary)")}
            <span class="dash-gym-name">${d(v)}</span>
          </div>
        `}
        <div class="header-right">
          <button class="header-action" id="dash-notifications-btn" aria-label="Notifications">${t("notifications",22)}</button>
          <button class="header-action avatar-action" id="dash-settings-btn" aria-label="Settings">${$(m||v,"sm")}</button>
        </div>
      </div>
      <div class="scroll-view" id="dash-scroll">
        ${q()}
      </div>`,r.querySelector("#dash-notifications-btn")?.addEventListener("click",()=>s.push("notifications")),r.querySelector("#dash-settings-btn")?.addEventListener("click",()=>s.switchTab("more")),await k(r)}};async function k(r){const i=r.querySelector("#dash-scroll");if(!i)return;const m=x()?.userName||"",[o,y,g]=await Promise.all([u("/api/mobile/v1/dashboard"),u("/api/mobile/v1/renewals/upcoming"),u("/api/mobile/v1/payments?page_size=5")]);if(!o.ok){i.innerHTML=z(o.error.message,"dash-retry"),i.querySelector("#dash-retry")?.addEventListener("click",()=>k(r)),o.error.status===401&&T();return}const e=o.data,p=y.ok?y.data.members||[]:[],f=g.ok?g.data.payments||[]:[];i.innerHTML=`<div class="scroll-content">
    <div class="dash-greeting-card">
      <div style="font-size:var(--fs-2xl);font-weight:var(--fw-bold);color:var(--text)">${R()}, ${d(m.split(" ")[0]||"there")}</div>
      <div style="font-size:var(--fs-sm);color:var(--text-secondary);margin-top:2px">Here's the live view of what needs your attention today.</div>
    </div>
    <!-- Metrics Grid -->
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="metric-grid">
        ${c({label:"Active",value:l(e.total_active),iconName:"members",color:"var(--status-active)",bgColor:"var(--status-active-surface)",onClick:"members-active"})}
        ${c({label:"Expiring Soon",value:l(e.expiring_soon),iconName:"warning",color:"var(--status-expiring)",bgColor:"var(--status-expiring-surface)",onClick:"renewals"})}
        ${c({label:"Expired",value:l(e.expired),iconName:"time",color:"var(--status-expired)",bgColor:"var(--status-expired-surface)",onClick:"members-expired"})}
        ${c({label:"Pending Pay",value:l(e.pending_payments),iconName:"wallet",color:"var(--status-pending)",bgColor:"var(--status-pending-surface)",onClick:"payments-pending"})}
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
          <div class="quick-action-icon" style="background:var(--brand-subtle)">${t("add",20,"var(--brand)")}</div>
          <div class="quick-action-label">Add Member</div>
        </button>
        <button class="quick-action" data-action="renew">
          <div class="quick-action-icon" style="background:var(--success-surface)">${t("renewals",20,"var(--success)")}</div>
          <div class="quick-action-label">Renew</div>
        </button>
        <button class="quick-action" data-action="payment">
          <div class="quick-action-icon" style="background:var(--status-pending-surface)">${t("wallet",20,"var(--status-pending)")}</div>
          <div class="quick-action-label">Payment</div>
        </button>
        <button class="quick-action" data-action="whatsapp">
          <div class="quick-action-icon" style="background:#dcfce7">${t("whatsapp",20,"var(--whatsapp)")}</div>
          <div class="quick-action-label">WhatsApp</div>
        </button>
      </div>
    </div>

    ${e.bot_summary&&e.bot_summary.handover_count>0?`
    <!-- Handover Alert -->
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="card card-body" style="background:var(--warning-surface);border-color:var(--warning-border)" data-action="bot-conversations">
        <div style="display:flex;align-items:center;gap:var(--sp-md)">
          ${t("chatbubble",24,"var(--warning)")}
          <div style="flex:1">
            <div style="font-weight:var(--fw-bold);color:var(--warning-dark)">${e.bot_summary.handover_count} customer${e.bot_summary.handover_count>1?"s":""} need attention</div>
            <div style="font-size:var(--fs-sm);color:var(--warning)">AI bot has flagged conversations requiring human response</div>
          </div>
          ${t("chevronRight",18,"var(--warning)")}
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
              ${t(a.type==="expiring_today"?"warning":a.type==="pending_payments"?"wallet":"person",18,"var(--brand)")}
            </div>
            <div style="flex:1">
              <div style="font-weight:var(--fw-semibold)">${d(a.label)}</div>
              <div style="font-size:var(--fs-sm);color:var(--brand)">${d(a.action)}</div>
            </div>
            <span class="badge badge-pending">${a.count}</span>
          </div>
        </div>
      `).join("")}
    </div>`:""}

    <!-- Upcoming Renewals -->
    ${p.length>0?`
      ${b("Upcoming Renewals","View All","view-all-renewals")}
      <div class="card" style="margin:0 var(--sp-lg) var(--sp-lg)">
        ${p.slice(0,5).map(a=>S(a)).join("")}
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
    <!-- Live Access Card (matches Android app) -->
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="card card-body" data-action="access" style="cursor:pointer">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-sm)">
          <div style="display:flex;align-items:center;gap:var(--sp-xs);font-weight:var(--fw-bold);font-size:var(--fs-base)">
            ${t("access",18,"var(--brand)")}
            <span>Live Access</span>
          </div>
          <span style="font-size:var(--fs-xs);font-weight:var(--fw-semibold);color:var(--brand)">View Feed →</span>
        </div>

        <div style="display:flex;align-items:center;gap:var(--sp-xs);font-size:var(--fs-xs);color:var(--muted);margin-bottom:var(--sp-md)">
          <span style="width:8px;height:8px;border-radius:50%;background:${e.access_summary.device_online?"var(--success)":"var(--muted)"}"></span>
          <span>${d(e.access_summary.device_name||"Biometric Device")}: <b style="color:${e.access_summary.device_online?"var(--success)":"var(--muted)"}">${e.access_summary.device_online?"Online":"Offline"}</b></span>
          ${e.access_summary.last_event_at?`<span style="margin-left:auto">Last scan ${new Date(e.access_summary.last_event_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span>`:""}
        </div>

        <div style="display:grid;grid-template-columns:repeat(${e.access_summary.denied_today>0?4:3},1fr);gap:var(--sp-xs);text-align:center;background:var(--gray-50, #f8f9fa);padding:var(--sp-md) var(--sp-xs);border-radius:var(--r-md);border:1px solid var(--border-light)">
          <div>
            <div style="font-size:var(--fs-2xl);font-weight:var(--fw-extrabold);color:var(--status-active)">${e.access_summary.inside_now}</div>
            <div style="font-size:10px;color:var(--muted);font-weight:var(--fw-medium)">Inside Now</div>
          </div>
          <div style="border-left:1px solid var(--border-light)">
            <div style="font-size:var(--fs-2xl);font-weight:var(--fw-extrabold);color:var(--brand)">${e.access_summary.entries_today}</div>
            <div style="font-size:10px;color:var(--muted);font-weight:var(--fw-medium)">Entries</div>
          </div>
          <div style="border-left:1px solid var(--border-light)">
            <div style="font-size:var(--fs-2xl);font-weight:var(--fw-extrabold);color:var(--warning)">${e.access_summary.exits_today}</div>
            <div style="font-size:10px;color:var(--muted);font-weight:var(--fw-medium)">Exits</div>
          </div>
          ${e.access_summary.denied_today>0?`
          <div style="border-left:1px solid var(--border-light)">
            <div style="font-size:var(--fs-2xl);font-weight:var(--fw-extrabold);color:var(--critical)">${e.access_summary.denied_today}</div>
            <div style="font-size:10px;color:var(--critical);font-weight:var(--fw-medium)">Denied</div>
          </div>
          `:""}
        </div>
      </div>
    </div>`:""}
  </div>`,i.querySelectorAll("[data-action]").forEach(a=>{a.addEventListener("click",()=>{switch(a.dataset.action){case"add-member":s.push("add-member");break;case"renew":s.switchTab("renewals");break;case"payment":s.push("record-payment");break;case"whatsapp":s.push("whatsapp");break;case"bot-conversations":s.push("bot-conversations");break;case"members-active":s.switchTab("members");break;case"members-expired":s.switchTab("members");break;case"renewals":s.switchTab("renewals");break;case"payments-pending":s.switchTab("payments");break;case"access":s.switchTab("access");break;case"action-expiring_today":s.switchTab("renewals");break;case"action-pending_payments":s.switchTab("payments");break;case"action-new_leads":s.push("bot-leads");break}})}),i.querySelector("#view-all-renewals")?.addEventListener("click",()=>s.switchTab("renewals")),i.querySelector("#view-all-payments")?.addEventListener("click",()=>s.switchTab("payments")),i.querySelectorAll("[data-member-id]").forEach(a=>{a.addEventListener("click",()=>{const w=a.dataset.memberId,h=p.find(_=>String(_.id)===w);h&&s.push("member-detail",{member:JSON.stringify(h)})})}),i.querySelectorAll("[data-payment-id]").forEach(a=>{a.addEventListener("click",()=>{s.push("payment-detail",{paymentId:a.dataset.paymentId})})})}export{L as default};
