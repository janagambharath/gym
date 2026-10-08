import{q as _,e as l,D as E,E as S,a as M,y as T,f as c,i as s,z as I,F as a,G as g,H as L,b as A,n as u,s as i,B as h,I as z}from"./index-BRoIJu_f.js";const D={async mount(n,b){let e=null;try{b?.member&&(e=typeof b.member=="string"?JSON.parse(b.member):b.member)}catch{e=null}const y=e?.id||b?.memberId;if(!y){n.innerHTML=_("Member not found");return}const o=()=>{const m=E(e),w=z(m),$=S(e.days_until_expiry);n.innerHTML=`
        ${M({title:"Member",showBack:!0,actions:[{icon:"edit",label:"Edit"}]})}
        <div class="scroll-view">
          <div class="scroll-content">
            <!-- Profile Card -->
            <div style="padding:var(--sp-xxl);text-align:center;background:var(--card);border-bottom:1px solid var(--border-light)">
              <div style="display:inline-flex">${T(e.full_name,"xl")}</div>
              <h2 style="font-size:var(--fs-3xl);margin-top:var(--sp-md);margin-bottom:var(--sp-xs)">${c(e.full_name)}</h2>
              <div style="color:var(--text-secondary);font-size:var(--fs-base);margin-bottom:var(--sp-xs)">${c(e.phone)}</div>
              ${e.address?`
                <div style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:var(--sp-sm);display:flex;align-items:center;justify-content:center;gap:6px">
                  ${s("location",16,"var(--brand)")} <span>${c(e.address)}</span>
                </div>
              `:`
                <div style="color:var(--muted);font-size:var(--fs-xs);margin-bottom:var(--sp-sm)">No address recorded</div>
              `}
              ${I(m)}
              ${$?`<div style="margin-top:var(--sp-sm);font-size:var(--fs-sm);color:${w.text}">${c($)}</div>`:""}
              ${e.recent_otp?`
                <div style="background:var(--brand-subtle);border:1.5px solid var(--info-border);border-radius:var(--r-lg);padding:10px 14px;margin-top:var(--sp-md);display:inline-block;max-width:280px">
                  <div style="font-size:var(--fs-xs);color:var(--text-secondary);font-weight:var(--fw-medium)">Active Member App (VYNLA) Login Code</div>
                  <div style="font-size:22px;font-weight:var(--fw-extrabold);color:var(--brand);letter-spacing:4px;margin:2px 0">${c(e.recent_otp)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Expires in ~${Math.max(1,Math.round((e.recent_otp_expires_in||600)/60))} min</div>
                </div>
              `:""}
              <div style="margin-top:var(--sp-md)">
                <button class="btn btn-outline btn-sm" id="btn-quick-edit" style="display:inline-flex;align-items:center;gap:6px">
                  ${s("edit",14)} Edit Member
                </button>
              </div>
            </div>

            <!-- Membership Info -->
            <div style="padding:var(--sp-lg)">
              <div class="card card-body">
                <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Membership</div>
                ${a("Plan",e.plan?.name||"—")}
                ${a("Start",g(e.membership_start))}
                ${a("End",g(e.membership_end))}
                ${e.days_until_expiry!=null?`
                  <div style="margin-top:var(--sp-md)">
                    <div class="progress-bar">
                      <div class="progress-bar-fill" style="width:${Math.max(0,Math.min(100,e.days_until_expiry/(e.plan?.duration_days||30)*100))}%;background:${w.text}"></div>
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
                    ${s("edit",14)} Edit
                  </button>
                </div>
                ${a("Phone",e.phone)}
                ${a("Email",e.email||"—")}
                ${a("Address",e.address||"—")}
                ${a("Gender",e.gender||"—")}
                ${a("Joined",g(e.joined_on))}
                ${e.notes?a("Notes",e.notes):""}
              </div>
            </div>

            <!-- Activity -->
            <div style="padding:0 var(--sp-lg) var(--sp-lg)">
              <div class="card card-body">
                <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Activity & Access</div>
                ${a("Access Status",e.is_inside?'<span style="color:var(--success);font-weight:var(--fw-bold)">● Inside Gym Now</span>':"Outside")}
                ${e.is_inside&&e.last_entry_at?a("Entered At",L(e.last_entry_at)):""}
                ${a("WhatsApp",e.whatsapp_opted_in?"Opted In":"Not opted in")}
                ${a("Biometric",e.has_biometric?`Enrolled (ID #${c(e.device_enroll_number||"Enrolled")})`:"Not enrolled")}
              </div>
            </div>

            <!-- Biometric Device Access -->
            <div style="padding:0 var(--sp-lg) var(--sp-lg)">
              <div class="card card-body">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-md)">
                  <div style="font-weight:var(--fw-bold);display:flex;align-items:center;gap:var(--sp-xs)">
                    ${s("access",18,"var(--brand)")} Biometric Access (eSSL)
                  </div>
                  ${e.has_biometric?'<span class="badge badge-success">● Synced</span>':'<span class="badge badge-muted">Not Enrolled</span>'}
                </div>
                ${e.has_biometric?`
                  ${a("Machine Enroll ID",`<b style="font-size:var(--fs-lg);color:var(--brand)">#${c(e.device_enroll_number||"Enrolled")}</b>`)}
                  <div style="display:flex;gap:var(--sp-sm);margin-top:var(--sp-md)">
                    <button class="btn btn-outline btn-sm btn-full" id="btn-change-enroll" style="display:flex;align-items:center;justify-content:center;gap:6px">
                      ${s("edit",14)} Change ID
                    </button>
                    <button class="btn btn-danger btn-sm btn-full" id="btn-unenroll-bio" style="display:flex;align-items:center;justify-content:center;gap:6px">
                      ${s("delete",14,"white")} Unenroll
                    </button>
                  </div>
                `:`
                  <div style="font-size:var(--fs-xs);color:var(--text-secondary);margin-bottom:var(--sp-md);line-height:1.5">
                    Not enrolled on biometric turnstile or terminal. Assign machine user ID to enable auto-block/unblock and attendance tracking.
                  </div>
                  <button class="btn btn-primary btn-sm btn-full" id="btn-enroll-bio" style="display:flex;align-items:center;justify-content:center;gap:6px">
                    ${s("access",16,"white")} Enroll on Biometric Terminal
                  </button>
                `}
              </div>
            </div>

            <!-- Actions -->
            <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;flex-direction:column;gap:var(--sp-sm)">
              <button class="btn ${e.is_inside?"btn-secondary":"btn-primary"} btn-full" id="btn-checkin" style="font-weight:var(--fw-semibold)">
                ${e.is_inside?`${s("back",18)} Check Out Member`:`${s("access",18,"white")} Check In Member (Attendance)`}
              </button>
              <button class="btn btn-outline btn-full" id="btn-edit-member" style="font-weight:var(--fw-semibold)">
                ${s("edit",18)} Edit Member Details
              </button>
              <button class="btn btn-outline btn-full" id="btn-renew">
                ${s("renewals",18)} Renew Membership
              </button>
              <button class="btn btn-outline btn-full" id="btn-record-payment">
                ${s("wallet",18)} Record Payment
              </button>
              ${e.status==="paused"?`
                <button class="btn btn-full" id="btn-unfreeze" style="font-weight:var(--fw-semibold);background:var(--success);color:white;display:flex;align-items:center;justify-content:center;gap:var(--sp-xs)">
                  ${s("check",18,"white")} Resume Membership (Unpause)
                </button>
              `:`
                <button class="btn btn-outline btn-full" id="btn-freeze" style="font-weight:var(--fw-semibold);display:flex;align-items:center;justify-content:center;gap:var(--sp-xs)">
                  ${s("lock",18)} Pause / Freeze Membership
                </button>
              `}
              <button class="btn btn-whatsapp btn-full" id="btn-send-reminder">
                ${s("whatsapp",18,"white")} Send WhatsApp Reminder
              </button>
              ${e.status!=="deleted"?`
                <button class="btn btn-danger btn-full btn-sm" id="btn-deactivate" style="margin-top:var(--sp-md)">
                  ${s("delete",16,"white")} Deactivate Member
                </button>
              `:""}
            </div>
          </div>
        </div>`;const p=()=>u.push("edit-member",{memberId:String(e.id)});A(n,{onBack:()=>u.pop(),actions:[{onClick:p}]}),n.querySelector("#btn-edit-member")?.addEventListener("click",p),n.querySelector("#btn-quick-edit")?.addEventListener("click",p),n.querySelector("#btn-edit-contact")?.addEventListener("click",p),n.querySelector("#btn-checkin")?.addEventListener("click",async()=>{const r=n.querySelector("#btn-checkin"),t=e.is_inside;r.disabled=!0,r.textContent=t?"Checking out...":"Checking in...";const d=await l("/api/mobile/v1/access/checkin",{method:"POST",body:{member_id:e.id,type:t?"EXIT":"ENTRY"}});d.ok?(e.is_inside=!t,i(d.data?.message||(t?`${e.full_name} checked out`:`${e.full_name} checked in!`),"success"),o()):(i(d.error?.message||"Action failed","error"),r.disabled=!1,r.innerHTML=e.is_inside?`${s("back",18)} Check Out Member`:`${s("access",18,"white")} Check In Member (Attendance)`)});const x=async()=>{const r=window.prompt(`Enter machine Enroll Number (User ID) for ${e.full_name}:`,e.device_enroll_number||"");if(r===null)return;const t=r.trim();if(!t){i("Please enter an enroll number","error");return}const d=await l(`/api/mobile/v1/members/${e.id}/enroll`,{method:"POST",body:{enroll_number:t}});d.ok?(i(`Biometric ID #${t} saved & synchronized!`,"success"),e.has_biometric=!0,e.device_enroll_number=t,o()):i(d.error?.message||"Enrollment failed","error")};n.querySelector("#btn-enroll-bio")?.addEventListener("click",x),n.querySelector("#btn-change-enroll")?.addEventListener("click",x),n.querySelector("#btn-unenroll-bio")?.addEventListener("click",async()=>{if(!await h({title:"Remove Biometric Enrollment?",message:`This will unassign device ID #${e.device_enroll_number} and block terminal access for ${e.full_name}.`,confirmText:"Unenroll",destructive:!0}))return;const t=await l(`/api/mobile/v1/members/${e.id}/unenroll`,{method:"POST"});t.ok?(i("Biometric enrollment removed","success"),e.has_biometric=!1,e.device_enroll_number=null,o()):i(t.error?.message||"Failed to unenroll","error")}),n.querySelector("#btn-renew")?.addEventListener("click",()=>u.push("renew-member",{member:JSON.stringify(e)})),n.querySelector("#btn-record-payment")?.addEventListener("click",()=>u.push("record-payment",{memberId:String(e.id)})),n.querySelector("#btn-freeze")?.addEventListener("click",async()=>{const r=window.prompt(`How many days would you like to pause ${e.full_name}'s membership? (e.g. 7, 14, 30)`,"14");if(!r)return;const t=parseInt(r,10);if(isNaN(t)||t<1){i("Invalid number of days","error");return}const d=window.prompt("Reason for pause (optional, e.g. Travel, Injury):","")||"",v=await l(`/api/mobile/v1/members/${e.id}/freeze`,{method:"POST",body:{days:t,reason:d}});v.ok?(i(v.data?.message||"Membership paused successfully","success"),e=v.data?.data||v.data,o()):i(v.error?.message||"Failed to pause membership","error")}),n.querySelector("#btn-unfreeze")?.addEventListener("click",async()=>{if(!await h({title:"Resume Membership",message:`Resume ${e.full_name}'s membership and restore biometric access?`,confirmText:"Resume"}))return;const t=await l(`/api/mobile/v1/members/${e.id}/unfreeze`,{method:"POST"});t.ok?(i("Membership resumed!","success"),e=t.data?.data||t.data,o()):i(t.error?.message||"Failed to resume membership","error")}),n.querySelector("#btn-send-reminder")?.addEventListener("click",async()=>{const r=await l("/api/mobile/v1/whatsapp/send-reminder",{method:"POST",body:{member_id:e.id}});i(r.ok?"Reminder sent!":r.error.message,r.ok?"success":"error")}),n.querySelector("#btn-deactivate")?.addEventListener("click",async()=>{if(!await h({title:"Deactivate Member",message:`Are you sure you want to deactivate ${e.full_name}?`,confirmText:"Deactivate",destructive:!0}))return;const t=await l(`/api/mobile/v1/members/${e.id}/deactivate`,{method:"POST"});t.ok?(i("Member deactivated","success"),u.pop()):i(t.error.message,"error")})};e?o():n.innerHTML='<div style="padding:48px;text-align:center">Loading member details…</div>';const f=await l(`/api/mobile/v1/members/${y}`);if(f.ok)e=f.data,o();else if(!e){n.innerHTML=_(f.error?.message||"Member not found");return}const k=m=>{m?.detail&&String(m.detail.id)===String(y)&&(e=m.detail,o())};window.addEventListener("member-updated",k)}};export{D as default};
