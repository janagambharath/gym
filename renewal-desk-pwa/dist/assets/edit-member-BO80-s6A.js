import{f as c,a as x,r as l,b as C,s as p,n as S,t as D}from"./index-EEeWOYOa.js";const E={async mount(e,g){const v=g?.memberId,b=await c(`/api/mobile/v1/members/${v}`);if(!b.ok){e.innerHTML='<div class="empty-state"><div class="empty-state-title">Member not found</div></div>';return}const r=b.data,y=await c("/api/mobile/v1/settings"),f=y.ok?y.data.plans||[]:[];e.innerHTML=`
      ${x({title:"Edit Member",showBack:!0})}
      <div class="scroll-view"><div class="scroll-content form-scroll-content">
        <form id="edit-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
          ${l({id:"em-name",label:"Full Name",value:r.full_name,required:!0})}
          ${l({id:"em-phone",label:"Phone",type:"tel",value:r.phone,required:!0})}
          ${l({id:"em-email",label:"Email",type:"email",value:r.email||""})}
          ${l({id:"em-gender",label:"Gender",value:r.gender||"",options:[{value:"Male",label:"Male"},{value:"Female",label:"Female"},{value:"Other",label:"Other"}]})}
          ${l({id:"em-address",label:"Address",type:"textarea",value:r.address||""})}
          ${l({id:"em-plan",label:"Plan",value:r.plan?.id||"",options:f.map(s=>({value:s.id,label:s.name}))})}
          ${l({id:"em-start",label:"Start Date",type:"date",value:r.membership_start||""})}
          <div class="form-group">
            <label class="form-label">End Date (auto-calculated)</label>
            <div id="em-end-display" class="form-input" style="background:var(--bg-muted,#f1f5f9);color:var(--muted);">—</div>
            <span class="form-hint">Calculated from Plan + Start Date. To grant extra days, use the owner override.</span>
          </div>
          ${l({id:"em-notes",label:"Notes",type:"textarea",value:r.notes||""})}
          <button type="submit" class="btn btn-primary btn-lg btn-full" id="em-submit">Save Changes</button>
        </form>
      </div></div>`,C(e,{onBack:()=>S.pop()});const m=()=>{const s=e.querySelector("#em-plan")?.value?Number(e.querySelector("#em-plan").value):null,t=e.querySelector("#em-start")?.value||null,a=e.querySelector("#em-end-display");if(!s||!t)return a&&(a.textContent="—"),null;const u=f.find($=>$.id===s);if(!u?.duration_days)return a&&(a.textContent="—"),null;const n=new Date(t);n.setDate(n.getDate()+Number(u.duration_days)-1);const o=n.toISOString().slice(0,10),[i,d,h]=o.split("-").map(Number),q=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];return a&&(a.textContent=`${h} ${q[d-1]} ${i}`),o};e.querySelector("#em-plan")?.addEventListener("change",m),e.querySelector("#em-start")?.addEventListener("change",m),m(),e.querySelector("#edit-form").addEventListener("submit",async s=>{s.preventDefault();const t=e.querySelector("#em-submit");t.disabled=!0,t.textContent="Saving...";const a=e.querySelector("#em-name").value.trim(),u=e.querySelector("#em-phone").value.trim(),n=e.querySelector("#em-start").value||null,o=m();if(n&&o&&o<n){p("End date cannot be before start date","error"),t.disabled=!1,t.textContent="Save Changes";return}const i={full_name:a,name:a,phone:u,email:e.querySelector("#em-email").value.trim()||null,gender:e.querySelector("#em-gender").value||null,plan_id:e.querySelector("#em-plan").value?Number(e.querySelector("#em-plan").value):null,notes:e.querySelector("#em-notes").value.trim()||null,address:e.querySelector("#em-address").value.trim()||null};n&&(i.membership_start=n),o&&(i.membership_end=o);const d=await c(`/api/mobile/v1/members/${v}`,{method:"PATCH",body:i});if(d.ok)p("Saved!","success"),window.dispatchEvent(new CustomEvent("member-updated",{detail:d.data})),S.pop();else{if(d.error?.status===401){D();return}p(d.error.message,"error"),t.disabled=!1,t.textContent="Save Changes"}})}};export{E as default};
