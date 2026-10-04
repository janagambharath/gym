import{o as x,k as b,G as w,H as k,a as _,f as M,e as o,i as n,C as E,I as i,J as f,b as S,n as l,s as c,E as A,K as C}from"./index-GI8SEG_C.js";const T={async mount(t,d){let e=null;try{d?.member&&(e=typeof d.member=="string"?JSON.parse(d.member):d.member)}catch{e=null}const v=e?.id||d?.memberId;if(!v){t.innerHTML=x("Member not found");return}const p=()=>{const a=w(e),g=C(a),h=k(e.days_until_expiry);t.innerHTML=`
        ${_({title:"Member",showBack:!0,actions:[{icon:"edit",label:"Edit"}]})}
        <div class="scroll-view">
          <div class="scroll-content">
            <!-- Profile Card -->
            <div style="padding:var(--sp-xxl);text-align:center;background:var(--card);border-bottom:1px solid var(--border-light)">
              <div style="display:inline-flex">${M(e.full_name,"xl")}</div>
              <h2 style="font-size:var(--fs-3xl);margin-top:var(--sp-md);margin-bottom:var(--sp-xs)">${o(e.full_name)}</h2>
              <div style="color:var(--text-secondary);font-size:var(--fs-base);margin-bottom:var(--sp-xs)">${o(e.phone)}</div>
              ${e.address?`
                <div style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:var(--sp-sm);display:flex;align-items:center;justify-content:center;gap:6px">
                  ${n("location",16,"var(--brand)")} <span>${o(e.address)}</span>
                </div>
              `:`
                <div style="color:var(--muted);font-size:var(--fs-xs);margin-bottom:var(--sp-sm)">No address recorded</div>
              `}
              ${E(a)}
              ${h?`<div style="margin-top:var(--sp-sm);font-size:var(--fs-sm);color:${g.text}">${o(h)}</div>`:""}
              ${e.recent_otp?`
                <div style="background:var(--brand-subtle);border:1.5px solid var(--info-border);border-radius:var(--r-lg);padding:10px 14px;margin-top:var(--sp-md);display:inline-block;max-width:280px">
                  <div style="font-size:var(--fs-xs);color:var(--text-secondary);font-weight:var(--fw-medium)">Active Member App (VYNLA) Login Code</div>
                  <div style="font-size:22px;font-weight:var(--fw-extrabold);color:var(--brand);letter-spacing:4px;margin:2px 0">${o(e.recent_otp)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Expires in ~${Math.max(1,Math.round((e.recent_otp_expires_in||600)/60))} min</div>
                </div>
              `:""}
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
                ${i("Start",f(e.membership_start))}
                ${i("End",f(e.membership_end))}
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
                    ${n("edit",14)} Edit
                  </button>
                </div>
                ${i("Phone",e.phone)}
                ${i("Email",e.email||"—")}
                ${i("Address",e.address||"—")}
                ${i("Gender",e.gender||"—")}
                ${i("Joined",f(e.joined_on))}
                ${e.notes?i("Notes",e.notes):""}
              </div>
            </div>

            <!-- Activity -->
            <div style="padding:0 var(--sp-lg) var(--sp-lg)">
              <div class="card card-body">
                <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Activity & Access</div>
                ${i("Access Status",e.is_inside?'<span style="color:var(--success);font-weight:var(--fw-bold)">● Inside Gym Now</span>':"Outside")}
                ${e.is_inside&&e.last_entry_at?i("Entered At",formatDateTime(e.last_entry_at)):""}
                ${i("WhatsApp",e.whatsapp_opted_in?"Opted In":"Not opted in")}
                ${i("Biometric",e.has_biometric?"Enrolled":"Not enrolled")}
              </div>
            </div>

            <!-- Actions -->
            <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;flex-direction:column;gap:var(--sp-sm)">
              <button class="btn ${e.is_inside?"btn-secondary":"btn-primary"} btn-full" id="btn-checkin" style="font-weight:var(--fw-semibold)">
                ${e.is_inside?`${n("back",18)} Check Out Member`:`${n("access",18,"white")} Check In Member (Attendance)`}
              </button>
              <button class="btn btn-outline btn-full" id="btn-edit-member" style="font-weight:var(--fw-semibold)">
                ${n("edit",18)} Edit Member Details
              </button>
              <button class="btn btn-outline btn-full" id="btn-renew">
                ${n("renewals",18)} Renew Membership
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
        </div>`;const m=()=>l.push("edit-member",{memberId:String(e.id)});S(t,{onBack:()=>l.pop(),actions:[{onClick:m}]}),t.querySelector("#btn-edit-member")?.addEventListener("click",m),t.querySelector("#btn-quick-edit")?.addEventListener("click",m),t.querySelector("#btn-edit-contact")?.addEventListener("click",m),t.querySelector("#btn-checkin")?.addEventListener("click",async()=>{const s=t.querySelector("#btn-checkin"),r=e.is_inside;s.disabled=!0,s.textContent=r?"Checking out...":"Checking in...";const y=await b("/api/mobile/v1/access/checkin",{method:"POST",body:{member_id:e.id,type:r?"EXIT":"ENTRY"}});y.ok?(e.is_inside=!r,c(y.data?.message||(r?`${e.full_name} checked out`:`${e.full_name} checked in!`),"success"),loadData()):(c(y.error?.message||"Action failed","error"),s.disabled=!1,s.innerHTML=e.is_inside?`${n("back",18)} Check Out Member`:`${n("access",18,"white")} Check In Member (Attendance)`)}),t.querySelector("#btn-renew")?.addEventListener("click",()=>l.push("renew-member",{member:JSON.stringify(e)})),t.querySelector("#btn-record-payment")?.addEventListener("click",()=>l.push("record-payment",{memberId:String(e.id)})),t.querySelector("#btn-send-reminder")?.addEventListener("click",async()=>{const s=await b("/api/mobile/v1/whatsapp/send-reminder",{method:"POST",body:{member_id:e.id}});c(s.ok?"Reminder sent!":s.error.message,s.ok?"success":"error")}),t.querySelector("#btn-deactivate")?.addEventListener("click",async()=>{if(!await A({title:"Deactivate Member",message:`Are you sure you want to deactivate ${e.full_name}?`,confirmText:"Deactivate",destructive:!0}))return;const r=await b(`/api/mobile/v1/members/${e.id}/deactivate`,{method:"POST"});r.ok?(c("Member deactivated","success"),l.pop()):c(r.error.message,"error")})};e?p():t.innerHTML='<div style="padding:48px;text-align:center">Loading member details…</div>';const u=await b(`/api/mobile/v1/members/${v}`);if(u.ok)e=u.data,p();else if(!e){t.innerHTML=x(u.error?.message||"Member not found");return}const $=a=>{a?.detail&&String(a.detail.id)===String(v)&&(e=a.detail,p())};window.addEventListener("member-updated",$)}};export{T as default};
