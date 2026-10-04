import{o as h,k as v,G as w,H as x,a as k,f as M,e as l,i as n,D as S,I as i,J as p,b as E,n as a,s as u,F as _,K as L}from"./index-DYUVXLb_.js";const A={async mount(t,s){let e=null;try{s?.member&&(e=typeof s.member=="string"?JSON.parse(s.member):s.member)}catch{e=null}const m=e?.id||s?.memberId;if(!m){t.innerHTML=h("Member not found");return}const c=()=>{const r=w(e),y=L(r),g=x(e.days_until_expiry);t.innerHTML=`
        ${k({title:"Member",showBack:!0,actions:[{icon:"edit",label:"Edit"}]})}
        <div class="scroll-view">
          <div class="scroll-content">
            <!-- Profile Card -->
            <div style="padding:var(--sp-xxl);text-align:center;background:var(--card);border-bottom:1px solid var(--border-light)">
              <div style="display:inline-flex">${M(e.full_name,"xl")}</div>
              <h2 style="font-size:var(--fs-3xl);margin-top:var(--sp-md);margin-bottom:var(--sp-xs)">${l(e.full_name)}</h2>
              <div style="color:var(--text-secondary);font-size:var(--fs-base);margin-bottom:var(--sp-xs)">${l(e.phone)}</div>
              ${e.address?`
                <div style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:var(--sp-sm);display:flex;align-items:center;justify-content:center;gap:6px">
                  ${n("location",16,"var(--brand)")} <span>${l(e.address)}</span>
                </div>
              `:`
                <div style="color:var(--muted);font-size:var(--fs-xs);margin-bottom:var(--sp-sm)">No address recorded</div>
              `}
              ${S(r)}
              ${g?`<div style="margin-top:var(--sp-sm);font-size:var(--fs-sm);color:${y.text}">${l(g)}</div>`:""}
              <div style="margin-top:var(--sp-md)">
                <button class="btn btn-outline btn-sm" id="btn-quick-edit" style="display:inline-flex;align-items:center;gap:6px">
                  ${n("edit",14)} Edit Member
                </button>
              </div>
            </div>

            <!-- Membership Info -->
            <div style="padding:var(--sp-lg)">
              <div class="card card-body">
                <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Membership</div>
                ${i("Plan",e.plan?.name||"—")}
                ${i("Start",p(e.membership_start))}
                ${i("End",p(e.membership_end))}
                ${e.days_until_expiry!=null?`
                  <div style="margin-top:var(--sp-md)">
                    <div class="progress-bar">
                      <div class="progress-bar-fill" style="width:${Math.max(0,Math.min(100,e.days_until_expiry/(e.plan?.duration_days||30)*100))}%;background:${y.text}"></div>
                    </div>
                  </div>
                `:""}
              </div>
            </div>

            <!-- Contact & Address Info -->
            <div style="padding:0 var(--sp-lg) var(--sp-lg)">
              <div class="card card-body">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-md)">
                  <div style="font-weight:var(--fw-bold)">Contact & Address</div>
                  <button class="btn btn-sm btn-link" id="btn-edit-contact" style="padding:0;font-size:var(--fs-xs);color:var(--brand);display:flex;align-items:center;gap:4px">
                    ${n("edit",14)} Edit
                  </button>
                </div>
                ${i("Phone",e.phone)}
                ${i("Email",e.email||"—")}
                ${i("Address",e.address||"—")}
                ${i("Gender",e.gender||"—")}
                ${i("Joined",p(e.joined_on))}
                ${e.notes?i("Notes",e.notes):""}
              </div>
            </div>

            <!-- Activity -->
            <div style="padding:0 var(--sp-lg) var(--sp-lg)">
              <div class="card card-body">
                <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Activity</div>
                ${i("WhatsApp",e.whatsapp_opted_in?"Opted In":"Not opted in")}
                ${i("Biometric",e.has_biometric?"Enrolled":"Not enrolled")}
              </div>
            </div>

            <!-- Actions -->
            <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;flex-direction:column;gap:var(--sp-sm)">
              <button class="btn btn-outline btn-full" id="btn-edit-member" style="font-weight:var(--fw-semibold)">
                ${n("edit",18)} Edit Member Details
              </button>
              <button class="btn btn-primary btn-full" id="btn-renew">
                ${n("renewals",18,"white")} Renew Membership
              </button>
              <button class="btn btn-outline btn-full" id="btn-record-payment">
                ${n("wallet",18)} Record Payment
              </button>
              <button class="btn btn-whatsapp btn-full" id="btn-send-reminder">
                ${n("whatsapp",18,"white")} Send WhatsApp Reminder
              </button>
              ${e.status!=="deleted"?`
                <button class="btn btn-danger btn-full btn-sm" id="btn-deactivate" style="margin-top:var(--sp-md)">
                  ${n("delete",16,"white")} Deactivate Member
                </button>
              `:""}
            </div>
          </div>
        </div>`;const d=()=>a.push("edit-member",{memberId:String(e.id)});E(t,{onBack:()=>a.pop(),actions:[{onClick:d}]}),t.querySelector("#btn-edit-member")?.addEventListener("click",d),t.querySelector("#btn-quick-edit")?.addEventListener("click",d),t.querySelector("#btn-edit-contact")?.addEventListener("click",d),t.querySelector("#btn-renew")?.addEventListener("click",()=>a.push("renew-member",{member:JSON.stringify(e)})),t.querySelector("#btn-record-payment")?.addEventListener("click",()=>a.push("record-payment",{memberId:String(e.id)})),t.querySelector("#btn-send-reminder")?.addEventListener("click",async()=>{const o=await v("/api/mobile/v1/whatsapp/send-reminder",{method:"POST",body:{member_id:e.id}});u(o.ok?"Reminder sent!":o.error.message,o.ok?"success":"error")}),t.querySelector("#btn-deactivate")?.addEventListener("click",async()=>{if(!await _({title:"Deactivate Member",message:`Are you sure you want to deactivate ${e.full_name}?`,confirmText:"Deactivate",destructive:!0}))return;const f=await v(`/api/mobile/v1/members/${e.id}/deactivate`,{method:"POST"});f.ok?(u("Member deactivated","success"),a.pop()):u(f.error.message,"error")})};e?c():t.innerHTML='<div style="padding:48px;text-align:center">Loading member details…</div>';const b=await v(`/api/mobile/v1/members/${m}`);if(b.ok)e=b.data,c();else if(!e){t.innerHTML=h(b.error?.message||"Member not found");return}const $=r=>{r?.detail&&String(r.detail.id)===String(m)&&(e=r.detail,c())};window.addEventListener("member-updated",$)}};export{A as default};
