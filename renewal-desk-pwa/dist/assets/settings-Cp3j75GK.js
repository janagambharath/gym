const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/index-EEeWOYOa.js","assets/index-DrF9pPlY.css"])))=>i.map(i=>d[i]);
import{f as l,a as b,A as d,B as f,g as v,C as y,D as e,i as h,b as w,n as o,E as p,t as m,_ as x,o as k}from"./index-EEeWOYOa.js";const B={async mount(a){const t=k(),c=await l("/api/mobile/v1/settings"),g=c.ok?c.data.gym?.show_biometric_link_banner!==!1:!0;a.innerHTML=`
      ${b({title:"More",showBack:d.depth>0})}
      <div class="scroll-view"><div class="scroll-content">
        <!-- Profile Card -->
        <div class="card" style="margin:var(--sp-lg)">
          <div class="card-body" style="display:flex;align-items:center;gap:var(--sp-lg)">
            ${f(t?.userName||"User","lg")}
            <div style="flex:1;min-width:0">
              <div style="font-size:var(--fs-xl);font-weight:var(--fw-bold)">${v(t?.userName||"")}</div>
              <div style="font-size:var(--fs-sm);color:var(--text-secondary)">${v(t?.tenantName||"")}</div>
              <div style="margin-top:var(--sp-xs)">${y(t?.userRole||"owner")}</div>
            </div>
          </div>
        </div>

        <!-- Gym Management -->
        <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-xs);font-weight:var(--fw-semibold);color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Gym Management</div>
        <div class="card" style="margin:var(--sp-sm) var(--sp-lg) var(--sp-lg)">
          ${e({iconName:"business",label:"Gym Profile",desc:"Name, contact, address",iconBg:"var(--brand-subtle)",iconColor:"var(--brand)",onClick:"gym-profile"})}
          ${e({iconName:"plan",label:"Membership Plans",desc:"Manage pricing & durations",iconBg:"var(--brand-subtle)",iconColor:"var(--brand)",onClick:"plans"})}
          ${e({iconName:"calendar",label:"Date Repair",desc:"Fix member dates that don't match payments",iconBg:"var(--warning-surface)",iconColor:"var(--warning)",onClick:"date-repair"})}
          ${e({iconName:"staff",label:"Staff",desc:"Manage team members",iconBg:"var(--info-surface)",iconColor:"var(--info)",onClick:"staff"})}
          ${e({iconName:"report",label:"Reports",desc:"Analytics & summaries",iconBg:"var(--success-surface)",iconColor:"var(--success)",onClick:"reports"})}
          ${e({iconName:"wallet",label:"Payment Setup",desc:"UPI & QR settings",iconBg:"var(--status-pending-surface)",iconColor:"var(--status-pending)",onClick:"payment-setup"})}
          ${e({iconName:"access",label:"Access Control",desc:"Biometric & attendance",iconBg:"#fce7f3",iconColor:"#db2777",onClick:"access"})}
        </div>

        ${t?.userRole==="gym_owner"?`
        <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-xs);font-weight:var(--fw-semibold);color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Dashboard Preferences</div>
        <div class="card" style="margin:var(--sp-sm) var(--sp-lg) var(--sp-lg)">
          <label for="show-biometric-link-banner" style="display:flex;align-items:center;gap:var(--sp-md);padding:var(--sp-lg);cursor:pointer">
            <span style="flex:1;min-width:0"><b style="display:block;color:var(--text);font-size:var(--fs-md)">Biometric ID linking reminder</b><small style="display:block;color:var(--text-secondary);margin-top:4px;line-height:1.45">Show a reminder when terminal IDs need a member match.</small></span>
            <input id="show-biometric-link-banner" type="checkbox" ${g?"checked":""} style="width:22px;height:22px;accent-color:var(--brand);flex:0 0 auto">
          </label>
          <p id="biometric-link-banner-status" role="status" style="margin:0;padding:0 var(--sp-lg) var(--sp-md);font-size:var(--fs-xs);color:var(--muted)"></p>
        </div>`:""}

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
          <button class="btn btn-secondary btn-full" id="btn-logout">${h("logout",18)} Sign Out</button>
          <button class="btn btn-danger btn-full btn-sm" id="btn-delete" style="margin-top:var(--sp-md)">Delete Account & Data</button>
        </div>
      </div></div>`,w(a,{onBack:()=>d.depth>1?o.pop():o.switchTab("home")}),a.querySelectorAll("[data-action]").forEach(n=>{n.addEventListener("click",()=>{o.push(n.dataset.action)})});const s=a.querySelector("#show-biometric-link-banner");s?.addEventListener("change",async()=>{const n=!s.checked;s.disabled=!0;const i=await l("/api/mobile/v1/settings",{method:"PATCH",body:{show_biometric_link_banner:s.checked}});s.disabled=!1;const r=a.querySelector("#biometric-link-banner-status");i.ok?r.textContent=s.checked?"Reminder is on.":"Reminder is off on this gym’s dashboards.":(s.checked=n,r.textContent=i.error?.message||"Could not save this preference.")}),a.querySelector("#btn-logout").addEventListener("click",async()=>{await p({title:"Sign Out",message:"Are you sure you want to sign out?",confirmText:"Sign Out"})&&m()}),a.querySelector("#btn-delete").addEventListener("click",async()=>{if(!await p({title:"Delete Account",message:"This will permanently delete your account and all gym data. This cannot be undone.",confirmText:"Delete Permanently",destructive:!0}))return;const{deleteAccount:i}=await x(async()=>{const{deleteAccount:r}=await import("./index-EEeWOYOa.js").then(u=>u.T);return{deleteAccount:r}},__vite__mapDeps([0,1]));await i(),m()})}};export{B as default};
