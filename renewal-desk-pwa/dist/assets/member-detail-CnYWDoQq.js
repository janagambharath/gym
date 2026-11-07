import{z as C,d as P,N as z,O,f as i,w as L,a as N,G as H,i as n,H as j,P as c,t as x,Q as U,b as F,n as p,e as d,s as a,u as _,q as S,R as W}from"./index-BBUNrwaw.js";const J={async mount(s,f){let e=null;try{f?.member&&(e=typeof f.member=="string"?JSON.parse(f.member):f.member)}catch{e=null}const k=e?.id||f?.memberId;if(!k){s.innerHTML=C("Member not found");return}const l=()=>{const m=z(e),b=W(m),M=O(e.days_until_expiry),T=e.door_access_failed===!0,B=e.door_access_stale_queued===!0,A=e.door_access_failed_action==="block"||e.door_access_failed_action==="unblock"?e.door_access_failed_action:null,I=T?`Retry ${A==="unblock"?"Unblock":"Block"} Access`:e.door_blocked?"Unblock Biometric Access":"Block Biometric Access",R=T?`Failed — tap to retry ${i(A||"the access change")}${e.door_access_error?`: ${i(e.door_access_error)}`:""}.`:B?`Queued — terminal hasn't checked in since ${i(L(e.door_access_terminal_last_seen_at||e.door_access_queued_since))}.`:e.door_access_pending?`Waiting for the terminal to confirm ${i(e.door_access_pending_action||"the access change")}.`:e.door_access_error?i(e.door_access_error):"";s.innerHTML=`
        ${N({title:"Member",showBack:!0,actions:[{icon:"edit",label:"Edit"}]})}
        ${w?`<div id="md-stale-banner" style="padding:var(--sp-sm) var(--sp-lg);background:var(--warning-surface,#fef3c7);color:var(--warning,#92400e);font-size:var(--fs-sm);display:flex;align-items:center;justify-content:space-between;gap:var(--sp-sm)"><span>Showing saved details — refresh failed${y?`: ${i(y)}`:"."}</span><button class="btn btn-sm btn-secondary" id="md-refresh-retry">Try again</button></div>`:""}
        <div class="scroll-view">
          <div class="scroll-content">
            <!-- Profile Card -->
            <div style="padding:var(--sp-xxl);text-align:center;background:var(--card);border-bottom:1px solid var(--border-light)">
              <div style="display:inline-flex">${H(e.full_name,"xl")}</div>
              <h2 style="font-size:var(--fs-3xl);margin-top:var(--sp-md);margin-bottom:var(--sp-xs)">${i(e.full_name)}</h2>
              <div style="margin-bottom:var(--sp-md);display:flex;gap:var(--sp-sm);justify-content:center">
                <a href="tel:${i(e.phone)}" class="btn btn-secondary" style="text-decoration:none">${n("phone",16)} Call</a>
                <a href="https://wa.me/${i(String(e.phone).replace(/\D/g,""))}" target="_blank" rel="noopener" class="btn btn-whatsapp" style="text-decoration:none">${n("whatsapp",16,"white")} WhatsApp</a>
              </div>
              <div style="color:var(--text-secondary);font-size:var(--fs-base);margin-bottom:var(--sp-xs)">${i(e.phone)}</div>
              ${e.address?`
                <div style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:var(--sp-sm);display:flex;align-items:center;justify-content:center;gap:6px">
                  ${n("location",16,"var(--brand)")} <span>${i(e.address)}</span>
                </div>
              `:`
                <div style="color:var(--muted);font-size:var(--fs-xs);margin-bottom:var(--sp-sm)">No address recorded</div>
              `}
              ${j(m)}
              ${M?`<div style="margin-top:var(--sp-sm);font-size:var(--fs-sm);color:${b.text}">${i(M)}</div>`:""}
            </div>

            <!-- Membership Info -->
            <div style="padding:var(--sp-lg)">
              <div class="card card-body">
                <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Membership</div>
                ${c("Plan",e.plan?.name||"—")}
                ${c("Start",x(e.membership_start))}
                ${c("End",x(e.membership_end))}
                ${e.days_until_expiry!=null?`
                  <div style="margin-top:var(--sp-md)">
                    <div class="progress-bar">
                      <div class="progress-bar-fill" style="width:${Math.max(0,Math.min(100,e.days_until_expiry/(e.plan?.duration_days||30)*100))}%;background:${b.text}"></div>
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
                ${c("Joined",x(e.joined_on))}
                ${e.notes?c("Notes",e.notes):""}
              </div>
            </div>

            <!-- Activity -->
            <div style="padding:0 var(--sp-lg) var(--sp-lg)">
              <div class="card card-body">
                <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Activity & Access</div>
                ${U("Access Status",e.is_inside?'<span style="color:var(--success);font-weight:var(--fw-bold)">● Inside Gym Now</span>':"Outside")}
                ${e.is_inside&&e.last_entry_at?c("Entered At",L(e.last_entry_at)):""}
                ${c("WhatsApp",e.whatsapp_opted_in?"Opted In":"Not opted in")}
                ${c("Biometric",e.has_biometric?`Enrolled (ID #${i(e.device_enroll_number||"Enrolled")})`:"Not enrolled")}
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
                ${n("lock",18)} <span id="btn-toggle-access-label">${i(I)}</span>
              </button>
              <div class="form-hint" id="door-access-state" role="status">${R}</div>
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
        </div>`;const $=()=>p.push("edit-member",{memberId:String(e.id)});F(s,{onBack:()=>p.pop(),actions:[{onClick:$}]}),s.querySelector("#md-refresh-retry")?.addEventListener("click",()=>g()),s.querySelector("#btn-edit-member")?.addEventListener("click",$),s.querySelector("#btn-edit-contact")?.addEventListener("click",$),s.querySelector("#btn-checkin")?.addEventListener("click",async()=>{const r=s.querySelector("#btn-checkin"),t=e.is_inside;r.disabled=!0,r.textContent=t?"Checking out...":"Checking in...";const o=await d("/api/mobile/v1/access/checkin",{method:"POST",body:{member_id:e.id,type:t?"EXIT":"ENTRY"}});o.ok&&o.data?.event_type==="ACCESS_DENIED"?(a(o.message||o.data?.message||`${e.full_name} was denied access — membership is not active.`,"error"),r.disabled=!1,r.innerHTML=e.is_inside?`${n("back",18)} Check Out Member`:`${n("access",18,"white")} Check In Member (Attendance)`):o.ok?(e.is_inside=!t,a(o.data?.message||(t?`${e.full_name} checked out`:`${e.full_name} checked in!`),"success"),l()):(a(o.error?.message||"Action failed","error"),r.disabled=!1,r.innerHTML=e.is_inside?`${n("back",18)} Check Out Member`:`${n("access",18,"white")} Check In Member (Attendance)`)});const q=async()=>{const r=await S({title:"Enroll Number",message:`Enter machine Enroll Number (User ID) for ${e.full_name}:`,placeholder:"e.g. 101",defaultValue:e.device_enroll_number||"",inputType:"text",confirmText:"Save"});if(r===null)return;const t=r.trim();if(!t){a("Please enter an enroll number","error");return}const o=await d(`/api/mobile/v1/members/${e.id}/enroll`,{method:"POST",body:{enroll_number:t}});o.ok?(a(`Biometric ID #${t} saved & synchronized!`,"success"),e.has_biometric=!0,e.device_enroll_number=t,l()):a(o.error?.message||"Enrollment failed","error")};s.querySelector("#btn-enroll-bio")?.addEventListener("click",q),s.querySelector("#btn-change-enroll")?.addEventListener("click",q),s.querySelector("#btn-unenroll-bio")?.addEventListener("click",async()=>{if(!await _({title:"Remove Biometric Enrollment?",message:`This will unassign device ID #${e.device_enroll_number} and block terminal access for ${e.full_name}.`,confirmText:"Unenroll",destructive:!0}))return;const t=await d(`/api/mobile/v1/members/${e.id}/unenroll`,{method:"POST"});t.ok?(a("Biometric enrollment removed","success"),e.has_biometric=!1,e.device_enroll_number=null,l()):a(t.error?.message||"Failed to unenroll","error")}),s.querySelector("#btn-renew")?.addEventListener("click",()=>p.push("renew-member",{member:JSON.stringify(e)})),s.querySelector("#btn-record-payment")?.addEventListener("click",()=>p.push("record-payment",{memberId:String(e.id)})),s.querySelector("#btn-renewal-history")?.addEventListener("click",()=>p.push("member-history",{memberId:String(e.id)}));let h=e.door_blocked===!0;s.querySelector("#btn-toggle-access")?.addEventListener("click",async()=>{const r=e.door_access_failed===!0&&(e.door_access_failed_action==="block"||e.door_access_failed_action==="unblock"),t=r?e.door_access_failed_action:h?"unblock":"block";if(!await _({title:r?`Retry ${t==="block"?"Block":"Unblock"} Biometric Access`:t==="block"?"Block Biometric Access":"Unblock Biometric Access",message:t==="block"?`${e.full_name} will not be able to enter with their fingerprint until unblocked.`:`${e.full_name} will be able to enter with their fingerprint again.`,confirmText:t==="block"?"Block Access":"Unblock Access",destructive:t==="block"}))return;const u=s.querySelector("#btn-toggle-access");u.disabled=!0;const v=await d(`/api/mobile/v1/rrr/members/${e.id}/access`,{method:"POST",body:{action:t}});if(u.disabled=!1,v.ok){h=t==="block",e.door_blocked=h,e.door_access_pending=!!v.data?.command,e.door_access_pending_action=t,e.door_access_error=null,e.door_access_failed=!1,e.door_access_failed_action=null,e.door_access_failed_at=null,e.door_access_stale_queued=!1,e.door_access_queued_since=null,s.querySelector("#btn-toggle-access-label").textContent=h?"Unblock Biometric Access":"Block Biometric Access",s.querySelector("#door-access-state").textContent=e.door_access_pending?`Waiting for the terminal to confirm ${t}.`:"";const D=v.data?.connector==="bridge"?"Command queued — the bridge applies it on its next poll.":"Command queued — the terminal applies it on its next check-in.";a(v.data?.command?D:`${t==="block"?"Blocked":"Unblocked"}.`,"success")}else s.querySelector("#door-access-state").textContent=v.error?.message||"",a(v.error?.message||`Could not ${t} access`,"error")}),s.querySelector("#btn-biometric-records")?.addEventListener("click",()=>{p.push("member-attendance",{id:e.id})}),s.querySelector("#btn-freeze")?.addEventListener("click",async()=>{const r=await S({title:"Pause Membership",message:`How many days would you like to pause ${e.full_name}'s membership?`,placeholder:"e.g. 7, 14, 30",defaultValue:"14",inputType:"number",confirmText:"Continue"});if(!r)return;const t=parseInt(r,10);if(isNaN(t)||t<1){a("Invalid number of days","error");return}const o=await S({title:"Pause Reason",message:"Reason for pause (optional):",placeholder:"e.g. Travel, Injury",defaultValue:"",confirmText:"Pause Membership"})||"",u=await d(`/api/mobile/v1/members/${e.id}/freeze`,{method:"POST",body:{days:t,reason:o}});u.ok?(a(u.data?.message||"Membership paused successfully","success"),e=u.data?.data||u.data,l()):a(u.error?.message||"Failed to pause membership","error")}),s.querySelector("#btn-unfreeze")?.addEventListener("click",async()=>{if(!await _({title:"Resume Membership",message:`Resume ${e.full_name}'s membership and restore biometric access?`,confirmText:"Resume"}))return;const t=await d(`/api/mobile/v1/members/${e.id}/unfreeze`,{method:"POST"});t.ok?(a("Membership resumed!","success"),e=t.data?.data||t.data,l()):a(t.error?.message||"Failed to resume membership","error")}),s.querySelector("#btn-send-reminder")?.addEventListener("click",async()=>{const r=await d("/api/mobile/v1/whatsapp/send-reminder",{method:"POST",body:{member_id:e.id}});a(r.ok?"Reminder sent!":r.error.message,r.ok?"success":"error")}),s.querySelector("#btn-deactivate")?.addEventListener("click",async()=>{if(!await _({title:"Deactivate Member",message:`Are you sure you want to deactivate ${e.full_name}?`,confirmText:"Deactivate",destructive:!0}))return;const t=await d(`/api/mobile/v1/members/${e.id}/deactivate`,{method:"POST"});t.ok?(a("Member deactivated","success"),p.pop()):a(t.error.message,"error")})};let w=!1,y=null;const g=async(m=!1)=>{const b=await d(`/api/mobile/v1/members/${k}`);return b.ok?(e=b.data,w=!1,y=null,l(),!0):e?(w=!0,y=b.error?.message||null,m||a("Could not refresh member details — showing saved details.","error"),l(),!1):(b.error?.status===404?s.innerHTML='<div class="empty-state"><div class="empty-state-title">Member not found</div></div>':(s.innerHTML=C(b.error?.message||"Could not load this member."),s.querySelector("#retry-btn")?.addEventListener("click",()=>g())),!1)};e?l():s.innerHTML='<div style="padding:48px;text-align:center">Loading member details…</div>',await g();const E=m=>{m?.detail&&String(m.detail.id)===String(k)&&(e=m.detail,l())};window.addEventListener("member-updated",E),P(s,async()=>{await g(!0)},3e4,()=>window.removeEventListener("member-updated",E))}};export{J as default};
