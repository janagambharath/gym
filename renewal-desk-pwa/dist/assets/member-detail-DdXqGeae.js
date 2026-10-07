import{o as x,k as m,G as k,H as E,a as S,f as M,e as d,i as n,C as A,I as r,J as f,K as L,b as I,n as v,s as a,E as w,L as T}from"./index-BSLnJXYY.js";const D={async mount(t,b){let e=null;try{b?.member&&(e=typeof b.member=="string"?JSON.parse(b.member):b.member)}catch{e=null}const u=e?.id||b?.memberId;if(!u){t.innerHTML=x("Member not found");return}const o=()=>{const l=k(e),g=T(l),h=E(e.days_until_expiry);t.innerHTML=`
        ${S({title:"Member",showBack:!0,actions:[{icon:"edit",label:"Edit"}]})}
        <div class="scroll-view">
          <div class="scroll-content">
            <!-- Profile Card -->
            <div style="padding:var(--sp-xxl);text-align:center;background:var(--card);border-bottom:1px solid var(--border-light)">
              <div style="display:inline-flex">${M(e.full_name,"xl")}</div>
              <h2 style="font-size:var(--fs-3xl);margin-top:var(--sp-md);margin-bottom:var(--sp-xs)">${d(e.full_name)}</h2>
              <div style="color:var(--text-secondary);font-size:var(--fs-base);margin-bottom:var(--sp-xs)">${d(e.phone)}</div>
              ${e.address?`
                <div style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:var(--sp-sm);display:flex;align-items:center;justify-content:center;gap:6px">
                  ${n("location",16,"var(--brand)")} <span>${d(e.address)}</span>
                </div>
              `:`
                <div style="color:var(--muted);font-size:var(--fs-xs);margin-bottom:var(--sp-sm)">No address recorded</div>
              `}
              ${A(l)}
              ${h?`<div style="margin-top:var(--sp-sm);font-size:var(--fs-sm);color:${g.text}">${d(h)}</div>`:""}
              ${e.recent_otp?`
                <div style="background:var(--brand-subtle);border:1.5px solid var(--info-border);border-radius:var(--r-lg);padding:10px 14px;margin-top:var(--sp-md);display:inline-block;max-width:280px">
                  <div style="font-size:var(--fs-xs);color:var(--text-secondary);font-weight:var(--fw-medium)">Active Member App (VYNLA) Login Code</div>
                  <div style="font-size:22px;font-weight:var(--fw-extrabold);color:var(--brand);letter-spacing:4px;margin:2px 0">${d(e.recent_otp)}</div>
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
                ${r("Plan",e.plan?.name||"—")}
                ${r("Start",f(e.membership_start))}
                ${r("End",f(e.membership_end))}
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
                ${r("Phone",e.phone)}
                ${r("Email",e.email||"—")}
                ${r("Address",e.address||"—")}
                ${r("Gender",e.gender||"—")}
                ${r("Joined",f(e.joined_on))}
                ${e.notes?r("Notes",e.notes):""}
              </div>
            </div>

            <!-- Activity -->
            <div style="padding:0 var(--sp-lg) var(--sp-lg)">
              <div class="card card-body">
                <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Activity & Access</div>
                ${r("Access Status",e.is_inside?'<span style="color:var(--success);font-weight:var(--fw-bold)">● Inside Gym Now</span>':"Outside")}
                ${e.is_inside&&e.last_entry_at?r("Entered At",L(e.last_entry_at)):""}
                ${r("WhatsApp",e.whatsapp_opted_in?"Opted In":"Not opted in")}
                ${r("Biometric",e.has_biometric?`Enrolled (ID #${d(e.device_enroll_number||"Enrolled")})`:"Not enrolled")}
              </div>
            </div>

            <!-- Biometric Device Access -->
            <div style="padding:0 var(--sp-lg) var(--sp-lg)">
              <div class="card card-body">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-md)">
                  <div style="font-weight:var(--fw-bold);display:flex;align-items:center;gap:var(--sp-xs)">
                    ${n("access",18,"var(--brand)")} Biometric Access (eSSL)
                  </div>
                  ${e.has_biometric?'<span class="badge badge-success">● Synced</span>':'<span class="badge badge-muted">Not Enrolled</span>'}
                </div>
                ${e.has_biometric?`
                  ${r("Machine Enroll ID",`<b style="font-size:var(--fs-lg);color:var(--brand)">#${d(e.device_enroll_number||"Enrolled")}</b>`)}
                  <div style="display:flex;gap:var(--sp-sm);margin-top:var(--sp-md)">
                    <button class="btn btn-outline btn-sm btn-full" id="btn-change-enroll" style="display:flex;align-items:center;justify-content:center;gap:6px">
                      ${n("edit",14)} Change ID
                    </button>
                    <button class="btn btn-danger btn-sm btn-full" id="btn-unenroll-bio" style="display:flex;align-items:center;justify-content:center;gap:6px">
                      ${n("delete",14,"white")} Unenroll
                    </button>
                  </div>
                `:`
                  <div style="font-size:var(--fs-xs);color:var(--text-secondary);margin-bottom:var(--sp-md);line-height:1.5">
                    Not enrolled on biometric turnstile or terminal. Assign machine user ID to enable auto-block/unblock and attendance tracking.
                  </div>
                  <button class="btn btn-primary btn-sm btn-full" id="btn-enroll-bio" style="display:flex;align-items:center;justify-content:center;gap:6px">
                    ${n("access",16,"white")} Enroll on Biometric Terminal
                  </button>
                `}
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
        </div>`;const p=()=>v.push("edit-member",{memberId:String(e.id)});I(t,{onBack:()=>v.pop(),actions:[{onClick:p}]}),t.querySelector("#btn-edit-member")?.addEventListener("click",p),t.querySelector("#btn-quick-edit")?.addEventListener("click",p),t.querySelector("#btn-edit-contact")?.addEventListener("click",p),t.querySelector("#btn-checkin")?.addEventListener("click",async()=>{const s=t.querySelector("#btn-checkin"),i=e.is_inside;s.disabled=!0,s.textContent=i?"Checking out...":"Checking in...";const c=await m("/api/mobile/v1/access/checkin",{method:"POST",body:{member_id:e.id,type:i?"EXIT":"ENTRY"}});c.ok?(e.is_inside=!i,a(c.data?.message||(i?`${e.full_name} checked out`:`${e.full_name} checked in!`),"success"),o()):(a(c.error?.message||"Action failed","error"),s.disabled=!1,s.innerHTML=e.is_inside?`${n("back",18)} Check Out Member`:`${n("access",18,"white")} Check In Member (Attendance)`)});const $=async()=>{const s=window.prompt(`Enter machine Enroll Number (User ID) for ${e.full_name}:`,e.device_enroll_number||"");if(s===null)return;const i=s.trim();if(!i){a("Please enter an enroll number","error");return}const c=await m(`/api/mobile/v1/members/${e.id}/enroll`,{method:"POST",body:{enroll_number:i}});c.ok?(a(`Biometric ID #${i} saved & synchronized!`,"success"),e.has_biometric=!0,e.device_enroll_number=i,o()):a(c.error?.message||"Enrollment failed","error")};t.querySelector("#btn-enroll-bio")?.addEventListener("click",$),t.querySelector("#btn-change-enroll")?.addEventListener("click",$),t.querySelector("#btn-unenroll-bio")?.addEventListener("click",async()=>{if(!await w({title:"Remove Biometric Enrollment?",message:`This will unassign device ID #${e.device_enroll_number} and block terminal access for ${e.full_name}.`,confirmText:"Unenroll",destructive:!0}))return;const i=await m(`/api/mobile/v1/members/${e.id}/unenroll`,{method:"POST"});i.ok?(a("Biometric enrollment removed","success"),e.has_biometric=!1,e.device_enroll_number=null,o()):a(i.error?.message||"Failed to unenroll","error")}),t.querySelector("#btn-renew")?.addEventListener("click",()=>v.push("renew-member",{member:JSON.stringify(e)})),t.querySelector("#btn-record-payment")?.addEventListener("click",()=>v.push("record-payment",{memberId:String(e.id)})),t.querySelector("#btn-send-reminder")?.addEventListener("click",async()=>{const s=await m("/api/mobile/v1/whatsapp/send-reminder",{method:"POST",body:{member_id:e.id}});a(s.ok?"Reminder sent!":s.error.message,s.ok?"success":"error")}),t.querySelector("#btn-deactivate")?.addEventListener("click",async()=>{if(!await w({title:"Deactivate Member",message:`Are you sure you want to deactivate ${e.full_name}?`,confirmText:"Deactivate",destructive:!0}))return;const i=await m(`/api/mobile/v1/members/${e.id}/deactivate`,{method:"POST"});i.ok?(a("Member deactivated","success"),v.pop()):a(i.error.message,"error")})};e?o():t.innerHTML='<div style="padding:48px;text-align:center">Loading member details…</div>';const y=await m(`/api/mobile/v1/members/${u}`);if(y.ok)e=y.data,o();else if(!e){t.innerHTML=x(y.error?.message||"Member not found");return}const _=l=>{l?.detail&&String(l.detail.id)===String(u)&&(e=l.detail,o())};window.addEventListener("member-updated",_)}};export{D as default};
