import{u as S,f as d,G as M,H as T,a as A,B as I,g as b,i as r,C as B,I as a,J as w,F as C,b as L,n as p,s as i,E as v,p as k,K as q}from"./index-l_15Hr7r.js";const D={async mount(n,u){let e=null;try{u?.member&&(e=typeof u.member=="string"?JSON.parse(u.member):u.member)}catch{e=null}const f=e?.id||u?.memberId;if(!f){n.innerHTML=S("Member not found");return}const c=()=>{const m=M(e),$=q(m),x=T(e.days_until_expiry);n.innerHTML=`
        ${A({title:"Member",showBack:!0,actions:[{icon:"edit",label:"Edit"}]})}
        <div class="scroll-view">
          <div class="scroll-content">
            <!-- Profile Card -->
            <div style="padding:var(--sp-xxl);text-align:center;background:var(--card);border-bottom:1px solid var(--border-light)">
              <div style="display:inline-flex">${I(e.full_name,"xl")}</div>
              <h2 style="font-size:var(--fs-3xl);margin-top:var(--sp-md);margin-bottom:var(--sp-xs)">${b(e.full_name)}</h2>
              <div style="color:var(--text-secondary);font-size:var(--fs-base);margin-bottom:var(--sp-xs)">${b(e.phone)}</div>
              ${e.address?`
                <div style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:var(--sp-sm);display:flex;align-items:center;justify-content:center;gap:6px">
                  ${r("location",16,"var(--brand)")} <span>${b(e.address)}</span>
                </div>
              `:`
                <div style="color:var(--muted);font-size:var(--fs-xs);margin-bottom:var(--sp-sm)">No address recorded</div>
              `}
              ${B(m)}
              ${x?`<div style="margin-top:var(--sp-sm);font-size:var(--fs-sm);color:${$.text}">${b(x)}</div>`:""}
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
                ${e.is_inside&&e.last_entry_at?a("Entered At",C(e.last_entry_at)):""}
                ${a("WhatsApp",e.whatsapp_opted_in?"Opted In":"Not opted in")}
                ${a("Biometric",e.has_biometric?`Enrolled (ID #${b(e.device_enroll_number||"Enrolled")})`:"Not enrolled")}
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
                  ${a("Machine Enroll ID",`<b style="font-size:var(--fs-lg);color:var(--brand)">#${b(e.device_enroll_number||"Enrolled")}</b>`)}
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
                ${r("lock",18)} <span id="btn-toggle-access-label">Block Biometric Access</span>
              </button>
              ${e.status!=="deleted"?`
                <button class="btn btn-danger btn-full btn-sm" id="btn-deactivate" style="margin-top:var(--sp-md)">
                  ${r("delete",16,"white")} Deactivate Member
                </button>
              `:""}
            </div>
          </div>
        </div>`;const g=()=>p.push("edit-member",{memberId:String(e.id)});L(n,{onBack:()=>p.pop(),actions:[{onClick:g}]}),n.querySelector("#btn-edit-member")?.addEventListener("click",g),n.querySelector("#btn-edit-contact")?.addEventListener("click",g),n.querySelector("#btn-checkin")?.addEventListener("click",async()=>{const t=n.querySelector("#btn-checkin"),s=e.is_inside;t.disabled=!0,t.textContent=s?"Checking out...":"Checking in...";const o=await d("/api/mobile/v1/access/checkin",{method:"POST",body:{member_id:e.id,type:s?"EXIT":"ENTRY"}});o.ok?(e.is_inside=!s,i(o.data?.message||(s?`${e.full_name} checked out`:`${e.full_name} checked in!`),"success"),c()):(i(o.error?.message||"Action failed","error"),t.disabled=!1,t.innerHTML=e.is_inside?`${r("back",18)} Check Out Member`:`${r("access",18,"white")} Check In Member (Attendance)`)});const _=async()=>{const t=await k({title:"Enroll Number",message:`Enter machine Enroll Number (User ID) for ${e.full_name}:`,placeholder:"e.g. 101",defaultValue:e.device_enroll_number||"",inputType:"text",confirmText:"Save"});if(t===null)return;const s=t.trim();if(!s){i("Please enter an enroll number","error");return}const o=await d(`/api/mobile/v1/members/${e.id}/enroll`,{method:"POST",body:{enroll_number:s}});o.ok?(i(`Biometric ID #${s} saved & synchronized!`,"success"),e.has_biometric=!0,e.device_enroll_number=s,c()):i(o.error?.message||"Enrollment failed","error")};n.querySelector("#btn-enroll-bio")?.addEventListener("click",_),n.querySelector("#btn-change-enroll")?.addEventListener("click",_),n.querySelector("#btn-unenroll-bio")?.addEventListener("click",async()=>{if(!await v({title:"Remove Biometric Enrollment?",message:`This will unassign device ID #${e.device_enroll_number} and block terminal access for ${e.full_name}.`,confirmText:"Unenroll",destructive:!0}))return;const s=await d(`/api/mobile/v1/members/${e.id}/unenroll`,{method:"POST"});s.ok?(i("Biometric enrollment removed","success"),e.has_biometric=!1,e.device_enroll_number=null,c()):i(s.error?.message||"Failed to unenroll","error")}),n.querySelector("#btn-renew")?.addEventListener("click",()=>p.push("renew-member",{member:JSON.stringify(e)})),n.querySelector("#btn-record-payment")?.addEventListener("click",()=>p.push("record-payment",{memberId:String(e.id)}));let h=!1;n.querySelector("#btn-toggle-access")?.addEventListener("click",async()=>{const t=h?"unblock":"block";if(!await v({title:t==="block"?"Block Biometric Access":"Unblock Biometric Access",message:t==="block"?`${e.full_name} will not be able to enter with their fingerprint until unblocked.`:`${e.full_name} will be able to enter with their fingerprint again.`,confirmText:t==="block"?"Block Access":"Unblock Access",destructive:t==="block"}))return;const o=n.querySelector("#btn-toggle-access");o.disabled=!0;const l=await d(`/api/mobile/v1/rrr/members/${e.id}/access`,{method:"POST",body:{action:t}});o.disabled=!1,l.ok?(h=t==="block",n.querySelector("#btn-toggle-access-label").textContent=h?"Unblock Biometric Access":"Block Biometric Access",i(l.data?.command?"Command queued — the terminal applies it on its next check-in.":`${t==="block"?"Blocked":"Unblocked"}.`,"success")):i(l.error?.message||`Could not ${t} access`,"error")}),n.querySelector("#btn-freeze")?.addEventListener("click",async()=>{const t=await k({title:"Pause Membership",message:`How many days would you like to pause ${e.full_name}'s membership?`,placeholder:"e.g. 7, 14, 30",defaultValue:"14",inputType:"number",confirmText:"Continue"});if(!t)return;const s=parseInt(t,10);if(isNaN(s)||s<1){i("Invalid number of days","error");return}const o=await k({title:"Pause Reason",message:"Reason for pause (optional):",placeholder:"e.g. Travel, Injury",defaultValue:"",confirmText:"Pause Membership"})||"",l=await d(`/api/mobile/v1/members/${e.id}/freeze`,{method:"POST",body:{days:s,reason:o}});l.ok?(i(l.data?.message||"Membership paused successfully","success"),e=l.data?.data||l.data,c()):i(l.error?.message||"Failed to pause membership","error")}),n.querySelector("#btn-unfreeze")?.addEventListener("click",async()=>{if(!await v({title:"Resume Membership",message:`Resume ${e.full_name}'s membership and restore biometric access?`,confirmText:"Resume"}))return;const s=await d(`/api/mobile/v1/members/${e.id}/unfreeze`,{method:"POST"});s.ok?(i("Membership resumed!","success"),e=s.data?.data||s.data,c()):i(s.error?.message||"Failed to resume membership","error")}),n.querySelector("#btn-send-reminder")?.addEventListener("click",async()=>{const t=await d("/api/mobile/v1/whatsapp/send-reminder",{method:"POST",body:{member_id:e.id}});i(t.ok?"Reminder sent!":t.error.message,t.ok?"success":"error")}),n.querySelector("#btn-deactivate")?.addEventListener("click",async()=>{if(!await v({title:"Deactivate Member",message:`Are you sure you want to deactivate ${e.full_name}?`,confirmText:"Deactivate",destructive:!0}))return;const s=await d(`/api/mobile/v1/members/${e.id}/deactivate`,{method:"POST"});s.ok?(i("Member deactivated","success"),p.pop()):i(s.error.message,"error")})};e?c():n.innerHTML='<div style="padding:48px;text-align:center">Loading member details…</div>';const y=await d(`/api/mobile/v1/members/${f}`);if(y.ok)e=y.data,c();else if(!e){n.innerHTML=S(y.error?.message||"Member not found");return}const E=m=>{m?.detail&&String(m.detail.id)===String(f)&&(e=m.detail,c())};window.addEventListener("member-updated",E)}};export{D as default};
