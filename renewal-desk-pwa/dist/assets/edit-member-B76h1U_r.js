import{g as c,a as x,r as l,b as D,n as p,s as v,v as C}from"./index-B1po66HU.js";const w={async mount(e,h){const b=h?.memberId,y=await c(`/api/mobile/v1/members/${b}`);if(!y.ok){e.innerHTML='<div class="empty-state"><div class="empty-state-title">Member not found</div></div>';return}const n=y.data,f=await c("/api/mobile/v1/settings"),S=f.ok?f.data.plans||[]:[];e.innerHTML=`
      ${x({title:"Edit Member",showBack:!0})}
      <div class="scroll-view"><div class="scroll-content form-scroll-content">
        <form id="edit-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
          ${l({id:"em-name",label:"Full Name",value:n.full_name,required:!0})}
          ${l({id:"em-phone",label:"Phone",type:"tel",value:n.phone,required:!0})}
          ${l({id:"em-email",label:"Email",type:"email",value:n.email||""})}
          ${l({id:"em-gender",label:"Gender",value:n.gender||"",options:[{value:"Male",label:"Male"},{value:"Female",label:"Female"},{value:"Other",label:"Other"}]})}
          ${l({id:"em-address",label:"Address",type:"textarea",value:n.address||""})}
          ${l({id:"em-plan",label:"Plan",value:n.plan?.id||"",options:S.map(s=>({value:s.id,label:s.name}))})}
          ${l({id:"em-start",label:"Start Date",type:"date",value:n.membership_start||""})}
          <div class="form-group">
            <label class="form-label">End Date (auto-calculated)</label>
            <div id="em-end-display" class="form-input" style="background:var(--bg-muted,#f1f5f9);color:var(--muted);">—</div>
            <span class="form-hint">Calculated from Plan + Start Date. If dates don't match payments, fix them in <button type="button" id="em-date-repair" style="color:var(--brand);text-decoration:underline;padding:0">Date Repair</button>.</span>
          </div>
          ${l({id:"em-notes",label:"Notes",type:"textarea",value:n.notes||""})}
          <button type="submit" class="btn btn-primary btn-lg btn-full" id="em-submit">Save Changes</button>
        </form>
      </div></div>`,D(e,{onBack:()=>p.pop()}),e.querySelector("#em-date-repair")?.addEventListener("click",()=>p.push("date-repair"));const m=()=>{const s=e.querySelector("#em-plan")?.value?Number(e.querySelector("#em-plan").value):null,t=e.querySelector("#em-start")?.value||null,a=e.querySelector("#em-end-display");if(!s||!t)return a&&(a.textContent="—"),null;const u=S.find($=>$.id===s);if(!u?.duration_days)return a&&(a.textContent="—"),null;const r=new Date(t);r.setDate(r.getDate()+Number(u.duration_days)-1);const o=r.toISOString().slice(0,10),[i,d,g]=o.split("-").map(Number),q=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];return a&&(a.textContent=`${g} ${q[d-1]} ${i}`),o};e.querySelector("#em-plan")?.addEventListener("change",m),e.querySelector("#em-start")?.addEventListener("change",m),m(),e.querySelector("#edit-form").addEventListener("submit",async s=>{s.preventDefault();const t=e.querySelector("#em-submit");t.disabled=!0,t.textContent="Saving...";const a=e.querySelector("#em-name").value.trim(),u=e.querySelector("#em-phone").value.trim(),r=e.querySelector("#em-start").value||null,o=m();if(r&&o&&o<r){v("End date cannot be before start date","error"),t.disabled=!1,t.textContent="Save Changes";return}const i={full_name:a,name:a,phone:u,email:e.querySelector("#em-email").value.trim()||null,gender:e.querySelector("#em-gender").value||null,plan_id:e.querySelector("#em-plan").value?Number(e.querySelector("#em-plan").value):null,notes:e.querySelector("#em-notes").value.trim()||null,address:e.querySelector("#em-address").value.trim()||null};r&&(i.membership_start=r),o&&(i.membership_end=o);const d=await c(`/api/mobile/v1/members/${b}`,{method:"PATCH",body:i});if(d.ok)v("Saved!","success"),window.dispatchEvent(new CustomEvent("member-updated",{detail:d.data})),p.pop();else{if(d.error?.status===401){C();return}v(d.error.message,"error"),t.disabled=!1,t.textContent="Save Changes"}})}};export{w as default};
