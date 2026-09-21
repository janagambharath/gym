import{a as S,i as a,f as P,e as x,F as t,G as r,x as k,b as z,n as d,E as $,p as A,H as B,s as N,k as q,j as T}from"./index-BcPSQxV-.js";const R={async mount(e){const c=T(),m=c?.tenantName||"My Gym",C=c?.userName||"Owner",v=c?.userRole==="gym_owner";e.innerHTML=`
      ${S({title:"More",showBack:!1})}
      <div class="scroll-view" id="settings-scroll">
        <div class="scroll-content" id="settings-content">
          <!-- 1. Gym Profile & Information -->
          <div class="card" style="margin:0 var(--sp-lg) var(--sp-lg)">
            <div class="card-body">
              <div style="display:flex;align-items:center;gap:var(--sp-md);margin-bottom:var(--sp-md)">
                <div style="width:36px;height:36px;border-radius:var(--r-md);background:var(--brand-subtle);display:flex;align-items:center;justify-content:center">
                  ${a("business",18,"var(--brand)")}
                </div>
                <div style="font-weight:var(--fw-bold);font-size:var(--fs-base)">Gym Profile</div>
              </div>
              <div style="display:flex;align-items:center;gap:var(--sp-md);padding-bottom:var(--sp-md);border-bottom:1px solid var(--border-light)">
                ${P(m,"lg")}
                <div style="flex:1;min-width:0">
                  <div style="font-size:var(--fs-lg);font-weight:var(--fw-bold);color:var(--text)" id="gym-display-name">${x(m)}</div>
                  <div style="font-size:var(--fs-sm);color:var(--text-secondary)">
                    ${x(C)} • ${v?"Gym Owner":"Staff"}
                  </div>
                </div>
              </div>
              <div id="gym-info-rows" style="margin-top:var(--sp-sm)">
                ${t("Email","—")}
                ${t("Phone","—")}
                ${t("Address","—")}
                ${t("Timezone","Asia/Kolkata")}
              </div>
            </div>
          </div>

          <!-- 2. Memberships & Plans -->
          <div class="card" style="margin:0 var(--sp-lg) var(--sp-lg)">
            <div class="card-body">
              <div style="display:flex;align-items:center;gap:var(--sp-md);margin-bottom:var(--sp-sm)">
                <div style="width:36px;height:36px;border-radius:var(--r-md);background:var(--brand-subtle);display:flex;align-items:center;justify-content:center">
                  ${a("plan",18,"var(--brand)")}
                </div>
                <div style="font-weight:var(--fw-bold);font-size:var(--fs-base)">Memberships & Plans</div>
              </div>
              <div class="menu-list">
                ${r({iconName:"plan",label:"Membership Plans",desc:"Manage pricing & durations",iconBg:"var(--brand-subtle)",iconColor:"var(--brand)",onClick:"plans"})}
                ${r({iconName:"target",label:"Promotional Campaigns",desc:"Renewal & recovery broadcasts",iconBg:"var(--warning-surface)",iconColor:"var(--warning)",onClick:"campaigns"})}
              </div>
            </div>
          </div>

          <!-- 3. Payments & Invoicing -->
          <div class="card" style="margin:0 var(--sp-lg) var(--sp-lg)">
            <div class="card-body">
              <div style="display:flex;align-items:center;gap:var(--sp-md);margin-bottom:var(--sp-sm)">
                <div style="width:36px;height:36px;border-radius:var(--r-md);background:var(--brand-subtle);display:flex;align-items:center;justify-content:center">
                  ${a("cash",18,"var(--brand)")}
                </div>
                <div style="font-weight:var(--fw-bold);font-size:var(--fs-base)">Payments & Invoicing</div>
              </div>
              ${v?`
                <div class="payment-setup-row" id="row-payment-setup" style="cursor:pointer;padding:var(--sp-md);background:var(--gray-50);border-radius:var(--r-lg);border:1px solid var(--border-light);margin-bottom:var(--sp-sm);display:flex;align-items:center;gap:var(--sp-sm)">
                  <div style="flex:1;min-width:0">
                    <div style="font-weight:var(--fw-semibold);font-size:var(--fs-base);color:var(--text)" id="upi-display-text">No UPI Configured</div>
                    <div style="font-size:var(--fs-xs);color:var(--text-secondary);margin-top:2px" id="upi-subtext">Tap to configure gym UPI ID & bank account</div>
                  </div>
                  <span class="badge badge-pending" id="upi-status-badge">Setup Needed</span>
                  ${a("forward",14,"var(--muted)")}
                </div>
              `:""}
              <div class="menu-list">
                ${r({iconName:"cash",label:"Payment Transactions & Ledger",desc:"All verified, pending, and counter payments",iconBg:"var(--status-paid-surface)",iconColor:"var(--status-paid)",onClick:"payments"})}
              </div>
            </div>
          </div>

          <!-- 4. WhatsApp & Automation -->
          <div class="card" style="margin:0 var(--sp-lg) var(--sp-lg)">
            <div class="card-body">
              <div style="display:flex;align-items:center;gap:var(--sp-md);margin-bottom:var(--sp-sm)">
                <div style="width:36px;height:36px;border-radius:var(--r-md);background:#dcfce7;display:flex;align-items:center;justify-content:center">
                  ${a("whatsapp",18,"var(--whatsapp)")}
                </div>
                <div style="font-weight:var(--fw-bold);font-size:var(--fs-base)">WhatsApp & Automation</div>
              </div>
              <div class="whatsapp-status-row" id="row-whatsapp" style="cursor:pointer;display:flex;align-items:center;gap:var(--sp-sm);padding:var(--sp-md);background:var(--gray-50);border-radius:var(--r-lg);border:1px solid var(--border-light);margin-bottom:var(--sp-sm)">
                <span class="device-dot" id="wa-status-dot" style="background:var(--gray-300)"></span>
                <span style="font-weight:var(--fw-medium);font-size:var(--fs-sm);color:var(--text)" id="wa-status-text">Setup WhatsApp Reminders</span>
                <div style="flex:1"></div>
                ${a("forward",14,"var(--muted)")}
              </div>
              <div class="menu-list">
                ${r({iconName:"robot",label:"AI Receptionist (Bot)",desc:"Configure automatic inquiry replies & FAQs",iconBg:"#ede9fe",iconColor:"#7c3aed",onClick:"bot-overview"})}
                ${r({iconName:"testTube",label:"Test AI Receptionist",desc:"Simulate member inquiries in sandbox",iconBg:"var(--info-surface)",iconColor:"var(--info)",onClick:"bot-test"})}
              </div>
            </div>
          </div>

          <!-- 5. Staff & Access Control -->
          <div class="card" style="margin:0 var(--sp-lg) var(--sp-lg)">
            <div class="card-body">
              <div style="display:flex;align-items:center;gap:var(--sp-md);margin-bottom:var(--sp-sm)">
                <div style="width:36px;height:36px;border-radius:var(--r-md);background:var(--brand-subtle);display:flex;align-items:center;justify-content:center">
                  ${a("staff",18,"var(--brand)")}
                </div>
                <div style="font-weight:var(--fw-bold);font-size:var(--fs-base)">Staff & Access Control</div>
              </div>
              <div class="menu-list">
                ${v?r({iconName:"staff",label:"Staff Management & Permissions",desc:"Add staff, managers, and desk team",iconBg:"var(--brand-subtle)",iconColor:"var(--brand)",onClick:"staff"}):""}
                ${r({iconName:"access",label:"Biometric Devices & Access Logs",desc:"X990 device status and member entry feed",iconBg:"#fce7f3",iconColor:"#db2777",onClick:"access"})}
              </div>
            </div>
          </div>

          <!-- 6. Analytics & Reports -->
          <div class="card" style="margin:0 var(--sp-lg) var(--sp-lg)">
            <div class="card-body">
              <div style="display:flex;align-items:center;gap:var(--sp-md);margin-bottom:var(--sp-sm)">
                <div style="width:36px;height:36px;border-radius:var(--r-md);background:var(--brand-subtle);display:flex;align-items:center;justify-content:center">
                  ${a("report",18,"var(--brand)")}
                </div>
                <div style="font-weight:var(--fw-bold);font-size:var(--fs-base)">Analytics & Reports</div>
              </div>
              <div class="menu-list">
                ${r({iconName:"report",label:"Operational Analytics & Performance",desc:"KPI summaries for 7d, 30d, and custom periods",iconBg:"var(--success-surface)",iconColor:"var(--success)",onClick:"reports"})}
              </div>
            </div>
          </div>

          <!-- 7. Renewal Desk Subscription -->
          <div class="card" id="card-subscription" style="margin:0 var(--sp-lg) var(--sp-lg);cursor:pointer">
            <div class="card-body">
              <div style="display:flex;align-items:center;gap:var(--sp-md);margin-bottom:var(--sp-sm)">
                <div style="width:36px;height:36px;border-radius:var(--r-md);background:var(--brand-subtle);display:flex;align-items:center;justify-content:center">
                  ${a("shield",18,"var(--brand)")}
                </div>
                <div style="font-weight:var(--fw-bold);font-size:var(--fs-base)">Renewal Desk Subscription</div>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--sp-sm) 0;border-bottom:1px solid var(--border-light)">
                <span style="font-size:var(--fs-sm);color:var(--text-secondary)">Status</span>
                <span id="sub-status-badge">${k("Active")}</span>
              </div>
              <div id="sub-limit-row" style="display:flex;justify-content:space-between;align-items:center;padding:var(--sp-sm) 0;border-bottom:1px solid var(--border-light)">
                <span style="font-size:var(--fs-sm);color:var(--text-secondary)">Member Limit</span>
                <span style="font-size:var(--fs-sm);font-weight:var(--fw-semibold)" id="sub-limit-val">Unlimited</span>
              </div>
              <div class="menu-list" style="margin-top:var(--sp-xs)">
                ${r({iconName:"wallet",label:"Manage Subscription & Billing",desc:"View invoices, plans, and account tier",iconBg:"var(--brand-subtle)",iconColor:"var(--brand)",onClick:"subscription"})}
              </div>
            </div>
          </div>

          <!-- 8. About Renewal Desk -->
          <div class="card" style="margin:0 var(--sp-lg) var(--sp-lg)">
            <div class="card-body">
              <div style="display:flex;align-items:center;gap:var(--sp-md);margin-bottom:var(--sp-md)">
                <img src="/icons/logo.png" alt="Renewal Desk" style="width:40px;height:40px;border-radius:var(--r-md);object-fit:contain">
                <div>
                  <div style="font-weight:var(--fw-bold);font-size:var(--fs-base);color:var(--text)">Renewal Desk</div>
                  <div style="font-size:var(--fs-xs);color:var(--text-secondary)">Gym Management & AI Receptionist</div>
                </div>
              </div>
              ${t("Version","1.0.0")}
              ${t("Build","Production Release (Build 5)")}
              <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--sp-md) 0 0;border-top:1px solid var(--border-light);cursor:pointer" id="btn-privacy">
                <div style="display:flex;align-items:center;gap:var(--sp-xs)">
                  ${a("business",16,"var(--brand)")}
                  <span style="font-size:var(--fs-sm);color:var(--brand);font-weight:var(--fw-semibold)">Privacy Policy</span>
                </div>
                ${a("forward",14,"var(--muted)")}
              </div>
            </div>
          </div>

          <!-- 9. Account Management & Danger Zone -->
          <div class="card" style="margin:0 var(--sp-lg) var(--sp-lg);border-color:var(--critical-border);background:var(--critical-surface)">
            <div class="card-body">
              <div style="display:flex;align-items:center;gap:var(--sp-xs);margin-bottom:var(--sp-xs);color:var(--critical)">
                ${a("shield",18,"var(--critical)")}
                <div style="font-weight:var(--fw-bold);font-size:var(--fs-base)">Account Management</div>
              </div>
              <div style="font-size:var(--fs-xs);color:var(--critical);line-height:1.4;margin-bottom:var(--sp-md)">
                Permanently delete your account, gym records, member database, and message logs.
              </div>
              <button class="btn btn-danger btn-full btn-sm" id="btn-delete" style="background:var(--critical);color:white">
                ${a("delete",16,"white")}
                <span>Delete Account & Data</span>
              </button>
            </div>
          </div>

          <!-- 10. Logout Button -->
          <div style="padding:0 var(--sp-lg) var(--sp-xl)">
            <button class="btn btn-secondary btn-full" id="btn-logout" style="min-height:48px;font-size:var(--fs-base);font-weight:var(--fw-bold)">
              ${a("logout",18)}
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>`,z(e,{onBack:()=>d.switchTab("dashboard")}),e.querySelectorAll("[data-action]").forEach(n=>{n.addEventListener("click",()=>{const i=n.dataset.action;i==="payments"?d.switchTab("payments"):i==="access"?d.switchTab("access"):d.push(i)})}),e.querySelector("#row-payment-setup")?.addEventListener("click",()=>d.push("payment-setup")),e.querySelector("#row-whatsapp")?.addEventListener("click",()=>d.push("whatsapp")),e.querySelector("#card-subscription")?.addEventListener("click",()=>d.push("subscription")),e.querySelector("#btn-privacy")?.addEventListener("click",()=>{window.open("https://gym-production-910c.up.railway.app/privacy","_blank")}),e.querySelector("#btn-logout")?.addEventListener("click",async()=>{await $({title:"Sign Out",message:"Are you sure you want to sign out?",confirmText:"Sign Out"})&&A()}),e.querySelector("#btn-delete")?.addEventListener("click",async()=>{if(!await $({title:"Delete Account & Data",message:"Are you sure you want to permanently delete your account and all associated gym records? This action cannot be undone.",confirmText:"Delete Permanently",destructive:!0}))return;const i=await B();i.ok?A():N(i.error?.message||"Could not delete account.","error")}),q("/api/mobile/v1/settings").then(n=>{if(!n.ok)return;const i=n.data,s=i.gym||{},o=i.payment_settings||{},g=e.querySelector("#gym-display-name");g&&s.name&&(g.textContent=s.name);const b=e.querySelector("#gym-info-rows");b&&(b.innerHTML=`
          ${t("Email",s.email||"—")}
          ${t("Phone",s.phone||"—")}
          ${t("Address",s.address||"—")}
          ${t("Timezone",s.timezone||"Asia/Kolkata")}
        `);const p=e.querySelector("#upi-display-text"),u=e.querySelector("#upi-subtext"),l=e.querySelector("#upi-status-badge");p&&l&&(o.upi_id?(p.textContent=o.upi_id,u.textContent=o.is_active?"Active • VYNLA members pay directly via UPI":"Disabled • Online renewals paused",l.className=o.is_active?"badge badge-active":"badge badge-pending",l.textContent=o.is_active?"Active":"Disabled"):(p.textContent="No UPI Configured",u.textContent="Tap to configure gym UPI ID & bank account",l.className="badge badge-pending",l.textContent="Setup Needed"));const y=e.querySelector("#wa-status-dot"),f=e.querySelector("#wa-status-text");y&&f&&(y.style.background=s.whatsapp_enabled?"var(--whatsapp)":"var(--gray-300)",f.textContent=s.whatsapp_enabled?"Connected & Active":"Setup WhatsApp Reminders");const w=e.querySelector("#sub-status-badge");w&&(w.innerHTML=k(s.subscription_status==="active"?"Active":s.subscription_status||"Pending"));const h=e.querySelector("#sub-limit-val");h&&(h.textContent=s.max_members?String(s.max_members):"Unlimited")})}};export{R as default};
