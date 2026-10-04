import{o as $,k as m,G as k,H as x,a as _,f as M,e as b,i,D as S,I as s,J as f,b as E,n as o,s as l,F as A,K as C}from"./index-Bj4WanBC.js";const T={async mount(t,d){let e=null;try{d?.member&&(e=typeof d.member=="string"?JSON.parse(d.member):d.member)}catch{e=null}const v=e?.id||d?.memberId;if(!v){t.innerHTML=$("Member not found");return}const p=()=>{const r=k(e),g=C(r),h=x(e.days_until_expiry);t.innerHTML=`
        ${_({title:"Member",showBack:!0,actions:[{icon:"edit",label:"Edit"}]})}
        <div class="scroll-view">
          <div class="scroll-content">
            <!-- Profile Card -->
            <div style="padding:var(--sp-xxl);text-align:center;background:var(--card);border-bottom:1px solid var(--border-light)">
              <div style="display:inline-flex">${M(e.full_name,"xl")}</div>
              <h2 style="font-size:var(--fs-3xl);margin-top:var(--sp-md);margin-bottom:var(--sp-xs)">${b(e.full_name)}</h2>
              <div style="color:var(--text-secondary);font-size:var(--fs-base);margin-bottom:var(--sp-xs)">${b(e.phone)}</div>
              ${e.address?`
                <div style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:var(--sp-sm);display:flex;align-items:center;justify-content:center;gap:6px">
                  ${i("location",16,"var(--brand)")} <span>${b(e.address)}</span>
                </div>
              `:`
                <div style="color:var(--muted);font-size:var(--fs-xs);margin-bottom:var(--sp-sm)">No address recorded</div>
              `}
              ${S(r)}
              ${h?`<div style="margin-top:var(--sp-sm);font-size:var(--fs-sm);color:${g.text}">${b(h)}</div>`:""}
              <div style="margin-top:var(--sp-md)">
                <button class="btn btn-outline btn-sm" id="btn-quick-edit" style="display:inline-flex;align-items:center;gap:6px">
                  ${i("edit",14)} Edit Member
                </button>
              </div>
            </div>

            <!-- Membership Info -->
            <div style="padding:var(--sp-lg)">
              <div class="card card-body">
                <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Membership</div>
                ${s("Plan",e.plan?.name||"—")}
                ${s("Start",f(e.membership_start))}
                ${s("End",f(e.membership_end))}
                ${e.days_until_expiry!=null?`
                  <div style="margin-top:var(--sp-md)">
                    <div class="progress-bar">
                      <div class="progress-bar-fill" style="width:${Math.max(0,Math.min(100,e.days_until_expiry/(e.plan?.duration_days||30)*100))}%;background:${g.text}"></div>
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
                    ${i("edit",14)} Edit
                  </button>
                </div>
                ${s("Phone",e.phone)}
                ${s("Email",e.email||"—")}
                ${s("Address",e.address||"—")}
                ${s("Gender",e.gender||"—")}
                ${s("Joined",f(e.joined_on))}
                ${e.notes?s("Notes",e.notes):""}
              </div>
            </div>

            <!-- Activity -->
            <div style="padding:0 var(--sp-lg) var(--sp-lg)">
              <div class="card card-body">
                <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Activity & Access</div>
                ${s("Access Status",e.is_inside?'<span style="color:var(--success);font-weight:var(--fw-bold)">● Inside Gym Now</span>':"Outside")}
                ${e.is_inside&&e.last_entry_at?s("Entered At",formatDateTime(e.last_entry_at)):""}
                ${s("WhatsApp",e.whatsapp_opted_in?"Opted In":"Not opted in")}
                ${s("Biometric",e.has_biometric?"Enrolled":"Not enrolled")}
              </div>
            </div>

            <!-- Actions -->
            <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;flex-direction:column;gap:var(--sp-sm)">
              <button class="btn ${e.is_inside?"btn-secondary":"btn-primary"} btn-full" id="btn-checkin" style="font-weight:var(--fw-semibold)">
                ${e.is_inside?`${i("back",18)} Check Out Member`:`${i("access",18,"white")} Check In Member (Attendance)`}
              </button>
              <button class="btn btn-outline btn-full" id="btn-edit-member" style="font-weight:var(--fw-semibold)">
                ${i("edit",18)} Edit Member Details
              </button>
              <button class="btn btn-outline btn-full" id="btn-renew">
                ${i("renewals",18)} Renew Membership
              </button>
              <button class="btn btn-outline btn-full" id="btn-record-payment">
                ${i("wallet",18)} Record Payment
              </button>
              <button class="btn btn-whatsapp btn-full" id="btn-send-reminder">
                ${i("whatsapp",18,"white")} Send WhatsApp Reminder
              </button>
              ${e.status!=="deleted"?`
                <button class="btn btn-danger btn-full btn-sm" id="btn-deactivate" style="margin-top:var(--sp-md)">
                  ${i("delete",16,"white")} Deactivate Member
                </button>
              `:""}
            </div>
          </div>
        </div>`;const c=()=>o.push("edit-member",{memberId:String(e.id)});E(t,{onBack:()=>o.pop(),actions:[{onClick:c}]}),t.querySelector("#btn-edit-member")?.addEventListener("click",c),t.querySelector("#btn-quick-edit")?.addEventListener("click",c),t.querySelector("#btn-edit-contact")?.addEventListener("click",c),t.querySelector("#btn-checkin")?.addEventListener("click",async()=>{const n=t.querySelector("#btn-checkin"),a=e.is_inside;n.disabled=!0,n.textContent=a?"Checking out...":"Checking in...";const y=await m("/api/mobile/v1/access/checkin",{method:"POST",body:{member_id:e.id,type:a?"EXIT":"ENTRY"}});y.ok?(e.is_inside=!a,l(y.data?.message||(a?`${e.full_name} checked out`:`${e.full_name} checked in!`),"success"),loadData()):(l(y.error?.message||"Action failed","error"),n.disabled=!1,n.innerHTML=e.is_inside?`${i("back",18)} Check Out Member`:`${i("access",18,"white")} Check In Member (Attendance)`)}),t.querySelector("#btn-renew")?.addEventListener("click",()=>o.push("renew-member",{member:JSON.stringify(e)})),t.querySelector("#btn-record-payment")?.addEventListener("click",()=>o.push("record-payment",{memberId:String(e.id)})),t.querySelector("#btn-send-reminder")?.addEventListener("click",async()=>{const n=await m("/api/mobile/v1/whatsapp/send-reminder",{method:"POST",body:{member_id:e.id}});l(n.ok?"Reminder sent!":n.error.message,n.ok?"success":"error")}),t.querySelector("#btn-deactivate")?.addEventListener("click",async()=>{if(!await A({title:"Deactivate Member",message:`Are you sure you want to deactivate ${e.full_name}?`,confirmText:"Deactivate",destructive:!0}))return;const a=await m(`/api/mobile/v1/members/${e.id}/deactivate`,{method:"POST"});a.ok?(l("Member deactivated","success"),o.pop()):l(a.error.message,"error")})};e?p():t.innerHTML='<div style="padding:48px;text-align:center">Loading member details…</div>';const u=await m(`/api/mobile/v1/members/${v}`);if(u.ok)e=u.data,p();else if(!e){t.innerHTML=$(u.error?.message||"Member not found");return}const w=r=>{r?.detail&&String(r.detail.id)===String(v)&&(e=r.detail,p())};window.addEventListener("member-updated",w)}};export{T as default};
