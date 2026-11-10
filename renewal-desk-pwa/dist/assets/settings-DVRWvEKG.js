const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/index-ClFlXszA.js","assets/index-BAz4sCaR.css"])))=>i.map(i=>d[i]);
import{e as m,a as k,F as b,G as C,f as l,H as f,I as e,i as $,b as B,n as v,v as y,y as h,_ as N,s as A,d as _,q as w,J as S,K as R}from"./index-ClFlXszA.js";const E={async mount(a){const o=w(),g=await m("/api/mobile/v1/settings"),x=g.ok?g.data.gym?.show_biometric_link_banner!==!1:!0;a.innerHTML=`
      ${k({title:"More",showBack:b.depth>0})}
      <div class="scroll-view"><div class="scroll-content">
        <!-- Profile Card -->
        <div class="card" style="margin:var(--sp-lg)">
          <div class="card-body" style="display:flex;align-items:center;gap:var(--sp-lg)">
            ${C(o?.userName||"User","lg")}
            <div style="flex:1;min-width:0">
              <div id="settings-user-name" style="font-size:var(--fs-xl);font-weight:var(--fw-bold)">${l(o?.userName||"")}</div>
              <div id="settings-tenant-name" style="font-size:var(--fs-sm);color:var(--text-secondary)">${l(o?.tenantName||"")}</div>
              <div id="settings-role-badge" style="margin-top:var(--sp-xs)">${f(o?.userRole||"owner")}</div>
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
          ${o?.userRole!=="staff"?e({iconName:"report",label:"Audit Log",desc:"Who did what, when (owner only)",iconBg:"var(--gray-100)",iconColor:"var(--muted)",onClick:"audit-logs"}):""}
        </div>

        ${o?.userRole==="gym_owner"?`
        <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-xs);font-weight:var(--fw-semibold);color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Dashboard Preferences</div>
        <div class="card" style="margin:var(--sp-sm) var(--sp-lg) var(--sp-lg)">
          <label for="show-biometric-link-banner" style="display:flex;align-items:center;gap:var(--sp-md);padding:var(--sp-lg);cursor:pointer">
            <span style="flex:1;min-width:0"><b style="display:block;color:var(--text);font-size:var(--fs-md)">Biometric ID linking reminder</b><small style="display:block;color:var(--text-secondary);margin-top:4px;line-height:1.45">Show a reminder when terminal IDs need a member match.</small></span>
            <input id="show-biometric-link-banner" type="checkbox" ${x?"checked":""} style="width:22px;height:22px;accent-color:var(--brand);flex:0 0 auto">
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
          <button class="btn btn-secondary btn-full" id="btn-logout">${$("logout",18)} Sign Out</button>
          <button class="btn btn-danger btn-full btn-sm" id="btn-delete" style="margin-top:var(--sp-md)">Delete Account & Data</button>
        </div>

        <!-- V10-L19: build/version indicator — which bundle this phone is
             running, so a stale cached bundle can be diagnosed without
             devtools. -->
        <div id="app-version" style="text-align:center;padding:0 var(--sp-lg) var(--sp-xl);font-size:var(--fs-xs);color:var(--muted)">App version ${l(S)}${` · built ${l(R)}`}</div>
      </div></div>`,B(a,{onBack:()=>b.depth>1?v.pop():v.switchTab("home")}),a.querySelectorAll("[data-action]").forEach(s=>{s.addEventListener("click",()=>{v.push(s.dataset.action)})});const n=a.querySelector("#show-biometric-link-banner");n?.addEventListener("change",async()=>{const s=!n.checked;n.disabled=!0;const i=await m("/api/mobile/v1/settings",{method:"PATCH",body:{show_biometric_link_banner:n.checked}});n.disabled=!1;const t=a.querySelector("#biometric-link-banner-status");i.ok?t.textContent=n.checked?"Reminder is on.":"Reminder is off on this gym’s dashboards.":(n.checked=s,t.textContent=i.error?.message||"Could not save this preference.")}),a.querySelector("#btn-logout").addEventListener("click",async()=>{await y({title:"Sign Out",message:"Are you sure you want to sign out?",confirmText:"Sign Out"})&&h()}),a.querySelector("#btn-delete").addEventListener("click",async()=>{if(!await y({title:"Delete Account",message:"This will permanently delete your account and all gym data. This cannot be undone.",confirmText:"Delete Permanently",destructive:!0}))return;const{deleteAccount:i}=await N(async()=>{const{deleteAccount:r}=await import("./index-ClFlXszA.js").then(c=>c.a2);return{deleteAccount:r}},__vite__mapDeps([0,1])),t=await i();t.ok?h():A(t.error?.message||"Could not delete the account. You are still signed in.","error")}),_(a,async()=>{const s=await m("/api/mobile/v1/settings");if(!s.ok||a.dataset.screenDisposed==="true")return;const i=s.data.gym?.name||s.data.settings?.name||s.data.name;if(i){const u=a.querySelector("#settings-tenant-name");u&&(u.textContent=i)}const t=w(),r=a.querySelector("#settings-user-name");t?.userName&&r&&(r.textContent=t.userName);const c=a.querySelector("#settings-role-badge");t?.userRole&&c&&(c.innerHTML=f(t.userRole));const d=a.querySelector("#show-biometric-link-banner"),p=s.data.gym?.show_biometric_link_banner;d&&typeof p=="boolean"&&!d.disabled&&(d.checked=p)},3e4)}};export{E as default};
