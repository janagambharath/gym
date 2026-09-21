const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/index-BPPTfp3n.js","assets/index-CfUOYWf7.css"])))=>i.map(i=>d[i]);
import{a as v,f as p,e as i,C as g,D as e,i as m,b as u,n,E as o,p as r,_ as f,j as b,F as y}from"./index-BPPTfp3n.js";const w={async mount(a){const s=b();a.innerHTML=`
      ${v({title:"Settings",showBack:!0})}
      <div class="scroll-view"><div class="scroll-content">
        <!-- Profile Card -->
        <div class="card" style="margin:var(--sp-lg)">
          <div class="card-body" style="display:flex;align-items:center;gap:var(--sp-lg)">
            ${p(s?.userName||"User","lg")}
            <div style="flex:1;min-width:0">
              <div style="font-size:var(--fs-xl);font-weight:var(--fw-bold)">${i(s?.userName||"")}</div>
              <div style="font-size:var(--fs-sm);color:var(--text-secondary)">${i(s?.tenantName||"")}</div>
              <div style="margin-top:var(--sp-xs)">${g(s?.userRole||"owner")}</div>
            </div>
          </div>
        </div>

        <!-- Gym Management -->
        <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-xs);font-weight:var(--fw-semibold);color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Gym Management</div>
        <div class="card" style="margin:var(--sp-sm) var(--sp-lg) var(--sp-lg)">
          ${e({iconName:"plan",label:"Membership Plans",desc:"Manage pricing & durations",iconBg:"var(--brand-subtle)",iconColor:"var(--brand)",onClick:"plans"})}
          ${e({iconName:"staff",label:"Staff",desc:"Manage team members",iconBg:"var(--info-surface)",iconColor:"var(--info)",onClick:"staff"})}
          ${e({iconName:"report",label:"Reports",desc:"Analytics & summaries",iconBg:"var(--success-surface)",iconColor:"var(--success)",onClick:"reports"})}
          ${e({iconName:"wallet",label:"Payment Setup",desc:"UPI & QR settings",iconBg:"var(--status-pending-surface)",iconColor:"var(--status-pending)",onClick:"payment-setup"})}
          ${e({iconName:"access",label:"Access Control",desc:"Biometric & attendance",iconBg:"#fce7f3",iconColor:"#db2777",onClick:"access"})}
        </div>

        <!-- Communication -->
        <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-xs);font-weight:var(--fw-semibold);color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Communication</div>
        <div class="card" style="margin:var(--sp-sm) var(--sp-lg) var(--sp-lg)">
          ${e({iconName:"whatsapp",label:"WhatsApp",desc:"Reminders & broadcasts",iconBg:"#dcfce7",iconColor:"var(--whatsapp)",onClick:"whatsapp"})}
          ${e({iconName:"robot",label:"AI Receptionist",desc:"WhatsApp bot settings",iconBg:"#ede9fe",iconColor:"#7c3aed",onClick:"bot-overview"})}
          ${e({iconName:"megaphone",label:"Campaigns",desc:"Bulk messaging",iconBg:"var(--warning-surface)",iconColor:"var(--warning)",onClick:"campaigns"})}
          ${e({iconName:"inbox",label:"Inbox",desc:"Messages & conversations",iconBg:"var(--info-surface)",iconColor:"var(--info)",onClick:"inbox"})}
          ${e({iconName:"notifications",label:"Notifications",desc:"Activity feed",iconBg:"var(--critical-surface)",iconColor:"var(--critical)",onClick:"notifications"})}
        </div>

        <!-- Account -->
        <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-xs);font-weight:var(--fw-semibold);color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Account</div>
        <div class="card" style="margin:var(--sp-sm) var(--sp-lg) var(--sp-lg)">
          ${e({iconName:"subscription",label:"Subscription",desc:"Billing & plan",iconBg:"var(--brand-subtle)",iconColor:"var(--brand)",onClick:"subscription"})}
        </div>

        <!-- Actions -->
        <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;flex-direction:column;gap:var(--sp-sm)">
          <button class="btn btn-secondary btn-full" id="btn-logout">${m("logout",18)} Sign Out</button>
          <button class="btn btn-danger btn-full btn-sm" id="btn-delete" style="margin-top:var(--sp-md)">Delete Account & Data</button>
        </div>
      </div></div>`,u(a,{onBack:()=>y.depth>1?n.pop():n.switchTab("dashboard")}),a.querySelectorAll("[data-action]").forEach(t=>{t.addEventListener("click",()=>n.push(t.dataset.action))}),a.querySelector("#btn-logout").addEventListener("click",async()=>{await o({title:"Sign Out",message:"Are you sure you want to sign out?",confirmText:"Sign Out"})&&r()}),a.querySelector("#btn-delete").addEventListener("click",async()=>{if(!await o({title:"Delete Account",message:"This will permanently delete your account and all gym data. This cannot be undone.",confirmText:"Delete Permanently",destructive:!0}))return;const{deleteAccount:c}=await f(async()=>{const{deleteAccount:l}=await import("./index-BPPTfp3n.js").then(d=>d.P);return{deleteAccount:l}},__vite__mapDeps([0,1]));await c(),r()})}};export{w as default};
