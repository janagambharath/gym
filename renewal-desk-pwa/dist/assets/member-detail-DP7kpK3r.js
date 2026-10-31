import{u as S,f as d,G as T,H as A,a as B,B as I,g as m,i as r,C,I as a,J as w,F as L,b as q,n as b,s as i,E as y,p as k,K as D}from"./index-Dv7TxQNl.js";const R={async mount(s,p){let e=null;try{p?.member&&(e=typeof p.member=="string"?JSON.parse(p.member):p.member)}catch{e=null}const f=e?.id||p?.memberId;if(!f){s.innerHTML=S("Member not found");return}const c=()=>{const u=T(e),$=D(u),x=A(e.days_until_expiry);s.innerHTML=`
        ${B({title:"Member",showBack:!0,actions:[{icon:"edit",label:"Edit"}]})}
        <div class="scroll-view">
          <div class="scroll-content">
            <!-- Profile Card -->
            <div style="padding:var(--sp-xxl);text-align:center;background:var(--card);border-bottom:1px solid var(--border-light)">
              <div style="display:inline-flex">${I(e.full_name,"xl")}</div>
              <h2 style="font-size:var(--fs-3xl);margin-top:var(--sp-md);margin-bottom:var(--sp-xs)">${m(e.full_name)}</h2>
              <div style="margin-bottom:var(--sp-md);display:flex;gap:var(--sp-sm);justify-content:center">
                <a href="tel:${m(e.phone)}" class="btn btn-secondary" style="text-decoration:none">${r("phone",16)} Call</a>
                <a href="https://wa.me/${m(String(e.phone).replace(/\D/g,""))}" target="_blank" rel="noopener" class="btn btn-whatsapp" style="text-decoration:none">${r("whatsapp",16,"white")} WhatsApp</a>
              </div>
              <div style="color:var(--text-secondary);font-size:var(--fs-base);margin-bottom:var(--sp-xs)">${m(e.phone)}</div>
              ${e.address?`
                <div style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:var(--sp-sm);display:flex;align-items:center;justify-content:center;gap:6px">
                  ${r("location",16,"var(--brand)")} <span>${m(e.address)}</span>
                </div>
              `:`
                <div style="color:var(--muted);font-size:var(--fs-xs);margin-bottom:var(--sp-sm)">No address recorded</div>
              `}
              ${C(u)}
              ${x?`<div style="margin-top:var(--sp-sm);font-size:var(--fs-sm);color:${$.text}">${m(x)}</div>`:""}
            </div>

            <!-- Membership Info -->
            <div style="padding:var(--sp-lg)">
              <div class="card card-body">
                <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Membership</div>
                ${a("Plan",e.plan?.name||"—")}
                ${a("Start",w(e.membership_start))}
                ${a("End",w(e.membership_end))}
                ${e.days_until_expiry!=null?`
                  <div style="margin-top:var(--sp-md)">
                    <div class="progress-bar">
                      <div class="progress-bar-fill" style="width:${Math.max(0,Math.min(100,e.days_until_expiry/(e.plan?.duration_days||30)*100))}%;background:${$.text}"></div>
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
                    ${r("edit",14)} Edit
                  </button>
                </div>
                ${a("Phone",e.phone)}
                ${a("Email",e.email||"—")}
                ${a("Address",e.address||"—")}
                ${a("Gender",e.gender||"—")}
                ${a("Joined",w(e.joined_on))}
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
                ${a("Biometric",e.has_biometric?`Enrolled (ID #${m(e.device_enroll_number||"Enrolled")})`:"Not enrolled")}
              </div>
            </div>

            <!-- Biometric Device Access -->
            <div style="padding:0 var(--sp-lg) var(--sp-lg)">
              <div class="card card-body">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-md)">
                  <div style="font-weight:var(--fw-bold);display:flex;align-items:center;gap:var(--sp-xs)">
                    ${r("access",18,"var(--brand)")} Biometric Access (eSSL)
                  </div>
                  ${e.has_biometric?'<span class="badge badge-success">● Synced</span>':'<span class="badge badge-muted">Not Enrolled</span>'}
                </div>
                ${e.has_biometric?`
                  ${a("Machine Enroll ID",`#${e.device_enroll_number||"—"}`)}
                  <div style="display:flex;gap:var(--sp-sm);margin-top:var(--sp-md)">
                    <button class="btn btn-outline btn-sm btn-full" id="btn-change-enroll" style="display:flex;align-items:center;justify-content:center;gap:6px">
                      ${r("edit",14)} Change ID
                    </button>
                    <button class="btn btn-danger btn-sm btn-full" id="btn-unenroll-bio" style="display:flex;align-items:center;justify-content:center;gap:6px">
                      ${r("delete",14,"white")} Unenroll
                    </button>
                  </div>
                `:`
                  <div style="font-size:var(--fs-xs);color:var(--text-secondary);margin-bottom:var(--sp-md);line-height:1.5">
                    Not enrolled on biometric turnstile or terminal. Assign machine user ID to enable auto-block/unblock and attendance tracking.
                  </div>
                  <button class="btn btn-primary btn-sm btn-full" id="btn-enroll-bio" style="display:flex;align-items:center;justify-content:center;gap:6px">
                    ${r("access",16,"white")} Enroll on Biometric Terminal
                  </button>
                `}
              </div>
            </div>

            <!-- Actions -->
            <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;flex-direction:column;gap:var(--sp-sm)">
              <button class="btn ${e.is_inside?"btn-secondary":"btn-primary"} btn-full" id="btn-checkin" style="font-weight:var(--fw-semibold)">
                ${e.is_inside?`${r("back",18)} Check Out Member`:`${r("access",18,"white")} Check In Member (Attendance)`}
              </button>
              <button class="btn btn-outline btn-full" id="btn-edit-member" style="font-weight:var(--fw-semibold)">
                ${r("edit",18)} Edit Member Details
              </button>
              <button class="btn btn-outline btn-full" id="btn-renew">
                ${r("renewals",18)} Renew Membership
              </button>
              <button class="btn btn-outline btn-full" id="btn-record-payment">
                ${r("wallet",18)} Record Payment
              </button>
              <button class="btn btn-outline btn-full" id="btn-renewal-history">
                ${r("time",18)} Renewal History
              </button>
              ${e.status==="paused"?`
                <button class="btn btn-full" id="btn-unfreeze" style="font-weight:var(--fw-semibold);background:var(--success);color:white;display:flex;align-items:center;justify-content:center;gap:var(--sp-xs)">
                  ${r("check",18,"white")} Resume Membership (Unpause)
                </button>
              `:`
                <button class="btn btn-outline btn-full" id="btn-freeze" style="font-weight:var(--fw-semibold);display:flex;align-items:center;justify-content:center;gap:var(--sp-xs)">
                  ${r("lock",18)} Pause / Freeze Membership
                </button>
              `}
              <button class="btn btn-whatsapp btn-full" id="btn-send-reminder">
                ${r("whatsapp",18,"white")} Send WhatsApp Reminder
              </button>
              <button class="btn btn-outline btn-full" id="btn-toggle-access" style="font-weight:var(--fw-semibold);display:flex;align-items:center;justify-content:center;gap:var(--sp-xs)">
                ${r("lock",18)} <span id="btn-toggle-access-label">${e.door_blocked?"Unblock Biometric Access":"Block Biometric Access"}</span>
              </button>
              <button class="btn btn-outline btn-full" id="btn-biometric-records" style="font-weight:var(--fw-semibold);display:flex;align-items:center;justify-content:center;gap:var(--sp-xs)">
                ${r("clock",18)} Biometric Records
              </button>
              ${e.status!=="deleted"?`
                <button class="btn btn-danger btn-full btn-sm" id="btn-deactivate" style="margin-top:var(--sp-md)">
                  ${r("delete",16,"white")} Deactivate Member
                </button>
              `:""}
            </div>
          </div>
        </div>`;const h=()=>b.push("edit-member",{memberId:String(e.id)});q(s,{onBack:()=>b.pop(),actions:[{onClick:h}]}),s.querySelector("#btn-edit-member")?.addEventListener("click",h),s.querySelector("#btn-edit-contact")?.addEventListener("click",h),s.querySelector("#btn-checkin")?.addEventListener("click",async()=>{const t=s.querySelector("#btn-checkin"),n=e.is_inside;t.disabled=!0,t.textContent=n?"Checking out...":"Checking in...";const o=await d("/api/mobile/v1/access/checkin",{method:"POST",body:{member_id:e.id,type:n?"EXIT":"ENTRY"}});o.ok?(e.is_inside=!n,i(o.data?.message||(n?`${e.full_name} checked out`:`${e.full_name} checked in!`),"success"),c()):(i(o.error?.message||"Action failed","error"),t.disabled=!1,t.innerHTML=e.is_inside?`${r("back",18)} Check Out Member`:`${r("access",18,"white")} Check In Member (Attendance)`)});const _=async()=>{const t=await k({title:"Enroll Number",message:`Enter machine Enroll Number (User ID) for ${e.full_name}:`,placeholder:"e.g. 101",defaultValue:e.device_enroll_number||"",inputType:"text",confirmText:"Save"});if(t===null)return;const n=t.trim();if(!n){i("Please enter an enroll number","error");return}const o=await d(`/api/mobile/v1/members/${e.id}/enroll`,{method:"POST",body:{enroll_number:n}});o.ok?(i(`Biometric ID #${n} saved & synchronized!`,"success"),e.has_biometric=!0,e.device_enroll_number=n,c()):i(o.error?.message||"Enrollment failed","error")};s.querySelector("#btn-enroll-bio")?.addEventListener("click",_),s.querySelector("#btn-change-enroll")?.addEventListener("click",_),s.querySelector("#btn-unenroll-bio")?.addEventListener("click",async()=>{if(!await y({title:"Remove Biometric Enrollment?",message:`This will unassign device ID #${e.device_enroll_number} and block terminal access for ${e.full_name}.`,confirmText:"Unenroll",destructive:!0}))return;const n=await d(`/api/mobile/v1/members/${e.id}/unenroll`,{method:"POST"});n.ok?(i("Biometric enrollment removed","success"),e.has_biometric=!1,e.device_enroll_number=null,c()):i(n.error?.message||"Failed to unenroll","error")}),s.querySelector("#btn-renew")?.addEventListener("click",()=>b.push("renew-member",{member:JSON.stringify(e)})),s.querySelector("#btn-record-payment")?.addEventListener("click",()=>b.push("record-payment",{memberId:String(e.id)})),s.querySelector("#btn-renewal-history")?.addEventListener("click",()=>b.push("member-history",{memberId:String(e.id)}));let v=e.door_blocked===!0;s.querySelector("#btn-toggle-access")?.addEventListener("click",async()=>{const t=v?"unblock":"block";if(!await y({title:t==="block"?"Block Biometric Access":"Unblock Biometric Access",message:t==="block"?`${e.full_name} will not be able to enter with their fingerprint until unblocked.`:`${e.full_name} will be able to enter with their fingerprint again.`,confirmText:t==="block"?"Block Access":"Unblock Access",destructive:t==="block"}))return;const o=s.querySelector("#btn-toggle-access");o.disabled=!0;const l=await d(`/api/mobile/v1/rrr/members/${e.id}/access`,{method:"POST",body:{action:t}});if(o.disabled=!1,l.ok){v=t==="block",e.door_blocked=v,s.querySelector("#btn-toggle-access-label").textContent=v?"Unblock Biometric Access":"Block Biometric Access";const M=l.data?.connector==="bridge"?"Command queued — the bridge applies it on its next poll.":"Command queued — the terminal applies it on its next check-in.";i(l.data?.command?M:`${t==="block"?"Blocked":"Unblocked"}.`,"success")}else i(l.error?.message||`Could not ${t} access`,"error")}),s.querySelector("#btn-biometric-records")?.addEventListener("click",()=>{b.push("member-attendance",{id:e.id})}),s.querySelector("#btn-freeze")?.addEventListener("click",async()=>{const t=await k({title:"Pause Membership",message:`How many days would you like to pause ${e.full_name}'s membership?`,placeholder:"e.g. 7, 14, 30",defaultValue:"14",inputType:"number",confirmText:"Continue"});if(!t)return;const n=parseInt(t,10);if(isNaN(n)||n<1){i("Invalid number of days","error");return}const o=await k({title:"Pause Reason",message:"Reason for pause (optional):",placeholder:"e.g. Travel, Injury",defaultValue:"",confirmText:"Pause Membership"})||"",l=await d(`/api/mobile/v1/members/${e.id}/freeze`,{method:"POST",body:{days:n,reason:o}});l.ok?(i(l.data?.message||"Membership paused successfully","success"),e=l.data?.data||l.data,c()):i(l.error?.message||"Failed to pause membership","error")}),s.querySelector("#btn-unfreeze")?.addEventListener("click",async()=>{if(!await y({title:"Resume Membership",message:`Resume ${e.full_name}'s membership and restore biometric access?`,confirmText:"Resume"}))return;const n=await d(`/api/mobile/v1/members/${e.id}/unfreeze`,{method:"POST"});n.ok?(i("Membership resumed!","success"),e=n.data?.data||n.data,c()):i(n.error?.message||"Failed to resume membership","error")}),s.querySelector("#btn-send-reminder")?.addEventListener("click",async()=>{const t=await d("/api/mobile/v1/whatsapp/send-reminder",{method:"POST",body:{member_id:e.id}});i(t.ok?"Reminder sent!":t.error.message,t.ok?"success":"error")}),s.querySelector("#btn-deactivate")?.addEventListener("click",async()=>{if(!await y({title:"Deactivate Member",message:`Are you sure you want to deactivate ${e.full_name}?`,confirmText:"Deactivate",destructive:!0}))return;const n=await d(`/api/mobile/v1/members/${e.id}/deactivate`,{method:"POST"});n.ok?(i("Member deactivated","success"),b.pop()):i(n.error.message,"error")})};e?c():s.innerHTML='<div style="padding:48px;text-align:center">Loading member details…</div>';const g=await d(`/api/mobile/v1/members/${f}`);if(g.ok)e=g.data,c();else if(!e){s.innerHTML=S(g.error?.message||"Member not found");return}const E=u=>{u?.detail&&String(u.detail.id)===String(f)&&(e=u.detail,c())};window.addEventListener("member-updated",E)}};export{R as default};
