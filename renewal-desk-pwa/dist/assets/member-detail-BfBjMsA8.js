import{o as y,k as n,G as g,H as f,a as h,f as w,e as d,C as $,I as t,J as o,i,b as x,n as r,s as l,E as _,K as S}from"./index-B7qIMgpI.js";const M={async mount(a,m){let e=m?.member?JSON.parse(m.member):null;if(!e){a.innerHTML=y("Member not found");return}const v=await n(`/api/mobile/v1/members/${e.id}`);v.ok&&(e=v.data);const c=g(e),b=S(c),p=f(e.days_until_expiry);a.innerHTML=`
      ${h({title:"Member",showBack:!0,actions:[{icon:"edit",label:"Edit"}]})}
      <div class="scroll-view">
        <div class="scroll-content">
          <!-- Profile Card -->
          <div style="padding:var(--sp-xxl);text-align:center;background:var(--card);border-bottom:1px solid var(--border-light)">
            <div style="display:inline-flex">${w(e.full_name,"xl")}</div>
            <h2 style="font-size:var(--fs-3xl);margin-top:var(--sp-md);margin-bottom:var(--sp-xs)">${d(e.full_name)}</h2>
            <div style="color:var(--text-secondary);font-size:var(--fs-base);margin-bottom:var(--sp-md)">${d(e.phone)}</div>
            ${$(c)}
            ${p?`<div style="margin-top:var(--sp-sm);font-size:var(--fs-sm);color:${b.text}">${d(p)}</div>`:""}
          </div>

          <!-- Membership Info -->
          <div style="padding:var(--sp-lg)">
            <div class="card card-body">
              <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Membership</div>
              ${t("Plan",e.plan?.name||"—")}
              ${t("Start",o(e.membership_start))}
              ${t("End",o(e.membership_end))}
              ${e.days_until_expiry!=null?`
                <div style="margin-top:var(--sp-md)">
                  <div class="progress-bar">
                    <div class="progress-bar-fill" style="width:${Math.max(0,Math.min(100,e.days_until_expiry/(e.plan?.duration_days||30)*100))}%;background:${b.text}"></div>
                  </div>
                </div>
              `:""}
            </div>
          </div>

          <!-- Contact Info -->
          <div style="padding:0 var(--sp-lg) var(--sp-lg)">
            <div class="card card-body">
              <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Contact</div>
              ${t("Phone",e.phone)}
              ${t("Email",e.email||"—")}
              ${t("Gender",e.gender||"—")}
              ${t("Joined",o(e.joined_on))}
              ${e.notes?t("Notes",e.notes):""}
            </div>
          </div>

          <!-- Activity -->
          <div style="padding:0 var(--sp-lg) var(--sp-lg)">
            <div class="card card-body">
              <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Activity</div>
              ${t("WhatsApp",e.whatsapp_opted_in?"Opted In":"Not opted in")}
              ${t("Biometric",e.has_biometric?"Enrolled":"Not enrolled")}
            </div>
          </div>

          <!-- Actions -->
          <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;flex-direction:column;gap:var(--sp-sm)">
            <button class="btn btn-primary btn-full" id="btn-renew">${i("renewals",18,"white")} Renew Membership</button>
            <button class="btn btn-outline btn-full" id="btn-record-payment">${i("wallet",18)} Record Payment</button>
            <button class="btn btn-whatsapp btn-full" id="btn-send-reminder">${i("whatsapp",18,"white")} Send WhatsApp Reminder</button>
            ${e.status!=="deleted"?`<button class="btn btn-danger btn-full btn-sm" id="btn-deactivate" style="margin-top:var(--sp-md)">${i("delete",16,"white")} Deactivate Member</button>`:""}
          </div>
        </div>
      </div>`,x(a,{onBack:()=>r.pop(),actions:[{onClick:()=>r.push("edit-member",{memberId:String(e.id)})}]}),a.querySelector("#btn-renew")?.addEventListener("click",()=>r.push("renew-member",{member:JSON.stringify(e)})),a.querySelector("#btn-record-payment")?.addEventListener("click",()=>r.push("record-payment",{memberId:String(e.id)})),a.querySelector("#btn-send-reminder")?.addEventListener("click",async()=>{const s=await n("/api/mobile/v1/whatsapp/send-reminder",{method:"POST",body:{member_id:e.id}});l(s.ok?"Reminder sent!":s.error.message,s.ok?"success":"error")}),a.querySelector("#btn-deactivate")?.addEventListener("click",async()=>{if(!await _({title:"Deactivate Member",message:`Are you sure you want to deactivate ${e.full_name}?`,confirmText:"Deactivate",destructive:!0}))return;const u=await n(`/api/mobile/v1/members/${e.id}/deactivate`,{method:"POST"});u.ok?(l("Member deactivated","success"),r.pop()):l(u.error.message,"error")})}};export{M as default};
