const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/index-BQ5hDMiM.js","assets/index-CGglu2qX.css"])))=>i.map(i=>d[i]);
import{e as d,a as x,D as u,E as C,f as b,F as f,G as a,i as B,b as N,n as m,q as y,w as h,_ as $,s as A,d as _,k as w}from"./index-BQ5hDMiM.js";const R={async mount(e){const r=w(),g=await d("/api/mobile/v1/settings"),k=g.ok?g.data.gym?.show_biometric_link_banner!==!1:!0;e.innerHTML=`
      ${x({title:"More",showBack:u.depth>0})}
      <div class="scroll-view"><div class="scroll-content">
        <!-- Profile Card -->
        <div class="card" style="margin:var(--sp-lg)">
          <div class="card-body" style="display:flex;align-items:center;gap:var(--sp-lg)">
            ${C(r?.userName||"User","lg")}
            <div style="flex:1;min-width:0">
              <div id="settings-user-name" style="font-size:var(--fs-xl);font-weight:var(--fw-bold)">${b(r?.userName||"")}</div>
              <div id="settings-tenant-name" style="font-size:var(--fs-sm);color:var(--text-secondary)">${b(r?.tenantName||"")}</div>
              <div id="settings-role-badge" style="margin-top:var(--sp-xs)">${f(r?.userRole||"owner")}</div>
            </div>
          </div>
        </div>

        <!-- Gym Management -->
        <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-xs);font-weight:var(--fw-semibold);color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Gym Management</div>
        <div class="card" style="margin:var(--sp-sm) var(--sp-lg) var(--sp-lg)">
          ${a({iconName:"business",label:"Gym Profile",desc:"Name, contact, address",iconBg:"var(--brand-subtle)",iconColor:"var(--brand)",onClick:"gym-profile"})}
          ${a({iconName:"plan",label:"Membership Plans",desc:"Manage pricing & durations",iconBg:"var(--brand-subtle)",iconColor:"var(--brand)",onClick:"plans"})}
          ${a({iconName:"calendar",label:"Date Repair",desc:"Fix member dates that don't match payments",iconBg:"var(--warning-surface)",iconColor:"var(--warning)",onClick:"date-repair"})}
          ${a({iconName:"staff",label:"Staff",desc:"Manage team members",iconBg:"var(--info-surface)",iconColor:"var(--info)",onClick:"staff"})}
          ${a({iconName:"report",label:"Reports",desc:"Analytics & summaries",iconBg:"var(--success-surface)",iconColor:"var(--success)",onClick:"reports"})}
          ${a({iconName:"wallet",label:"Payment Setup",desc:"UPI & QR settings",iconBg:"var(--status-pending-surface)",iconColor:"var(--status-pending)",onClick:"payment-setup"})}
          ${a({iconName:"access",label:"Access Control",desc:"Biometric & attendance",iconBg:"#fce7f3",iconColor:"#db2777",onClick:"access"})}
        </div>

        ${r?.userRole==="gym_owner"?`
        <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-xs);font-weight:var(--fw-semibold);color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Dashboard Preferences</div>
        <div class="card" style="margin:var(--sp-sm) var(--sp-lg) var(--sp-lg)">
          <label for="show-biometric-link-banner" style="display:flex;align-items:center;gap:var(--sp-md);padding:var(--sp-lg);cursor:pointer">
            <span style="flex:1;min-width:0"><b style="display:block;color:var(--text);font-size:var(--fs-md)">Biometric ID linking reminder</b><small style="display:block;color:var(--text-secondary);margin-top:4px;line-height:1.45">Show a reminder when terminal IDs need a member match.</small></span>
            <input id="show-biometric-link-banner" type="checkbox" ${k?"checked":""} style="width:22px;height:22px;accent-color:var(--brand);flex:0 0 auto">
          </label>
          <p id="biometric-link-banner-status" role="status" style="margin:0;padding:0 var(--sp-lg) var(--sp-md);font-size:var(--fs-xs);color:var(--muted)"></p>
        </div>`:""}

        <!-- Communication -->
        <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-xs);font-weight:var(--fw-semibold);color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Communication</div>
        <div class="card" style="margin:var(--sp-sm) var(--sp-lg) var(--sp-lg)">
          ${a({iconName:"whatsapp",label:"WhatsApp",desc:"Reminders & broadcasts",iconBg:"#dcfce7",iconColor:"var(--whatsapp)",onClick:"whatsapp"})}
          ${a({iconName:"robot",label:"AI Receptionist",desc:"WhatsApp bot settings",iconBg:"#ede9fe",iconColor:"#7c3aed",onClick:"bot-overview"})}
          ${a({iconName:"megaphone",label:"Campaigns",desc:"Bulk messaging",iconBg:"var(--warning-surface)",iconColor:"var(--warning)",onClick:"campaigns"})}
          ${a({iconName:"inbox",label:"Inbox",desc:"Messages & conversations",iconBg:"var(--info-surface)",iconColor:"var(--info)",onClick:"inbox"})}
          ${a({iconName:"notifications",label:"Notifications",desc:"Activity feed",iconBg:"var(--critical-surface)",iconColor:"var(--critical)",onClick:"notifications"})}
        </div>

        <!-- Account -->
        <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-xs);font-weight:var(--fw-semibold);color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Account</div>
        <div class="card" style="margin:var(--sp-sm) var(--sp-lg) var(--sp-lg)">
          ${a({iconName:"subscription",label:"Subscription",desc:"Billing & plan",iconBg:"var(--brand-subtle)",iconColor:"var(--brand)",onClick:"subscription"})}
        </div>

        <!-- Actions -->
        <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;flex-direction:column;gap:var(--sp-sm)">
          <button class="btn btn-secondary btn-full" id="btn-logout">${B("logout",18)} Sign Out</button>
          <button class="btn btn-danger btn-full btn-sm" id="btn-delete" style="margin-top:var(--sp-md)">Delete Account & Data</button>
        </div>
      </div></div>`,N(e,{onBack:()=>u.depth>1?m.pop():m.switchTab("home")}),e.querySelectorAll("[data-action]").forEach(s=>{s.addEventListener("click",()=>{m.push(s.dataset.action)})});const n=e.querySelector("#show-biometric-link-banner");n?.addEventListener("change",async()=>{const s=!n.checked;n.disabled=!0;const i=await d("/api/mobile/v1/settings",{method:"PATCH",body:{show_biometric_link_banner:n.checked}});n.disabled=!1;const t=e.querySelector("#biometric-link-banner-status");i.ok?t.textContent=n.checked?"Reminder is on.":"Reminder is off on this gym’s dashboards.":(n.checked=s,t.textContent=i.error?.message||"Could not save this preference.")}),e.querySelector("#btn-logout").addEventListener("click",async()=>{await y({title:"Sign Out",message:"Are you sure you want to sign out?",confirmText:"Sign Out"})&&h()}),e.querySelector("#btn-delete").addEventListener("click",async()=>{if(!await y({title:"Delete Account",message:"This will permanently delete your account and all gym data. This cannot be undone.",confirmText:"Delete Permanently",destructive:!0}))return;const{deleteAccount:i}=await $(async()=>{const{deleteAccount:o}=await import("./index-BQ5hDMiM.js").then(c=>c.X);return{deleteAccount:o}},__vite__mapDeps([0,1])),t=await i();t.ok?h():A(t.error?.message||"Could not delete the account. You are still signed in.","error")}),_(e,async()=>{const s=await d("/api/mobile/v1/settings");if(!s.ok||e.dataset.screenDisposed==="true")return;const i=s.data.gym?.name||s.data.settings?.name||s.data.name;if(i){const p=e.querySelector("#settings-tenant-name");p&&(p.textContent=i)}const t=w(),o=e.querySelector("#settings-user-name");t?.userName&&o&&(o.textContent=t.userName);const c=e.querySelector("#settings-role-badge");t?.userRole&&c&&(c.innerHTML=f(t.userRole));const l=e.querySelector("#show-biometric-link-banner"),v=s.data.gym?.show_biometric_link_banner;l&&typeof v=="boolean"&&!l.disabled&&(l.checked=v)},3e4)}};export{R as default};
