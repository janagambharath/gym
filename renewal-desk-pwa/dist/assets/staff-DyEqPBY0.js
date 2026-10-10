import{f as v,a as x,u as w,z as b,g as l,A as y,i as f,b as h,n as k,s as m,C as g,r as p}from"./index-CekIYfVW.js";const S={async mount(a){let o=[],d=!1,t=null,r=null;async function u(){const e=await v("/api/mobile/v1/staff");o=e.ok?e.data.staff||[]:[],i()}function i(){a.innerHTML=`
        ${x({title:"Staff Management",showBack:!0,actions:[{icon:"add",label:"Add Staff"}]})}

        <div class="scroll-view">
          <div class="scroll-content" style="padding-bottom:calc(var(--tab-bar-height) + 24px)">
            ${o.length===0?w({icon:"staff",title:"No staff members yet",text:"Add trainers, managers, or receptionists to your team.",actionText:"+ Add First Staff",actionId:"btn-empty-add-staff"}):`
              <div style="padding:var(--sp-md) var(--sp-lg) var(--sp-xs)">
                <span style="font-size:var(--fs-xs);font-weight:var(--fw-bold);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">
                  Team Members (${o.length})
                </span>
              </div>
              <div class="card" style="margin:0 var(--sp-lg)">
                ${o.map(e=>`
                  <div class="list-item" data-staff-id="${e.id}" style="cursor:pointer;padding:var(--sp-md)">
                    <div style="display:flex;align-items:center;gap:var(--sp-md);flex:1">
                      ${b(e.full_name,44)}
                      <div class="list-item-content">
                        <div class="list-item-title" style="font-weight:var(--fw-semibold)">${l(e.full_name)}</div>
                        <div class="list-item-subtitle" style="display:flex;gap:var(--sp-sm);align-items:center">
                          <span>${l(e.email)}</span>
                        </div>
                      </div>
                    </div>
                    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:var(--sp-xs)">
                      ${y(e.role==="gym_owner"?"Owner":"Staff",e.role==="gym_owner"?"primary":"neutral")}
                      ${e.is_active?"":y("Inactive")}
                    </div>
                    <div style="color:var(--text-muted);margin-left:var(--sp-sm)">${f("forward",16)}</div>
                  </div>
                `).join("")}
              </div>
            `}
          </div>
        </div>

        ${d?`
          <div class="modal-backdrop" id="add-modal-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999;display:flex;align-items:flex-end;justify-content:center">
            <div class="card" style="width:100%;max-width:500px;border-radius:var(--r-2xl) var(--r-2xl) 0 0;padding:var(--sp-xl);max-height:85vh;overflow-y:auto;background:var(--surface)">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-lg)">
                <h3 style="margin:0;font-size:var(--fs-lg)">+ Add Staff Member</h3>
                <button type="button" class="btn btn-sm btn-secondary" id="btn-close-add" style="border:none;background:transparent">${f("close",20)}</button>
              </div>
              <form id="add-staff-form" style="display:flex;flex-direction:column;gap:var(--sp-md)">
                ${p({id:"st-name",label:"Full Name",placeholder:"e.g. Vikram Singh",required:!0})}
                ${p({id:"st-phone",label:"Mobile Number",placeholder:"+91 98765 43210",type:"tel"})}
                ${p({id:"st-email",label:"Email Address",placeholder:"vikram@example.com",type:"email",required:!0})}
                <div class="form-group">
                  <label class="form-label" style="display:block;margin-bottom:var(--sp-xs);font-size:var(--fs-sm);font-weight:var(--fw-medium)">Role</label>
                  <select id="st-role" class="form-control" style="width:100%;padding:var(--sp-md);border-radius:var(--r-md);border:1px solid var(--border);background:var(--surface)">
                    <option value="staff" selected>Staff (Desk / Trainer)</option>
                    <option value="gym_owner">Gym Co-Owner / Manager</option>
                  </select>
                </div>
                ${p({id:"st-pass",label:"Temporary Password (Optional)",placeholder:"Leave empty to auto-generate",type:"password"})}
                <div style="display:flex;gap:var(--sp-sm);margin-top:var(--sp-md)">
                  <button type="submit" class="btn btn-primary" style="flex:1" id="btn-save-staff">Create & Invite</button>
                  <button type="button" class="btn btn-secondary" id="btn-cancel-add">Cancel</button>
                </div>
              </form>
            </div>
          </div>
        `:""}

        ${r?`
          <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:1000;display:flex;align-items:center;justify-content:center;padding:var(--sp-lg)">
            <div class="card" style="width:100%;max-width:440px;padding:var(--sp-xl);text-align:center;background:var(--surface)">
              <div style="font-size:40px;margin-bottom:var(--sp-sm)">🎉</div>
              <h3 style="margin-bottom:var(--sp-xs)">Staff Account Created!</h3>
              <p style="color:var(--text-muted);font-size:var(--fs-sm);margin-bottom:var(--sp-lg)">
                ${l(r.full_name)} can now log into Renewal Desk.
              </p>
              <div style="background:var(--surface-subtle);border-radius:var(--r-md);padding:var(--sp-md);margin-bottom:var(--sp-lg);text-align:left;font-family:monospace">
                <div><strong>Email:</strong> ${l(r.email)}</div>
                <div><strong>Password:</strong> ${l(r.temp_password||"********")}</div>
              </div>
              <div style="display:flex;flex-direction:column;gap:var(--sp-sm)">
                ${r.invite_whatsapp_url?`
                  <a href="${r.invite_whatsapp_url}" target="_blank" class="btn btn-primary" style="background:#25D366;border-color:#25D366;display:flex;align-items:center;justify-content:center;gap:var(--sp-sm)">
                    ${f("whatsapp",18)} Share via WhatsApp
                  </a>
                `:""}
                <button type="button" class="btn btn-secondary" id="btn-dismiss-invite">Done</button>
              </div>
            </div>
          </div>
        `:""}

        ${t?`
          <div class="modal-backdrop" id="action-modal-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999;display:flex;align-items:flex-end;justify-content:center">
            <div class="card" style="width:100%;max-width:500px;border-radius:var(--r-2xl) var(--r-2xl) 0 0;padding:var(--sp-xl);background:var(--surface)">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-lg)">
                <div style="display:flex;align-items:center;gap:var(--sp-md)">
                  ${b(t.full_name,48)}
                  <div>
                    <h3 style="margin:0">${l(t.full_name)}</h3>
                    <div style="color:var(--text-muted);font-size:var(--fs-sm)">${l(t.email)} · ${t.role}</div>
                  </div>
                </div>
                <button type="button" class="btn btn-sm btn-secondary" id="btn-close-action" style="border:none;background:transparent">${f("close",20)}</button>
              </div>
              <div style="display:flex;flex-direction:column;gap:var(--sp-sm)">
                <button type="button" class="btn btn-secondary" id="btn-reset-staff-pass" style="display:flex;align-items:center;justify-content:center;gap:var(--sp-sm)">
                  ${f("lock",16)} Reset Password
                </button>
                <button type="button" class="btn btn-secondary" id="btn-toggle-staff-active" style="display:flex;align-items:center;justify-content:center;gap:var(--sp-sm)">
                  ${t.is_active?"Deactivate Account":"Activate Account"}
                </button>
                <button type="button" class="btn btn-secondary" id="btn-cancel-action" style="margin-top:var(--sp-sm)">Cancel</button>
              </div>
            </div>
          </div>
        `:""}
      `,h(a,{onBack:()=>k.pop(),actions:[{onClick:()=>{d=!0,i()}}]}),a.querySelector("#btn-empty-add-staff")?.addEventListener("click",()=>{d=!0,i()}),a.querySelectorAll("[data-staff-id]").forEach(e=>{e.addEventListener("click",()=>{const s=Number(e.dataset.staffId);t=o.find(c=>c.id===s)||null,i()})}),a.querySelector("#btn-close-add")?.addEventListener("click",()=>{d=!1,i()}),a.querySelector("#btn-cancel-add")?.addEventListener("click",()=>{d=!1,i()}),a.querySelector("#add-staff-form")?.addEventListener("submit",async e=>{e.preventDefault();const s=a.querySelector("#btn-save-staff");s&&(s.disabled=!0);const c={full_name:a.querySelector("#st-name")?.value.trim(),phone:a.querySelector("#st-phone")?.value.trim(),email:a.querySelector("#st-email")?.value.trim(),role:a.querySelector("#st-role")?.value,password:a.querySelector("#st-pass")?.value.trim()||void 0},n=await v("/api/mobile/v1/staff",{method:"POST",body:c});n.ok?(d=!1,r=n.data,m(`Staff account created for ${c.full_name}`,"success"),await u()):(m(n.error?.message||"Could not create staff account","error"),s&&(s.disabled=!1))}),a.querySelector("#btn-dismiss-invite")?.addEventListener("click",()=>{r=null,i()}),a.querySelector("#btn-close-action")?.addEventListener("click",()=>{t=null,i()}),a.querySelector("#btn-cancel-action")?.addEventListener("click",()=>{t=null,i()}),a.querySelector("#btn-toggle-staff-active")?.addEventListener("click",async()=>{if(!t)return;const e=!t.is_active,s=e?`Reactivate account for ${t.full_name}?`:`Deactivate ${t.full_name}? They will not be able to log in.`;if(await g({title:e?"Activate Staff":"Deactivate Staff",message:s,confirmText:e?"Activate":"Deactivate",destructive:!e})){const n=await v(`/api/mobile/v1/staff/${t.id}`,{method:"PATCH",body:{is_active:e}});n.ok?(m(n.data?.message||"Updated successfully","success"),t=null,await u()):m(n.error?.message||"Failed to update","error")}}),a.querySelector("#btn-reset-staff-pass")?.addEventListener("click",async()=>{if(!t)return;if(await g({title:"Reset Password",message:`Generate a new password for ${t.full_name}?`,confirmText:"Reset Password"})){const s=await v(`/api/mobile/v1/staff/${t.id}/reset-password`,{method:"POST"});s.ok?(r={full_name:t.full_name,email:t.email,temp_password:s.data.new_password,invite_whatsapp_url:s.data.invite_whatsapp_url},t=null,i()):m(s.error?.message||"Failed to reset password","error")}})}await u()}};export{S as default};
