import{k as P,J as F,a as O,i as o,e as H,t as z,w as C,b as j,s as x,n as D,p as G,j as R}from"./index-1Q0YpctZ.js";function J(e){if(!e)return"+91";const t=e.toLowerCase();return t.startsWith("asia/kolkata")||t.startsWith("asia/calcutta")||t==="ist"?"+91":t.startsWith("america/")?"+1":t.startsWith("europe/london")?"+44":t.startsWith("asia/dubai")?"+971":t.startsWith("asia/singapore")?"+65":"+91"}function S(e,t){if(!e)return"";const d=new Date(e);if(isNaN(d.getTime()))return"";const r=Number(t)||30;return new Date(d.getTime()+r*864e5).toISOString().split("T")[0]}const K={async mount(e){const t=R(),d=J(t?.gymTimezone);let r=[];try{const a=await P("/api/mobile/v1/settings");a.ok&&a.data?.plans&&(r=a.data.plans)}catch(a){console.error("Failed to load plans:",a)}let n=r.length>0?r[0].id:null,m=F(),A=S(m,r.find(a=>a.id===n)?.duration_days||30);e.innerHTML=`
      ${O({title:"Add Member",showBack:!0})}
      <div class="scroll-view">
        <div class="scroll-content" style="padding:var(--sp-lg);gap:var(--sp-lg);display:flex;flex-direction:column;max-width:640px;margin:0 auto;width:100%">

          <!-- Error Alert Banner -->
          <div id="am-error-banner" class="form-error-banner" style="display:none">
            <span style="flex-shrink:0">${o("alert",18,"var(--critical)")}</span>
            <span id="am-error-message" style="flex:1"></span>
          </div>

          <form id="am-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">

            <!-- Member Information Card -->
            <div class="form-section-card">
              <div class="form-section-title">
                ${o("person",20,"var(--brand)")}
                <span>Member Information</span>
              </div>
              <div class="form-section-sub">Basic contact details for the member</div>

              <div class="form-group" style="margin-top:var(--sp-xs)">
                <label class="form-label" for="am-fullname">Full Name *</label>
                <input class="form-input" id="am-fullname" type="text" placeholder="e.g. Rahul Sharma" autocomplete="off" required>
                <span class="field-error-text" id="am-fullname-error">Name is required.</span>
              </div>

              <div class="form-group">
                <label class="form-label" for="am-phone">Phone Number *</label>
                <input class="form-input" id="am-phone" type="tel" value="${d} " placeholder="${d} 9876543210" autocomplete="off" required>
                <span class="field-error-text" id="am-phone-error">Phone number is required (min 10 digits).</span>
              </div>

              <div class="form-group">
                <label class="form-label" for="am-email">Email Address <span style="font-weight:normal;color:var(--text-secondary)">(optional)</span></label>
                <input class="form-input" id="am-email" type="email" placeholder="e.g. rahul@example.com" autocomplete="off">
              </div>

              <div class="form-group">
                <label class="form-label" for="am-gender">Gender <span style="font-weight:normal;color:var(--text-secondary)">(optional)</span></label>
                <select class="form-input" id="am-gender">
                  <option value="">Select gender...</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            <!-- Membership Plan Card -->
            <div class="form-section-card">
              <div class="form-section-title">
                ${o("star",20,"var(--brand)")}
                <span>Membership Plan</span>
              </div>
              <div class="form-section-sub">Select duration and plan terms</div>

              ${r.length>0?`
                <div class="plan-selector-grid" id="am-plan-grid">
                  ${r.map(a=>`
                    <div class="plan-selector-card ${a.id===n?"selected":""}" data-plan-id="${a.id}" data-duration="${a.duration_days}">
                      <div class="plan-card-check">${o("check",16)}</div>
                      <div class="plan-card-name">${H(a.name)}</div>
                      <div class="plan-card-meta">${a.duration_days} Days</div>
                      <div class="plan-card-price">${z(a.price)}</div>
                    </div>
                  `).join("")}
                </div>
              `:`
                <div style="font-size:var(--fs-sm);color:var(--text-secondary);padding:var(--sp-sm) 0">
                  No plans configured. You can still set start date.
                </div>
              `}

              <div class="form-group" style="margin-top:var(--sp-sm)">
                <label class="form-label" for="am-start">Start Date</label>
                <input class="form-input" id="am-start" type="date" value="${m}">
              </div>

              <!-- Calculated Expiry Box -->
              <div class="calculated-expiry-box" id="am-expiry-preview">
                <span style="flex-shrink:0">${o("calendar",18,"var(--brand)")}</span>
                <span id="am-expiry-text">
                  Expires on: <strong>${C(A)}</strong> (${r.find(a=>a.id===n)?.duration_days||30} days)
                </span>
              </div>
            </div>

            <!-- Notes Card -->
            <div class="form-section-card">
              <div class="form-section-title">
                ${o("edit",20,"var(--brand)")}
                <span>Additional Notes</span>
              </div>
              <div class="form-group" style="margin-top:var(--sp-xs)">
                <textarea class="form-input" id="am-notes" rows="3" placeholder="Fitness goals, medical conditions, referrals, etc. (optional)"></textarea>
              </div>
            </div>

            <!-- Submit Button -->
            <button type="submit" class="btn btn-primary btn-lg btn-full" id="am-submit" style="display:flex;align-items:center;justify-content:center;gap:var(--sp-sm);margin-top:var(--sp-sm);height:50px;font-size:var(--fs-base)">
              ${o("personAdd",20,"white")}
              <span id="am-btn-label">Add Member</span>
            </button>

          </form>
        </div>
      </div>
    `,j(e,{onBack:()=>D.pop()});const y=e.querySelector("#am-plan-grid"),$=()=>{const a=r.find(f=>f.id===n),s=a?a.duration_days:30,i=e.querySelector("#am-start").value||m,p=S(i,s),u=e.querySelector("#am-expiry-text");return u&&(u.innerHTML=`Expires on: <strong>${C(p)}</strong> (${s} days)`),p};y&&y.addEventListener("click",a=>{const s=a.target.closest(".plan-selector-card");s&&(y.querySelectorAll(".plan-selector-card").forEach(i=>i.classList.remove("selected")),s.classList.add("selected"),n=Number(s.dataset.planId),$())}),e.querySelector("#am-start").addEventListener("change",$);const q=e.querySelector("#am-fullname"),w=e.querySelector("#am-phone"),E=e.querySelector("#am-fullname-error"),L=e.querySelector("#am-phone-error"),c=e.querySelector("#am-error-banner"),M=e.querySelector("#am-error-message");q.addEventListener("input",()=>{E.classList.remove("visible"),c.style.display="none"}),w.addEventListener("input",()=>{L.classList.remove("visible"),c.style.display="none"}),e.querySelector("#am-form").addEventListener("submit",async a=>{a.preventDefault();const s=q.value.trim(),i=w.value.trim(),p=e.querySelector("#am-email").value.trim(),u=e.querySelector("#am-gender").value,f=e.querySelector("#am-start").value||m,_=e.querySelector("#am-notes").value.trim();let b=!1;s||(E.classList.add("visible"),b=!0);const v=i.replace(/\D/g,"");if((!i||v.length<10)&&(L.classList.add("visible"),b=!0),b)return;const g=e.querySelector("#am-submit"),h=e.querySelector("#am-btn-label");g.disabled=!0,h.textContent="Adding Member...",c.style.display="none";const T=i.startsWith("+")?i:v.length===10?`${d}${v}`:`+${v}`,N=r.find(l=>l.id===n),B=N?N.duration_days:30,I=S(f,B),W={full_name:s,name:s,phone:T,email:p||null,gender:u||null,plan_id:n?Number(n):null,membership_start:f,membership_end:I,notes:_||null};try{const l=await P("/api/mobile/v1/members",{method:"POST",body:W});if(l.ok)x("Member added successfully!","success"),D.replace("member-detail",{member:JSON.stringify(l.data)});else{if(l.error?.status===401){G();return}const k=l.error?.message||"Failed to add member. Please try again.";M.textContent=k,c.style.display="flex",x(k,"error"),g.disabled=!1,h.textContent="Add Member"}}catch(l){M.textContent=l.message||"An unexpected network error occurred.",c.style.display="flex",x("Network error","error"),g.disabled=!1,h.textContent="Add Member"}})}};export{K as default};
