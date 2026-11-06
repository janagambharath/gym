import{z as T,g as l,f as R,N as D,O as P,j as o,w as q,a as O,G as z,i as n,H as N,P as c,u as k,Q as j,b as H,n as u,s as a,J as g,q as $,R as U}from"./index-ByhK-z4i.js";const W={async mount(s,v){let e=null;try{v?.member&&(e=typeof v.member=="string"?JSON.parse(v.member):v.member)}catch{e=null}const f=e?.id||v?.memberId;if(!f){s.innerHTML=T("Member not found");return}const d=()=>{const m=D(e),x=U(m),S=P(e.days_until_expiry),E=e.door_access_failed===!0,C=e.door_access_stale_queued===!0,M=e.door_access_failed_action==="block"||e.door_access_failed_action==="unblock"?e.door_access_failed_action:null,B=E?`Retry ${M==="unblock"?"Unblock":"Block"} Access`:e.door_blocked?"Unblock Biometric Access":"Block Biometric Access",L=E?`Failed — tap to retry ${o(M||"the access change")}${e.door_access_error?`: ${o(e.door_access_error)}`:""}.`:C?`Queued — terminal hasn't checked in since ${o(q(e.door_access_terminal_last_seen_at||e.door_access_queued_since))}.`:e.door_access_pending?`Waiting for the terminal to confirm ${o(e.door_access_pending_action||"the access change")}.`:e.door_access_error?o(e.door_access_error):"";s.innerHTML=`
        ${O({title:"Member",showBack:!0,actions:[{icon:"edit",label:"Edit"}]})}
        <div class="scroll-view">
          <div class="scroll-content">
            <!-- Profile Card -->
            <div style="padding:var(--sp-xxl);text-align:center;background:var(--card);border-bottom:1px solid var(--border-light)">
              <div style="display:inline-flex">${z(e.full_name,"xl")}</div>
              <h2 style="font-size:var(--fs-3xl);margin-top:var(--sp-md);margin-bottom:var(--sp-xs)">${o(e.full_name)}</h2>
              <div style="margin-bottom:var(--sp-md);display:flex;gap:var(--sp-sm);justify-content:center">
                <a href="tel:${o(e.phone)}" class="btn btn-secondary" style="text-decoration:none">${n("phone",16)} Call</a>
                <a href="https://wa.me/${o(String(e.phone).replace(/\D/g,""))}" target="_blank" rel="noopener" class="btn btn-whatsapp" style="text-decoration:none">${n("whatsapp",16,"white")} WhatsApp</a>
              </div>
              <div style="color:var(--text-secondary);font-size:var(--fs-base);margin-bottom:var(--sp-xs)">${o(e.phone)}</div>
              ${e.address?`
                <div style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:var(--sp-sm);display:flex;align-items:center;justify-content:center;gap:6px">
                  ${n("location",16,"var(--brand)")} <span>${o(e.address)}</span>
                </div>
              `:`
                <div style="color:var(--muted);font-size:var(--fs-xs);margin-bottom:var(--sp-sm)">No address recorded</div>
              `}
              ${N(m)}
              ${S?`<div style="margin-top:var(--sp-sm);font-size:var(--fs-sm);color:${x.text}">${o(S)}</div>`:""}
            </div>

            <!-- Membership Info -->
            <div style="padding:var(--sp-lg)">
              <div class="card card-body">
                <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Membership</div>
                ${c("Plan",e.plan?.name||"—")}
                ${c("Start",k(e.membership_start))}
                ${c("End",k(e.membership_end))}
                ${e.days_until_expiry!=null?`
                  <div style="margin-top:var(--sp-md)">
                    <div class="progress-bar">
                      <div class="progress-bar-fill" style="width:${Math.max(0,Math.min(100,e.days_until_expiry/(e.plan?.duration_days||30)*100))}%;background:${x.text}"></div>
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
                ${c("Phone",e.phone)}
                ${c("Email",e.email||"—")}
                ${c("Address",e.address||"—")}
                ${c("Gender",e.gender||"—")}
                ${c("Joined",k(e.joined_on))}
                ${e.notes?c("Notes",e.notes):""}
              </div>
            </div>

            <!-- Activity -->
            <div style="padding:0 var(--sp-lg) var(--sp-lg)">
              <div class="card card-body">
                <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Activity & Access</div>
                ${j("Access Status",e.is_inside?'<span style="color:var(--success);font-weight:var(--fw-bold)">● Inside Gym Now</span>':"Outside")}
                ${e.is_inside&&e.last_entry_at?c("Entered At",q(e.last_entry_at)):""}
                ${c("WhatsApp",e.whatsapp_opted_in?"Opted In":"Not opted in")}
                ${c("Biometric",e.has_biometric?`Enrolled (ID #${o(e.device_enroll_number||"Enrolled")})`:"Not enrolled")}
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
                  ${c("Machine Enroll ID",`#${e.device_enroll_number||"—"}`)}
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
              <button class="btn btn-outline btn-full" id="btn-renewal-history">
                ${n("time",18)} Renewal History
              </button>
              ${e.status==="paused"?`
                <button class="btn btn-full" id="btn-unfreeze" style="font-weight:var(--fw-semibold);background:var(--success);color:white;display:flex;align-items:center;justify-content:center;gap:var(--sp-xs)">
                  ${n("check",18,"white")} Resume Membership (Unpause)
                </button>
              `:`
                <button class="btn btn-outline btn-full" id="btn-freeze" style="font-weight:var(--fw-semibold);display:flex;align-items:center;justify-content:center;gap:var(--sp-xs)">
                  ${n("lock",18)} Pause / Freeze Membership
                </button>
              `}
              <button class="btn btn-whatsapp btn-full" id="btn-send-reminder">
                ${n("whatsapp",18,"white")} Send WhatsApp Reminder
              </button>
              <button class="btn btn-outline btn-full" id="btn-toggle-access" style="font-weight:var(--fw-semibold);display:flex;align-items:center;justify-content:center;gap:var(--sp-xs)">
                ${n("lock",18)} <span id="btn-toggle-access-label">${o(B)}</span>
              </button>
              <div class="form-hint" id="door-access-state" role="status">${L}</div>
              <button class="btn btn-outline btn-full" id="btn-biometric-records" style="font-weight:var(--fw-semibold);display:flex;align-items:center;justify-content:center;gap:var(--sp-xs)">
                ${n("clock",18)} Biometric Records
              </button>
              ${e.status!=="deleted"?`
                <button class="btn btn-danger btn-full btn-sm" id="btn-deactivate" style="margin-top:var(--sp-md)">
                  ${n("delete",16,"white")} Deactivate Member
                </button>
              `:""}
            </div>
          </div>
        </div>`;const _=()=>u.push("edit-member",{memberId:String(e.id)});H(s,{onBack:()=>u.pop(),actions:[{onClick:_}]}),s.querySelector("#btn-edit-member")?.addEventListener("click",_),s.querySelector("#btn-edit-contact")?.addEventListener("click",_),s.querySelector("#btn-checkin")?.addEventListener("click",async()=>{const r=s.querySelector("#btn-checkin"),t=e.is_inside;r.disabled=!0,r.textContent=t?"Checking out...":"Checking in...";const i=await l("/api/mobile/v1/access/checkin",{method:"POST",body:{member_id:e.id,type:t?"EXIT":"ENTRY"}});i.ok&&i.data?.event_type==="ACCESS_DENIED"?(a(i.message||i.data?.message||`${e.full_name} was denied access — membership is not active.`,"error"),r.disabled=!1,r.innerHTML=e.is_inside?`${n("back",18)} Check Out Member`:`${n("access",18,"white")} Check In Member (Attendance)`):i.ok?(e.is_inside=!t,a(i.data?.message||(t?`${e.full_name} checked out`:`${e.full_name} checked in!`),"success"),d()):(a(i.error?.message||"Action failed","error"),r.disabled=!1,r.innerHTML=e.is_inside?`${n("back",18)} Check Out Member`:`${n("access",18,"white")} Check In Member (Attendance)`)});const A=async()=>{const r=await $({title:"Enroll Number",message:`Enter machine Enroll Number (User ID) for ${e.full_name}:`,placeholder:"e.g. 101",defaultValue:e.device_enroll_number||"",inputType:"text",confirmText:"Save"});if(r===null)return;const t=r.trim();if(!t){a("Please enter an enroll number","error");return}const i=await l(`/api/mobile/v1/members/${e.id}/enroll`,{method:"POST",body:{enroll_number:t}});i.ok?(a(`Biometric ID #${t} saved & synchronized!`,"success"),e.has_biometric=!0,e.device_enroll_number=t,d()):a(i.error?.message||"Enrollment failed","error")};s.querySelector("#btn-enroll-bio")?.addEventListener("click",A),s.querySelector("#btn-change-enroll")?.addEventListener("click",A),s.querySelector("#btn-unenroll-bio")?.addEventListener("click",async()=>{if(!await g({title:"Remove Biometric Enrollment?",message:`This will unassign device ID #${e.device_enroll_number} and block terminal access for ${e.full_name}.`,confirmText:"Unenroll",destructive:!0}))return;const t=await l(`/api/mobile/v1/members/${e.id}/unenroll`,{method:"POST"});t.ok?(a("Biometric enrollment removed","success"),e.has_biometric=!1,e.device_enroll_number=null,d()):a(t.error?.message||"Failed to unenroll","error")}),s.querySelector("#btn-renew")?.addEventListener("click",()=>u.push("renew-member",{member:JSON.stringify(e)})),s.querySelector("#btn-record-payment")?.addEventListener("click",()=>u.push("record-payment",{memberId:String(e.id)})),s.querySelector("#btn-renewal-history")?.addEventListener("click",()=>u.push("member-history",{memberId:String(e.id)}));let y=e.door_blocked===!0;s.querySelector("#btn-toggle-access")?.addEventListener("click",async()=>{const r=e.door_access_failed===!0&&(e.door_access_failed_action==="block"||e.door_access_failed_action==="unblock"),t=r?e.door_access_failed_action:y?"unblock":"block";if(!await g({title:r?`Retry ${t==="block"?"Block":"Unblock"} Biometric Access`:t==="block"?"Block Biometric Access":"Unblock Biometric Access",message:t==="block"?`${e.full_name} will not be able to enter with their fingerprint until unblocked.`:`${e.full_name} will be able to enter with their fingerprint again.`,confirmText:t==="block"?"Block Access":"Unblock Access",destructive:t==="block"}))return;const b=s.querySelector("#btn-toggle-access");b.disabled=!0;const p=await l(`/api/mobile/v1/rrr/members/${e.id}/access`,{method:"POST",body:{action:t}});if(b.disabled=!1,p.ok){y=t==="block",e.door_blocked=y,e.door_access_pending=!!p.data?.command,e.door_access_pending_action=t,e.door_access_error=null,e.door_access_failed=!1,e.door_access_failed_action=null,e.door_access_failed_at=null,e.door_access_stale_queued=!1,e.door_access_queued_since=null,s.querySelector("#btn-toggle-access-label").textContent=y?"Unblock Biometric Access":"Block Biometric Access",s.querySelector("#door-access-state").textContent=e.door_access_pending?`Waiting for the terminal to confirm ${t}.`:"";const I=p.data?.connector==="bridge"?"Command queued — the bridge applies it on its next poll.":"Command queued — the terminal applies it on its next check-in.";a(p.data?.command?I:`${t==="block"?"Blocked":"Unblocked"}.`,"success")}else s.querySelector("#door-access-state").textContent=p.error?.message||"",a(p.error?.message||`Could not ${t} access`,"error")}),s.querySelector("#btn-biometric-records")?.addEventListener("click",()=>{u.push("member-attendance",{id:e.id})}),s.querySelector("#btn-freeze")?.addEventListener("click",async()=>{const r=await $({title:"Pause Membership",message:`How many days would you like to pause ${e.full_name}'s membership?`,placeholder:"e.g. 7, 14, 30",defaultValue:"14",inputType:"number",confirmText:"Continue"});if(!r)return;const t=parseInt(r,10);if(isNaN(t)||t<1){a("Invalid number of days","error");return}const i=await $({title:"Pause Reason",message:"Reason for pause (optional):",placeholder:"e.g. Travel, Injury",defaultValue:"",confirmText:"Pause Membership"})||"",b=await l(`/api/mobile/v1/members/${e.id}/freeze`,{method:"POST",body:{days:t,reason:i}});b.ok?(a(b.data?.message||"Membership paused successfully","success"),e=b.data?.data||b.data,d()):a(b.error?.message||"Failed to pause membership","error")}),s.querySelector("#btn-unfreeze")?.addEventListener("click",async()=>{if(!await g({title:"Resume Membership",message:`Resume ${e.full_name}'s membership and restore biometric access?`,confirmText:"Resume"}))return;const t=await l(`/api/mobile/v1/members/${e.id}/unfreeze`,{method:"POST"});t.ok?(a("Membership resumed!","success"),e=t.data?.data||t.data,d()):a(t.error?.message||"Failed to resume membership","error")}),s.querySelector("#btn-send-reminder")?.addEventListener("click",async()=>{const r=await l("/api/mobile/v1/whatsapp/send-reminder",{method:"POST",body:{member_id:e.id}});a(r.ok?"Reminder sent!":r.error.message,r.ok?"success":"error")}),s.querySelector("#btn-deactivate")?.addEventListener("click",async()=>{if(!await g({title:"Deactivate Member",message:`Are you sure you want to deactivate ${e.full_name}?`,confirmText:"Deactivate",destructive:!0}))return;const t=await l(`/api/mobile/v1/members/${e.id}/deactivate`,{method:"POST"});t.ok?(a("Member deactivated","success"),u.pop()):a(t.error.message,"error")})};e?d():s.innerHTML='<div style="padding:48px;text-align:center">Loading member details…</div>';const h=await l(`/api/mobile/v1/members/${f}`);if(h.ok)e=h.data,d();else if(!e){s.innerHTML=T(h.error?.message||"Member not found");return}const w=m=>{m?.detail&&String(m.detail.id)===String(f)&&(e=m.detail,d())};window.addEventListener("member-updated",w),R(s,async()=>{const m=await l(`/api/mobile/v1/members/${f}`);m.ok&&s.dataset.screenDisposed!=="true"&&(e=m.data,d())},3e4,()=>window.removeEventListener("member-updated",w))}};export{W as default};
