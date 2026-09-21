import{i,e as n,f as m,g as N,n as t,j as S,k as p,o as M,p as z,q as D,t as o,u,v as I,w as q,x as E,y as P}from"./index-1Q0YpctZ.js";const C={async mount(s){const l=S(),b=l?.tenantName||"My Gym",y=l?.userName||"";s.innerHTML=`
      <div class="app-header has-safe-top dash-top-bar">
        <div class="dash-brand-block">
          <img src="/icons/logo.png" alt="Renewal Desk" class="dash-brand-logo">
          <span class="dash-brand-name">Renewal Desk</span>
        </div>
        ${`
          <div class="dash-gym-pill" id="dash-gym-selector">
            ${i("fitness",14,"var(--text-secondary)")}
            <span class="dash-gym-name">${n(b)}</span>
            ${i("forward",12,"var(--muted)")}
          </div>
        `}
        <div class="header-right">
          <button class="header-action" id="dash-notifications-btn" aria-label="Notifications" style="position:relative">
            ${i("notifications",22)}
            <span class="notification-dot" id="dash-notification-dot" style="display:none"></span>
          </button>
          <button class="header-action avatar-action" id="dash-settings-btn" aria-label="Settings">${m(y||b,"sm")}</button>
        </div>
      </div>
      <div class="scroll-view" id="dash-scroll">
        ${N()}
      </div>`,s.querySelector("#dash-notifications-btn")?.addEventListener("click",()=>t.push("notifications")),s.querySelector("#dash-settings-btn")?.addEventListener("click",()=>t.push("settings")),s.querySelector("#dash-gym-selector")?.addEventListener("click",()=>t.push("settings")),await L(s)}};async function L(s){const l=s.querySelector("#dash-scroll");if(!l)return;const y=S()?.userName||"",[v,h,f,w]=await Promise.all([p("/api/mobile/v1/dashboard"),p("/api/mobile/v1/renewals/upcoming"),p("/api/mobile/v1/payments?page_size=5"),p("/api/mobile/v1/onboarding/progress")]);if(!v.ok){l.innerHTML=M(v.error.message,"dash-retry"),l.querySelector("#dash-retry")?.addEventListener("click",()=>L(s)),v.error.status===401&&z();return}const a=v.data,$=h.ok?h.data.members||[]:[],_=f.ok?f.data.payments||[]:[],c=w.ok?w.data:null,T=!!(a&&(a.expiring_soon>0||a.pending_payments>0||a.expired>0||(a.bot_summary?.handover_count??0)>0)),x=s.querySelector("#dash-notification-dot");x&&(x.style.display=T?"block":"none");let r='<div class="scroll-content">';if(r+=`
    <div class="dash-greeting-card">
      <div style="font-size:var(--fs-2xl);font-weight:var(--fw-bold);color:var(--text)">${D()}, ${n(y.split(" ")[0]||"there")}</div>
      <div style="font-size:var(--fs-sm);color:var(--text-secondary);margin-top:2px">Here's the live view of what needs your attention today.</div>
    </div>`,a.total_active===0&&(r+=`
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="first-action-card">
        <div class="first-action-header">
          <div class="first-action-badge">
            ${i("flash",12,"#ffffff")}
            <span>GET STARTED</span>
          </div>
          <div class="first-action-title">Bring Your Members In</div>
        </div>
        <div class="first-action-sub">
          Import spreadsheets, scan paper registers, or add members to track upcoming expiries, prevent churn, and collect fees.
        </div>
        <div class="first-action-buttons">
          <button class="first-action-primary-btn" id="hero-import-btn">
            ${i("upload",16,"#ffffff")}
            <span>Import Existing Members (Excel / CSV)</span>
          </button>
          <div class="first-action-secondary-row">
            <button class="first-action-secondary-btn" id="hero-scan-btn">
              ${i("camera",15,"var(--brand)")}
              <span>Scan Records</span>
            </button>
            <button class="first-action-secondary-btn" id="hero-add-btn">
              ${i("add",15,"var(--text)")}
              <span>Add Manually</span>
            </button>
          </div>
        </div>
      </div>
    </div>`),c&&!c.is_complete&&c.steps&&c.steps.length>0&&(r+=`
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="onboarding-card" id="onboarding-card">
        <div class="onboarding-header" id="onboarding-toggle" style="cursor:pointer">
          <div class="onboarding-header-left">
            <div class="onboarding-progress-badge">${c.percentage}%</div>
            <div>
              <div style="font-weight:var(--fw-bold);font-size:var(--fs-base);color:var(--text)">Set Up Your Gym</div>
              <div style="font-size:var(--fs-xs);color:var(--text-secondary)">${c.completed_count} of ${c.total_count} steps completed</div>
            </div>
          </div>
          <div class="expand-icon-circle" id="onboarding-chevron">
            ${i("chevronDown",18,"var(--text-secondary)")}
          </div>
        </div>
        <div class="onboarding-progress-bg">
          <div class="onboarding-progress-fill" style="width:${Math.max(c.percentage,5)}%"></div>
        </div>
        <div class="onboarding-steps" id="onboarding-steps-list">
          ${c.steps.map(e=>`
            <div class="onboarding-step-row ${e.completed?"completed":""}" data-step-route="${n(e.route||"")}">
              <div class="onboarding-step-icon">
                ${e.completed?i("check",16,"var(--success)"):i("time",16,"var(--muted)")}
              </div>
              <div class="onboarding-step-copy">
                <div class="onboarding-step-title ${e.completed?"title-completed":""}">${n(e.title)}</div>
                ${!e.completed&&e.description?`<div class="onboarding-step-desc">${n(e.description)}</div>`:""}
              </div>
              ${!e.completed&&e.action_label?`<div class="onboarding-step-action-badge">${n(e.action_label)}</div>`:""}
              ${!e.completed&&e.route?`<div style="margin-left:4px">${i("forward",14,"var(--brand)")}</div>`:""}
            </div>
          `).join("")}
        </div>
      </div>
    </div>`),a.bot_summary?.recent_handovers&&a.bot_summary.recent_handovers.length>0&&(r+=`
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="handover-alert-card">
        <div class="handover-alert-header">
          <div class="handover-badge">
            ${i("alert",14,"var(--critical)")}
            <span>${a.bot_summary.handover_count} STAFF HANDOVER${a.bot_summary.handover_count>1?"S":""} WAITING</span>
          </div>
          <button class="handover-view-all" id="btn-view-all-handovers">View All Chats →</button>
        </div>
        <div class="handover-alert-title">Prospective customers asked to speak with staff</div>
        <div class="handover-list">
          ${a.bot_summary.recent_handovers.map(e=>`
            <div class="handover-item" data-action="open-chat" data-convo-id="${e.id}">
              ${m(e.customer_name||"Customer","sm")}
              <div class="handover-info">
                <div class="handover-name-row">
                  <span class="handover-name">${n(e.customer_name||"Visitor")}</span>
                  <span class="handover-phone">+${n(e.phone||"")}</span>
                </div>
                <div class="handover-message">“${n(e.last_message||"")}”</div>
              </div>
              <div class="handover-action-btn">
                <span>Reply</span>
                ${i("forward",12,"var(--brand)")}
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    </div>`),a.total_active>0){const e=a.revenue_at_risk||a.recovery_rate?.revenue_at_risk||"0",d=a.revenue_recovered?.total_amount||a.recovery_rate?.revenue_recovered||"0",R=a.recovery_rate?.recovery_rate??"0";r+=`
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="revenue-hero-card">
        <div class="revenue-hero-header">
          <div class="revenue-hero-badge">
            ${i("cash",12,"#ffffff")}
            <span>REVENUE RECOVERY</span>
          </div>
        </div>
        <div class="revenue-hero-row">
          <div class="revenue-hero-stat">
            <div class="revenue-hero-label">At Risk</div>
            <div class="revenue-hero-value" style="color:var(--critical)">${o(e)}</div>
          </div>
          <div class="revenue-hero-divider"></div>
          <div class="revenue-hero-stat">
            <div class="revenue-hero-label">Recovered (30d)</div>
            <div class="revenue-hero-value" style="color:var(--success)">${o(d)}</div>
          </div>
          <div class="revenue-hero-divider"></div>
          <div class="revenue-hero-stat">
            <div class="revenue-hero-label">Rate</div>
            <div class="revenue-hero-value" style="color:var(--brand)">${R}%</div>
          </div>
        </div>
        ${a.latest_campaign?`
          <div class="campaign-callout">
            ${i("target",14,"var(--brand)")}
            <div class="campaign-callout-text">
              Last campaign "${n(a.latest_campaign.name)}" → ${a.latest_campaign.total_renewed} renewed
              ${parseFloat(a.latest_campaign.total_revenue_recovered||"0")>0?` · ${o(a.latest_campaign.total_revenue_recovered)}`:""}
            </div>
          </div>
        `:""}
      </div>
    </div>`}if(a.todays_actions&&a.todays_actions.length>0&&(r+=`
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="today-actions-card">
        <div class="section-header-compact">
          <div style="display:flex;align-items:center;gap:var(--sp-xs);font-weight:var(--fw-bold);font-size:var(--fs-base)">
            ${i("flash",18,"var(--warning)")}
            <span>Today's Actions</span>
          </div>
        </div>
        <div style="margin-top:var(--sp-xs)">
          ${a.todays_actions.map(e=>{const d=e.type==="expiring_today"?"var(--critical)":e.type==="pending_payments"?"var(--warning)":"var(--brand)";return`
              <div class="today-action-item" data-action="today-${n(e.action||e.type)}">
                <div class="today-action-dot" style="background:${d}"></div>
                <div class="today-action-label">${n(e.label)}</div>
                ${e.count?`<span class="badge badge-pending" style="margin-right:var(--sp-xs)">${e.count}</span>`:""}
                ${i("forward",14,"var(--muted)")}
              </div>`}).join("")}
        </div>
      </div>
    </div>`),r+=`
  <div style="padding:0 var(--sp-lg) var(--sp-lg)">
    <div class="card card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-md)">
        <div style="display:flex;align-items:center;gap:var(--sp-xs);font-weight:var(--fw-bold);font-size:var(--fs-base)">
          ${i("cash",18,"var(--success)")}
          <span>Revenue Collected</span>
        </div>
        <div class="period-pill">Live totals</div>
      </div>
      <div class="revenue-grid-3">
        <div class="revenue-item">
          <div class="revenue-sublabel">Today</div>
          <div class="revenue-mainvalue">${o(a.revenue_today||"0")}</div>
        </div>
        <div class="revenue-item bordered">
          <div class="revenue-sublabel">This Week</div>
          <div class="revenue-mainvalue">${o(a.revenue_week||"0")}</div>
        </div>
        <div class="revenue-item bordered">
          <div class="revenue-sublabel">This Month</div>
          <div class="revenue-mainvalue">${o(a.revenue_month||"0")}</div>
        </div>
      </div>
      ${a.revenue_today==="0"&&a.revenue_week==="0"&&a.revenue_month==="0"?`
        <div style="font-size:var(--fs-xs);color:var(--muted);text-align:center;margin-top:var(--sp-sm)">
          No payments recorded yet. Live totals will update as member fee collections are verified.
        </div>
      `:""}
      ${a.revenue_at_risk&&Number(a.revenue_at_risk)>0?`
        <div class="revenue-at-risk-banner" id="risk-banner" style="cursor:pointer">
          <div class="risk-icon-wrap">
            ${i("warning",16,"var(--critical)")}
          </div>
          <div class="risk-text-wrap">
            <div class="risk-label">Revenue at Risk (7 Days)</div>
            <div class="risk-subtext">${a.expiring_soon||0} memberships expiring soon</div>
          </div>
          <div class="risk-amount">${o(a.revenue_at_risk)}</div>
        </div>
      `:""}
    </div>
  </div>`,r+=`
  <div style="padding:0 var(--sp-lg) var(--sp-lg)">
    <div class="metric-grid">
      <div class="metric-card" data-action="members-active" style="cursor:pointer">
        <div class="metric-icon" style="background:var(--brand-subtle)">${i("members",18,"var(--brand)")}</div>
        <div class="metric-label">Active Members</div>
        <div class="metric-value">${u(a.total_active||0)}</div>
        <div class="metric-detail">${a.total_active===0?"No members added yet":"Current total"}</div>
      </div>
      <div class="metric-card" data-action="renewals" style="cursor:pointer">
        <div class="metric-icon" style="background:var(--status-expiring-surface)">${i("time",18,"var(--status-expiring)")}</div>
        <div class="metric-label">Expiring Soon</div>
        <div class="metric-value">${u(a.expiring_soon||0)}</div>
        <div class="metric-detail" style="color:var(--status-expiring)">${a.expiring_today?`${a.expiring_today} today`:a.expiring_soon>0?"Next 7 days":"None expiring"}</div>
      </div>
      <div class="metric-card" data-action="members-expired" style="cursor:pointer">
        <div class="metric-icon" style="background:var(--status-expired-surface)">${i("alert",18,"var(--status-expired)")}</div>
        <div class="metric-label">Expired</div>
        <div class="metric-value">${u(a.expired||0)}</div>
        <div class="metric-detail" style="color:var(--status-expired)">${a.expired>0?"Need attention":"None expired"}</div>
      </div>
      <div class="metric-card" data-action="payments-pending" style="cursor:pointer">
        <div class="metric-icon" style="background:var(--status-pending-surface)">${i("wallet",18,"var(--status-pending)")}</div>
        <div class="metric-label">Pending Payments</div>
        <div class="metric-value">${u(a.pending_payments||0)}</div>
        <div class="metric-detail" style="color:var(--status-pending)">${a.pending_payments>0?"Awaiting review":"All clear"}</div>
      </div>
    </div>
  </div>`,a.access_summary){const e=a.access_summary;r+=`
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="card card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-sm)">
          <div style="display:flex;align-items:center;gap:var(--sp-xs);font-weight:var(--fw-bold);font-size:var(--fs-base)">
            ${i("access",18,"var(--brand)")}
            <span>Live Access</span>
          </div>
          <button class="section-action-btn" id="btn-view-access-feed">View Feed →</button>
        </div>
        <div class="access-device-status-row">
          <span class="device-dot" style="background:${e.device_online?"var(--success)":"var(--muted)"}"></span>
          <span style="font-size:var(--fs-xs);color:var(--text-secondary);font-weight:var(--fw-medium)">
            ${n(e.device_name||"Biometric Device")}: ${e.device_online?"Online":"Offline"}
          </span>
          ${e.last_event_at?`
            <span style="font-size:var(--fs-xs);color:var(--muted);margin-left:auto">
              Last scan ${new Date(e.last_event_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
            </span>
          `:""}
        </div>
        <div class="access-stats-grid">
          <div class="access-tile" id="access-tile-inside" style="cursor:pointer">
            <div class="access-tile-value" style="color:var(--success)">${e.inside_now??0}</div>
            <div class="access-tile-label">Inside Now</div>
          </div>
          <div class="access-tile bordered" id="access-tile-entries" style="cursor:pointer">
            <div class="access-tile-value" style="color:var(--brand)">${e.entries_today??0}</div>
            <div class="access-tile-label">Entries Today</div>
          </div>
          <div class="access-tile bordered" id="access-tile-exits" style="cursor:pointer">
            <div class="access-tile-value" style="color:var(--warning)">${e.exits_today??0}</div>
            <div class="access-tile-label">Exits Today</div>
          </div>
          ${e.denied_today>0?`
            <div class="access-tile bordered" id="access-tile-denied" style="cursor:pointer">
              <div class="access-tile-value" style="color:var(--critical)">${e.denied_today}</div>
              <div class="access-tile-label">Denied</div>
            </div>
          `:""}
        </div>
      </div>
    </div>`}r+=`
  <div style="padding:0 var(--sp-lg) var(--sp-lg)">
    <div class="card card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-sm)">
        <div style="display:flex;align-items:center;gap:var(--sp-xs);font-weight:var(--fw-bold);font-size:var(--fs-base)">
          ${i("robot",18,"var(--brand)")}
          <span>Inbound Leads & AI Bot</span>
        </div>
        <button class="section-action-btn" id="btn-view-all-leads">View All Leads →</button>
      </div>
      <div class="leads-stats-row">
        <div class="lead-stat-tile" id="lead-stat-total" style="cursor:pointer">
          <div class="lead-stat-val">${a.bot_summary?.total_leads??0}</div>
          <div class="lead-stat-lbl">Total Leads</div>
        </div>
        <div class="lead-stat-tile bordered" id="lead-stat-new" style="cursor:pointer">
          <div class="lead-stat-val" style="color:var(--brand)">${a.bot_summary?.new_leads??0}</div>
          <div class="lead-stat-lbl">New Inquiries</div>
        </div>
        <div class="lead-stat-tile bordered" id="lead-stat-trials" style="cursor:pointer">
          <div class="lead-stat-val" style="color:var(--success)">${a.bot_summary?.trial_requests??0}</div>
          <div class="lead-stat-lbl">Free Trials</div>
        </div>
        <div class="lead-stat-tile bordered" id="lead-stat-handovers" style="cursor:pointer">
          <div class="lead-stat-val" style="color:${(a.bot_summary?.handover_count??0)>0?"var(--critical)":"var(--text-secondary)"}">
            ${a.bot_summary?.handover_count??0}
          </div>
          <div class="lead-stat-lbl">Handovers</div>
        </div>
      </div>
      <div class="leads-actions-row">
        <button class="btn btn-outline btn-sm" id="btn-open-ai-chats" style="flex:1">
          ${i("chatbubble",16,"var(--brand)")}
          <span>Open AI Chats</span>
        </button>
        <button class="btn btn-primary btn-sm" id="btn-open-broadcast" style="flex:1">
          ${i("send",16,"#ffffff")}
          <span>Broadcast / WhatsApp</span>
        </button>
      </div>
    </div>
  </div>`,(a.expiring_soon>0||a.pending_payments>0||a.expired>0)&&(r+=`
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="card card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-sm)">
          <div style="display:flex;align-items:center;gap:var(--sp-xs);font-weight:var(--fw-bold);font-size:var(--fs-base)">
            ${i("warning",18,"var(--status-expiring)")}
            <span>Attention Required</span>
          </div>
          <button class="section-action-btn" id="btn-view-all-attention">View all →</button>
        </div>
        <div class="attention-grid">
          ${a.expiring_soon>0?`
            <div class="attention-tile" id="attention-tile-expiring" style="cursor:pointer">
              <div class="attention-val" style="color:var(--status-expiring)">${a.expiring_soon}</div>
              <div class="attention-lbl">Expiring soon</div>
              ${i("forward",12,"var(--muted)")}
            </div>
          `:""}
          ${a.pending_payments>0?`
            <div class="attention-tile" id="attention-tile-pending" style="cursor:pointer">
              <div class="attention-val" style="color:var(--status-pending)">${a.pending_payments}</div>
              <div class="attention-lbl">Pending payments</div>
              ${i("forward",12,"var(--muted)")}
            </div>
          `:""}
          ${a.expired>0?`
            <div class="attention-tile" id="attention-tile-expired" style="cursor:pointer">
              <div class="attention-val" style="color:var(--status-expired)">${a.expired}</div>
              <div class="attention-lbl">Expired members</div>
              ${i("forward",12,"var(--muted)")}
            </div>
          `:""}
        </div>
      </div>
    </div>`),r+=`
  <div style="padding:0 var(--sp-lg) var(--sp-lg)">
    <div class="card card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-sm)">
        <div style="display:flex;align-items:center;gap:var(--sp-xs);font-weight:var(--fw-bold);font-size:var(--fs-base)">
          ${i("renewals",18,"var(--brand)")}
          <span>Upcoming Renewals</span>
        </div>
        <button class="section-action-btn" id="btn-view-all-renewals">View All →</button>
      </div>
      ${$.length>0?`
        <div class="upcoming-list">
          ${$.slice(0,5).map(e=>{const d=I(e.days_until_expiry);return`
              <div class="upcoming-row-item">
                <div class="upcoming-row-main" data-member-id="${e.id}" style="cursor:pointer">
                  ${m(e.full_name,"md")}
                  <div class="upcoming-info">
                    <div class="upcoming-name">${n(e.full_name)}</div>
                    <div class="upcoming-detail">${n(e.plan?.name||"Plan not set")} ${e.plan?.duration_days?`· ${e.plan.duration_days}d`:""}</div>
                  </div>
                  <div class="upcoming-right">
                    <div class="upcoming-date">${q(e.membership_end)}</div>
                    ${d?`<div class="upcoming-days">${d}</div>`:""}
                    ${E(P(e))}
                  </div>
                </div>
                <button class="upcoming-renew-btn" data-renew-member='${n(JSON.stringify(e))}'>Renew</button>
              </div>`}).join("")}
        </div>
      `:`
        <div class="empty-card-box">
          <div class="empty-card-title">No memberships expiring in the next 7 days</div>
          <div class="empty-card-sub">When member expiries approach, they will appear here with 1-tap renewal actions.</div>
        </div>
      `}
    </div>
  </div>`,r+=`
  <div style="padding:0 var(--sp-lg) var(--sp-lg)">
    <div class="card card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-sm)">
        <div style="display:flex;align-items:center;gap:var(--sp-xs);font-weight:var(--fw-bold);font-size:var(--fs-base)">
          ${i("cash",18,"var(--brand)")}
          <span>Recent Payments</span>
        </div>
        <button class="section-action-btn" id="btn-view-all-payments">View All →</button>
      </div>
      ${_.length>0?`
        <div class="payments-list">
          ${_.slice(0,5).map(e=>`
            <div class="dash-payment-row" data-payment-id="${e.id}" style="cursor:pointer">
              ${m(e.member_name||"M","md")}
              <div class="dash-payment-info">
                <div class="dash-payment-name">${n(e.member_name||`Member #${e.member_id}`)}</div>
                <div class="dash-payment-detail">${n(e.method?.toUpperCase()||"PAYMENT")} · ${q(e.paid_on||e.created_at)}</div>
              </div>
              <div class="dash-payment-right">
                <div class="dash-payment-amount">${o(e.amount)}</div>
                ${E(e.status)}
              </div>
            </div>
          `).join("")}
        </div>
      `:`
        <div class="empty-card-box">
          <div class="empty-card-title">No payments recorded yet</div>
          <div class="empty-card-sub">Tap Payment below to record your first member fee collection.</div>
        </div>
      `}
    </div>
  </div>`,r+=`
  <div style="padding:0 var(--sp-lg) var(--sp-lg)">
    <div class="quick-actions-card">
      <div class="quick-actions-row">
        <button class="quick-action-tile" id="qa-add-member">
          <div class="quick-action-icon-wrap" style="background:var(--brand-subtle);color:var(--brand)">
            ${i("add",21,"var(--brand)")}
          </div>
          <span class="quick-action-text">Add Member</span>
        </button>
        <button class="quick-action-tile" id="qa-renew">
          <div class="quick-action-icon-wrap" style="background:var(--brand-subtle);color:var(--brand)">
            ${i("renewals",21,"var(--brand)")}
          </div>
          <span class="quick-action-text">Renew</span>
        </button>
        <button class="quick-action-tile" id="qa-payment">
          <div class="quick-action-icon-wrap" style="background:var(--brand-subtle);color:var(--brand)">
            ${i("wallet",21,"var(--brand)")}
          </div>
          <span class="quick-action-text">Payment</span>
        </button>
        <button class="quick-action-tile" id="qa-whatsapp">
          <div class="quick-action-icon-wrap" style="background:#dcfce7;color:var(--whatsapp)">
            ${i("whatsapp",21,"var(--whatsapp)")}
          </div>
          <span class="quick-action-text">WhatsApp</span>
        </button>
      </div>
    </div>
  </div>`,r+="</div>",l.innerHTML=r,s.querySelector("#hero-import-btn")?.addEventListener("click",()=>t.push("import-members")),s.querySelector("#hero-scan-btn")?.addEventListener("click",()=>t.push("member-scan")),s.querySelector("#hero-add-btn")?.addEventListener("click",()=>t.push("add-member")),s.querySelector("#onboarding-card");const A=s.querySelector("#onboarding-toggle"),g=s.querySelector("#onboarding-steps-list"),k=s.querySelector("#onboarding-chevron");A?.addEventListener("click",()=>{const e=g?.style.display==="none";g&&(g.style.display=e?"block":"none"),k&&(k.innerHTML=e?i("chevronUp",18,"var(--text-secondary)"):i("chevronDown",18,"var(--text-secondary)"))}),s.querySelectorAll("[data-step-route]").forEach(e=>{e.addEventListener("click",()=>{const d=e.dataset.stepRoute;d&&(d==="Subscription"?t.push("subscription"):d==="Settings"?t.push("settings"):d==="Plans"?t.push("plans"):d==="Members"?t.push("import-members"):d==="WhatsApp"?t.push("whatsapp"):d==="PaymentSetup"?t.push("payment-setup"):d==="Renewals"?t.push("record-payment"):d==="Bot"&&t.push("bot-overview"))})}),s.querySelector("#btn-view-all-handovers")?.addEventListener("click",()=>t.push("bot-conversations")),s.querySelectorAll('[data-action="open-chat"]').forEach(e=>{e.addEventListener("click",()=>t.push("bot-conversations"))}),s.querySelectorAll('[data-action^="today-"]').forEach(e=>{e.addEventListener("click",()=>{const d=e.dataset.action.replace("today-","");d==="renewals"||d==="expiring_today"?t.switchTab("renewals"):d==="payments"||d==="pending_payments"?t.switchTab("payments"):d==="inbox"||d==="new_leads"?t.push("inbox"):t.switchTab("renewals")})}),s.querySelector("#risk-banner")?.addEventListener("click",()=>t.switchTab("renewals")),s.querySelector('[data-action="members-active"]')?.addEventListener("click",()=>t.switchTab("members")),s.querySelector('[data-action="renewals"]')?.addEventListener("click",()=>t.switchTab("renewals")),s.querySelector('[data-action="members-expired"]')?.addEventListener("click",()=>t.switchTab("members")),s.querySelector('[data-action="payments-pending"]')?.addEventListener("click",()=>t.switchTab("payments")),s.querySelector("#btn-view-access-feed")?.addEventListener("click",()=>t.switchTab("access")),s.querySelector("#access-tile-inside")?.addEventListener("click",()=>t.switchTab("access")),s.querySelector("#access-tile-entries")?.addEventListener("click",()=>t.switchTab("access")),s.querySelector("#access-tile-exits")?.addEventListener("click",()=>t.switchTab("access")),s.querySelector("#access-tile-denied")?.addEventListener("click",()=>t.switchTab("access")),s.querySelector("#btn-view-all-leads")?.addEventListener("click",()=>t.push("bot-leads")),s.querySelector("#lead-stat-total")?.addEventListener("click",()=>t.push("bot-leads")),s.querySelector("#lead-stat-new")?.addEventListener("click",()=>t.push("bot-leads")),s.querySelector("#lead-stat-trials")?.addEventListener("click",()=>t.push("bot-leads")),s.querySelector("#lead-stat-handovers")?.addEventListener("click",()=>t.push("bot-conversations")),s.querySelector("#btn-open-ai-chats")?.addEventListener("click",()=>t.push("bot-conversations")),s.querySelector("#btn-open-broadcast")?.addEventListener("click",()=>t.push("whatsapp")),s.querySelector("#btn-view-all-attention")?.addEventListener("click",()=>t.switchTab("renewals")),s.querySelector("#attention-tile-expiring")?.addEventListener("click",()=>t.switchTab("renewals")),s.querySelector("#attention-tile-pending")?.addEventListener("click",()=>t.switchTab("payments")),s.querySelector("#attention-tile-expired")?.addEventListener("click",()=>t.switchTab("renewals")),s.querySelector("#btn-view-all-renewals")?.addEventListener("click",()=>t.switchTab("renewals")),s.querySelectorAll(".upcoming-row-main").forEach(e=>{e.addEventListener("click",()=>{const d=e.dataset.memberId;d&&t.push("member-detail",{member:JSON.stringify({id:d})})})}),s.querySelectorAll("[data-renew-member]").forEach(e=>{e.addEventListener("click",d=>{d.stopPropagation(),t.push("renew-member",{member:e.dataset.renewMember})})}),s.querySelector("#btn-view-all-payments")?.addEventListener("click",()=>t.switchTab("payments")),s.querySelectorAll(".dash-payment-row").forEach(e=>{e.addEventListener("click",()=>{const d=e.dataset.paymentId;d&&t.push("payment-detail",{paymentId:d})})}),s.querySelector("#qa-add-member")?.addEventListener("click",()=>t.push("add-member")),s.querySelector("#qa-renew")?.addEventListener("click",()=>t.switchTab("renewals")),s.querySelector("#qa-payment")?.addEventListener("click",()=>t.push("record-payment")),s.querySelector("#qa-whatsapp")?.addEventListener("click",()=>t.push("whatsapp"))}export{C as default};
