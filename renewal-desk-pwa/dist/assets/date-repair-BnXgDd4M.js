import{a as d,b as p,n as c,f as h,s as m,E as b,g as u}from"./index-BO2OANjy.js";const r=u,g=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];function y(a){if(!a)return"—";const[n,s,t]=a.split("-").map(Number);return`${t} ${g[(s||1)-1]} ${n}`}const $={ledger_mismatch:"End date changed outside a payment/renewal",span_mismatch:"Span longer than the plan, no renewal history",oversized_renewal:"A renewal applied more days than the plan allows"},_={async mount(a){const n=async()=>{a.innerHTML=`${d({title:"Date Repair",showBack:!0})}<div class="scroll-view"><div class="scroll-content"><p style="color:var(--muted)">Scanning member dates…</p></div></div>`,p(a,{onBack:()=>c.pop()});const s=await h("/api/mobile/v1/date-repair/scan");if(!s.ok){a.innerHTML=`${d({title:"Date Repair",showBack:!0})}<div class="scroll-view"><div class="scroll-content"><div class="empty-state"><div class="empty-state-title">Could not run the scan</div><p>${r(s.error?.message||"Owner access required.")}</p></div></div></div>`,p(a,{onBack:()=>c.pop()});return}const t=s.data.flagged||[];a.innerHTML=`
        ${d({title:"Date Repair",showBack:!0})}
        <div class="scroll-view"><div class="scroll-content" style="display:flex;flex-direction:column;gap:var(--sp-md)">
          <div class="card card-body">
            <p style="margin:0">Members whose <b>end date</b> doesn't match their plan and payment history. Review each one — nothing changes until you tap Apply.</p>
          </div>
          ${t.length===0?`
            <div class="empty-state"><div class="empty-state-title">All dates look correct</div><p>No members need repair right now.</p></div>
          `:`
            <p style="margin:0;color:var(--muted)">${t.length} member${t.length===1?"":"s"} flagged</p>
            ${t.map(e=>`
              <label class="card card-body" style="display:flex;gap:var(--sp-md);cursor:pointer">
                <input type="checkbox" class="dr-check" value="${e.member_id}" ${e.confidence==="high"?"checked":""} style="width:22px;height:22px;flex-shrink:0;margin-top:2px">
                <span style="flex:1;min-width:0">
                  <b>${r(e.full_name)}</b> <span style="color:var(--muted)">· ${r(e.plan_name)} (${e.plan_duration_days}d)</span><br>
                  <span>Now: ${y(e.membership_start)} → <b>${y(e.membership_end)}</b> (${e.span_days} days)</span><br>
                  <span>Should be: → <b>${y(e.proposed_end)}</b></span><br>
                  <span style="color:var(--muted);font-size:var(--fs-sm)">${r($[e.classification]||e.classification)}. ${r(e.reason)}</span><br>
                  <span style="color:var(--muted);font-size:var(--fs-sm)">Verified payments: ${e.verified_payments} (₹${Number(e.verified_paid_total||0).toLocaleString("en-IN")}) · Renewals on record: ${e.ledger_periods}${e.freeze_events?` · Freezes: ${e.freeze_events} — verify before applying`:""}</span>
                </span>
              </label>
            `).join("")}
            <button class="btn btn-primary btn-lg btn-full" id="dr-apply">Apply Selected Repairs</button>
          `}
        </div></div>`,p(a,{onBack:()=>c.pop()}),a.querySelector("#dr-apply")?.addEventListener("click",async()=>{const e=[...a.querySelectorAll(".dr-check:checked")].map(l=>Number(l.value));if(!e.length){m("Select at least one member","error");return}if(!await b({title:"Apply date repairs?",message:`This will change the membership end date for ${e.length} member${e.length===1?"":"s"} to the corrected values shown. Payments and history are not changed.`,confirmText:"Apply"}))return;const i=a.querySelector("#dr-apply");i.disabled=!0,i.textContent="Applying…";const o=await h("/api/mobile/v1/date-repair/apply",{method:"POST",body:{member_ids:e}});if(o.ok){const l=(o.data.results||[]).filter(v=>v.applied).length;m(`Repaired ${l} member${l===1?"":"s"}`,"success"),n()}else m(o.error.message,"error"),i.disabled=!1,i.textContent="Apply Selected Repairs"})};await n()}};export{_ as default};
