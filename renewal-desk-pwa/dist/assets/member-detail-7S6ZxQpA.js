import{z as R,N as g,d as O,R as U,S as F,f as i,m as P,a as W,G as D,i as a,H as G,T as l,o as M,U as J,b as K,n as p,s as n,V,v as h,e as m,W as Q,u as T,X}from"./index-ClFlXszA.js";const Z={async mount(s,y){let e=null;try{y?.member&&(e=typeof y.member=="string"?JSON.parse(y.member):y.member)}catch{e=null}const $=e?.id||y?.memberId;if(!$){s.innerHTML=R("Member not found");return}let q=g(),x=g();const d=()=>{const b=U(e),u=X(b),A=F(e.days_until_expiry),C=e.door_access_failed===!0,z=e.door_access_stale_queued===!0,B=e.door_access_failed_action==="block"||e.door_access_failed_action==="unblock"?e.door_access_failed_action:null,N=C?`Retry ${B==="unblock"?"Unblock":"Block"} Access`:e.door_blocked?"Unblock Biometric Access":"Block Biometric Access",j=C?`Failed — tap to retry ${i(B||"the access change")}${e.door_access_error?`: ${i(e.door_access_error)}`:""}.`:z?`Queued — terminal hasn't checked in since ${i(P(e.door_access_terminal_last_seen_at||e.door_access_queued_since))}.`:e.door_access_pending?`Waiting for the terminal to confirm ${i(e.door_access_pending_action||"the access change")}.`:e.door_access_error?i(e.door_access_error):"";s.innerHTML=`
        ${W({title:"Member",showBack:!0,actions:[{icon:"edit",label:"Edit"}]})}
        ${S?`<div id="md-stale-banner" style="padding:var(--sp-sm) var(--sp-lg);background:var(--warning-surface,#fef3c7);color:var(--warning,#92400e);font-size:var(--fs-sm);display:flex;align-items:center;justify-content:space-between;gap:var(--sp-sm)"><span>Showing saved details — refresh failed${_?`: ${i(_)}`:"."}</span><button class="btn btn-sm btn-secondary" id="md-refresh-retry">Try again</button></div>`:""}
        <div class="scroll-view">
          <div class="scroll-content">
            <!-- Profile Card -->
            <div style="padding:var(--sp-xxl);text-align:center;background:var(--card);border-bottom:1px solid var(--border-light)">
              <div id="md-photo-wrap" role="button" tabindex="0" title="Tap to change photo" style="display:inline-flex;cursor:pointer">${D(e.full_name,"xl",e.profile_photo_url)}</div>
              <input type="file" id="md-photo-input" accept="image/jpeg,image/png,image/webp" style="display:none">
              ${e.profile_photo_url?`
                <div><button class="btn btn-sm btn-link" id="md-photo-remove" style="padding:0;font-size:var(--fs-xs);color:var(--danger,#b91c1c)">Remove photo</button></div>
              `:`
                <div style="color:var(--muted);font-size:var(--fs-xs);margin-top:var(--sp-xs)">Tap photo to add · JPEG, PNG, or WebP · up to 3 MB</div>
              `}
              <h2 style="font-size:var(--fs-3xl);margin-top:var(--sp-md);margin-bottom:var(--sp-xs)">${i(e.full_name)}</h2>
              <div style="margin-bottom:var(--sp-md);display:flex;gap:var(--sp-sm);justify-content:center">
                <a href="tel:${i(e.phone)}" class="btn btn-secondary" style="text-decoration:none">${a("phone",16)} Call</a>
                <a href="https://wa.me/${i(String(e.phone).replace(/\D/g,""))}" target="_blank" rel="noopener" class="btn btn-whatsapp" style="text-decoration:none">${a("whatsapp",16,"white")} WhatsApp</a>
              </div>
              <div style="color:var(--text-secondary);font-size:var(--fs-base);margin-bottom:var(--sp-xs)">${i(e.phone)}</div>
              ${e.address?`
                <div style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:var(--sp-sm);display:flex;align-items:center;justify-content:center;gap:6px">
                  ${a("location",16,"var(--brand)")} <span>${i(e.address)}</span>
                </div>
              `:`
                <div style="color:var(--muted);font-size:var(--fs-xs);margin-bottom:var(--sp-sm)">No address recorded</div>
              `}
              ${G(b)}
              ${A?`<div style="margin-top:var(--sp-sm);font-size:var(--fs-sm);color:${u.text}">${i(A)}</div>`:""}
            </div>

            <!-- Membership Info -->
            <div style="padding:var(--sp-lg)">
              <div class="card card-body">
                <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Membership</div>
                ${l("Plan",e.plan?.name||"—")}
                ${l("Start",M(e.membership_start))}
                ${l("End",M(e.membership_end))}
                ${e.days_until_expiry!=null?`
                  <div style="margin-top:var(--sp-md)">
                    <div class="progress-bar">
                      <div class="progress-bar-fill" style="width:${Math.max(0,Math.min(100,e.days_until_expiry/(e.plan?.duration_days||30)*100))}%;background:${u.text}"></div>
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
                    ${a("edit",14)} Edit
                  </button>
                </div>
                ${l("Phone",e.phone)}
                ${l("Email",e.email||"—")}
                ${l("Address",e.address||"—")}
                ${l("Gender",e.gender||"—")}
                ${l("Joined",M(e.joined_on))}
                ${e.notes?l("Notes",e.notes):""}
              </div>
            </div>

            <!-- Activity -->
            <div style="padding:0 var(--sp-lg) var(--sp-lg)">
              <div class="card card-body">
                <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Activity & Access</div>
                ${J("Access Status",e.is_inside?'<span style="color:var(--success);font-weight:var(--fw-bold)">● Inside Gym Now</span>':"Outside")}
                ${e.is_inside&&e.last_entry_at?l("Entered At",P(e.last_entry_at)):""}
                ${l("WhatsApp",e.whatsapp_opted_in?"Opted In":"Not opted in")}
                ${l("Biometric",e.has_biometric?`Enrolled (ID #${i(e.device_enroll_number||"Enrolled")})`:"Not enrolled")}
              </div>
            </div>

            <!-- Biometric Device Access -->
            <div style="padding:0 var(--sp-lg) var(--sp-lg)">
              <div class="card card-body">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-md)">
                  <div style="font-weight:var(--fw-bold);display:flex;align-items:center;gap:var(--sp-xs)">
                    ${a("access",18,"var(--brand)")} Biometric Access (eSSL)
                  </div>
                  ${e.has_biometric?'<span class="badge badge-success">● Synced</span>':'<span class="badge badge-muted">Not Enrolled</span>'}
                </div>
                ${e.has_biometric?`
                  ${l("Machine Enroll ID",`#${e.device_enroll_number||"—"}`)}
                  <div style="display:flex;gap:var(--sp-sm);margin-top:var(--sp-md)">
                    <button class="btn btn-outline btn-sm btn-full" id="btn-change-enroll" style="display:flex;align-items:center;justify-content:center;gap:6px">
                      ${a("edit",14)} Change ID
                    </button>
                    <button class="btn btn-danger btn-sm btn-full" id="btn-unenroll-bio" style="display:flex;align-items:center;justify-content:center;gap:6px">
                      ${a("delete",14,"white")} Unenroll
                    </button>
                  </div>
                `:`
                  <div style="font-size:var(--fs-xs);color:var(--text-secondary);margin-bottom:var(--sp-md);line-height:1.5">
                    Not enrolled on biometric turnstile or terminal. Assign machine user ID to enable auto-block/unblock and attendance tracking.
                  </div>
                  <button class="btn btn-primary btn-sm btn-full" id="btn-enroll-bio" style="display:flex;align-items:center;justify-content:center;gap:6px">
                    ${a("access",16,"white")} Enroll on Biometric Terminal
                  </button>
                `}
              </div>
            </div>

            <!-- Actions -->
            <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;flex-direction:column;gap:var(--sp-sm)">
              <button class="btn ${e.is_inside?"btn-secondary":"btn-primary"} btn-full" id="btn-checkin" style="font-weight:var(--fw-semibold)">
                ${e.is_inside?`${a("back",18)} Check Out Member`:`${a("access",18,"white")} Check In Member (Attendance)`}
              </button>
              <button class="btn btn-outline btn-full" id="btn-edit-member" style="font-weight:var(--fw-semibold)">
                ${a("edit",18)} Edit Member Details
              </button>
              <button class="btn btn-outline btn-full" id="btn-renew">
                ${a("renewals",18)} Renew Membership
              </button>
              <button class="btn btn-outline btn-full" id="btn-record-payment">
                ${a("wallet",18)} Record Payment
              </button>
              <button class="btn btn-outline btn-full" id="btn-renewal-history">
                ${a("time",18)} Renewal History
              </button>
              ${e.status==="paused"?`
                <button class="btn btn-full" id="btn-unfreeze" style="font-weight:var(--fw-semibold);background:var(--success);color:white;display:flex;align-items:center;justify-content:center;gap:var(--sp-xs)">
                  ${a("check",18,"white")} Resume Membership (Unpause)
                </button>
              `:`
                <button class="btn btn-outline btn-full" id="btn-freeze" style="font-weight:var(--fw-semibold);display:flex;align-items:center;justify-content:center;gap:var(--sp-xs)">
                  ${a("lock",18)} Pause / Freeze Membership
                </button>
              `}
              <button class="btn btn-whatsapp btn-full" id="btn-send-reminder">
                ${a("whatsapp",18,"white")} Send WhatsApp Reminder
              </button>
              <button class="btn btn-outline btn-full" id="btn-toggle-access" style="font-weight:var(--fw-semibold);display:flex;align-items:center;justify-content:center;gap:var(--sp-xs)">
                ${a("lock",18)} <span id="btn-toggle-access-label">${i(N)}</span>
              </button>
              <div class="form-hint" id="door-access-state" role="status">${j}</div>
              <button class="btn btn-outline btn-full" id="btn-biometric-records" style="font-weight:var(--fw-semibold);display:flex;align-items:center;justify-content:center;gap:var(--sp-xs)">
                ${a("clock",18)} Biometric Records
              </button>
              ${e.status!=="deleted"?`
                <button class="btn btn-danger btn-full btn-sm" id="btn-deactivate" style="margin-top:var(--sp-md)">
                  ${a("delete",16,"white")} Deactivate Member
                </button>
              `:""}
            </div>
          </div>
        </div>`;const E=()=>p.push("edit-member",{memberId:String(e.id)});K(s,{onBack:()=>p.pop(),actions:[{onClick:E}]}),s.querySelector("#md-refresh-retry")?.addEventListener("click",()=>v());const k=s.querySelector("#md-photo-wrap");k?.querySelector("img")?.addEventListener("error",()=>{k&&(k.innerHTML=D(e.full_name,"xl"))}),k?.addEventListener("click",()=>{s.querySelector("#md-photo-input")?.click()}),s.querySelector("#md-photo-input")?.addEventListener("change",async r=>{const t=r.target.files?.[0];if(!t)return;if(!["image/jpeg","image/png","image/webp"].includes(t.type)||t.size>3*1024*1024){n("Choose a JPEG, PNG, or WebP photo up to 3 MB.","error"),r.target.value="";return}const o=new FormData;o.append("photo",t);const c=await V(`/api/mobile/v1/members/${e.id}/photo`,o);c.ok?(n("Profile photo updated","success"),await v()):n(c.error?.message||"Could not upload photo","error"),r.target.value=""}),s.querySelector("#md-photo-remove")?.addEventListener("click",async()=>{if(!await h({title:"Remove profile photo?",message:`Remove the profile photo for ${e.full_name}?`,confirmText:"Remove",destructive:!0}))return;const t=await m(`/api/mobile/v1/members/${e.id}/photo`,{method:"DELETE"});t.ok?(n("Profile photo removed","success"),await v()):n(t.error?.message||"Could not remove photo","error")}),s.querySelector("#btn-edit-member")?.addEventListener("click",E),s.querySelector("#btn-edit-contact")?.addEventListener("click",E),s.querySelector("#btn-checkin")?.addEventListener("click",async()=>{const r=s.querySelector("#btn-checkin"),t=e.is_inside;r.disabled=!0,r.textContent=t?"Checking out...":"Checking in...";const o=await Q(e.id,t?"EXIT":"ENTRY",{idempotencyKey:x});o.ok&&o.data?.event_type==="ACCESS_DENIED"?(x=g(),n(o.message||o.data?.message||`${e.full_name} was denied access — membership is not active.`,"error"),r.disabled=!1,r.innerHTML=e.is_inside?`${a("back",18)} Check Out Member`:`${a("access",18,"white")} Check In Member (Attendance)`):o.ok?(x=g(),e.is_inside=!t,n(o.data?.message||(t?`${e.full_name} checked out`:`${e.full_name} checked in!`),"success"),d()):(n(o.error?.message||"Action failed","error"),r.disabled=!1,r.innerHTML=e.is_inside?`${a("back",18)} Check Out Member`:`${a("access",18,"white")} Check In Member (Attendance)`)});const I=async()=>{const r=await T({title:"Enroll Number",message:`Enter machine Enroll Number (User ID) for ${e.full_name}:`,placeholder:"e.g. 101",defaultValue:e.device_enroll_number||"",inputType:"text",confirmText:"Save"});if(r===null)return;const t=r.trim();if(!t){n("Please enter an enroll number","error");return}const o=await m(`/api/mobile/v1/members/${e.id}/enroll`,{method:"POST",body:{enroll_number:t}});o.ok?(n(`Biometric ID #${t} saved & synchronized!`,"success"),e.has_biometric=!0,e.device_enroll_number=t,d()):n(o.error?.message||"Enrollment failed","error")};s.querySelector("#btn-enroll-bio")?.addEventListener("click",I),s.querySelector("#btn-change-enroll")?.addEventListener("click",I),s.querySelector("#btn-unenroll-bio")?.addEventListener("click",async()=>{if(!await h({title:"Remove Biometric Enrollment?",message:`This will unassign device ID #${e.device_enroll_number} and block terminal access for ${e.full_name}.`,confirmText:"Unenroll",destructive:!0}))return;const t=await m(`/api/mobile/v1/members/${e.id}/unenroll`,{method:"POST"});t.ok?(n("Biometric enrollment removed","success"),e.has_biometric=!1,e.device_enroll_number=null,d()):n(t.error?.message||"Failed to unenroll","error")}),s.querySelector("#btn-renew")?.addEventListener("click",()=>p.push("renew-member",{member:JSON.stringify(e)})),s.querySelector("#btn-record-payment")?.addEventListener("click",()=>p.push("record-payment",{memberId:String(e.id)})),s.querySelector("#btn-renewal-history")?.addEventListener("click",()=>p.push("member-history",{memberId:String(e.id)}));let w=e.door_blocked===!0;s.querySelector("#btn-toggle-access")?.addEventListener("click",async()=>{const r=e.door_access_failed===!0&&(e.door_access_failed_action==="block"||e.door_access_failed_action==="unblock"),t=r?e.door_access_failed_action:w?"unblock":"block";if(!await h({title:r?`Retry ${t==="block"?"Block":"Unblock"} Biometric Access`:t==="block"?"Block Biometric Access":"Unblock Biometric Access",message:t==="block"?`${e.full_name} will not be able to enter with their fingerprint until unblocked.`:`${e.full_name} will be able to enter with their fingerprint again.`,confirmText:t==="block"?"Block Access":"Unblock Access",destructive:t==="block"}))return;const c=s.querySelector("#btn-toggle-access");c.disabled=!0;const f=await m(`/api/mobile/v1/rrr/members/${e.id}/access`,{method:"POST",body:{action:t}});if(c.disabled=!1,f.ok){w=t==="block",e.door_blocked=w,e.door_access_pending=!!f.data?.command,e.door_access_pending_action=t,e.door_access_error=null,e.door_access_failed=!1,e.door_access_failed_action=null,e.door_access_failed_at=null,e.door_access_stale_queued=!1,e.door_access_queued_since=null,s.querySelector("#btn-toggle-access-label").textContent=w?"Unblock Biometric Access":"Block Biometric Access",s.querySelector("#door-access-state").textContent=e.door_access_pending?`Waiting for the terminal to confirm ${t}.`:"";const H=f.data?.connector==="bridge"?"Command queued — the bridge applies it on its next poll.":"Command queued — the terminal applies it on its next check-in.";n(f.data?.command?H:`${t==="block"?"Blocked":"Unblocked"}.`,"success")}else s.querySelector("#door-access-state").textContent=f.error?.message||"",n(f.error?.message||`Could not ${t} access`,"error")}),s.querySelector("#btn-biometric-records")?.addEventListener("click",()=>{p.push("member-attendance",{id:e.id})}),s.querySelector("#btn-freeze")?.addEventListener("click",async()=>{const r=await T({title:"Pause Membership",message:`How many days would you like to pause ${e.full_name}'s membership?`,placeholder:"e.g. 7, 14, 30",defaultValue:"14",inputType:"number",confirmText:"Continue"});if(!r)return;const t=parseInt(r,10);if(isNaN(t)||t<1){n("Invalid number of days","error");return}const o=await T({title:"Pause Reason",message:"Reason for pause (optional):",placeholder:"e.g. Travel, Injury",defaultValue:"",confirmText:"Pause Membership"})||"",c=await m(`/api/mobile/v1/members/${e.id}/freeze`,{method:"POST",body:{days:t,reason:o}});c.ok?(n(c.message||c.data?.message||"Membership paused successfully","success"),e=c.data?.data||c.data,d()):n(c.error?.message||"Failed to pause membership","error")}),s.querySelector("#btn-unfreeze")?.addEventListener("click",async()=>{if(!await h({title:"Resume Membership",message:`Resume ${e.full_name}'s membership and restore biometric access?`,confirmText:"Resume"}))return;const t=await m(`/api/mobile/v1/members/${e.id}/unfreeze`,{method:"POST"});t.ok?(n(t.message||t.data?.message||"Membership resumed!","success"),e=t.data?.data||t.data,d()):n(t.error?.message||"Failed to resume membership","error")}),s.querySelector("#btn-send-reminder")?.addEventListener("click",async()=>{const r=s.querySelector("#btn-send-reminder");if(!r||r.disabled)return;r.disabled=!0;const t=await m("/api/mobile/v1/whatsapp/send-reminder",{method:"POST",body:{member_id:e.id},headers:{"Idempotency-Key":q}});t.ok?(n("Reminder sent!","success"),q=g()):n(t.error.message,"error"),r.disabled=!1}),s.querySelector("#btn-deactivate")?.addEventListener("click",async()=>{if(!await h({title:"Deactivate Member",message:`Are you sure you want to deactivate ${e.full_name}?`,confirmText:"Deactivate",destructive:!0}))return;const t=await m(`/api/mobile/v1/members/${e.id}/deactivate`,{method:"POST"});t.ok?(n("Member deactivated","success"),p.pop()):n(t.error.message,"error")})};let S=!1,_=null;const v=async(b=!1)=>{const u=await m(`/api/mobile/v1/members/${$}`);return u.ok?(e=u.data,S=!1,_=null,d(),!0):e?(S=!0,_=u.error?.message||null,b||n("Could not refresh member details — showing saved details.","error"),d(),!1):(u.error?.status===404?s.innerHTML='<div class="empty-state"><div class="empty-state-title">Member not found</div></div>':(s.innerHTML=R(u.error?.message||"Could not load this member."),s.querySelector("#retry-btn")?.addEventListener("click",()=>v())),!1)};e?d():s.innerHTML='<div style="padding:48px;text-align:center">Loading member details…</div>',await v();const L=b=>{b?.detail&&String(b.detail.id)===String($)&&(e=b.detail,d())};window.addEventListener("member-updated",L),O(s,async()=>{await v(!0)},3e4,()=>window.removeEventListener("member-updated",L))}};export{Z as default};
