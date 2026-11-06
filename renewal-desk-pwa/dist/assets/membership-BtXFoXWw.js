import{f as c,a as p,u as v,b as y,n as f,g as _,K as t,t as d,j as g,o as u}from"./index-BZNT0j-X.js";const b={async mount(s){await l(s),c(s,()=>l(s,!0))}};async function l(s,n=!1){n||(s.innerHTML=`${p({title:"Membership",showBack:!0})}<div class="scroll-view" id="mm-scroll">${v()}</div>`),n||y(s,{onBack:()=>f.pop()});const i=await _("/api/member/v1/membership");if(s.dataset.screenDisposed==="true"||n&&!i.ok)return;const m=s.querySelector("#mm-scroll"),o=i.ok?i.data:{},e=o.membership||o,a={...e,start_date:e.membership_start||e.start_date,end_date:e.membership_end||e.end_date,days_remaining:e.days_left??e.days_remaining};m.innerHTML=`<div class="scroll-content">
    <div style="padding:var(--sp-lg)"><div class="card card-body">
      <h3 style="margin-bottom:var(--sp-lg)">Current Plan</h3>
      ${t("Plan",a.plan_name||"—")}
      ${t("Status",a.status||"—")}
      ${t("Start Date",d(a.start_date))}
      ${t("End Date",d(a.end_date))}
      ${a.days_remaining!=null?t("Days Left",String(a.days_remaining)):""}
    </div></div>
    ${a.history&&a.history.length?`<div style="padding:0 var(--sp-lg) var(--sp-lg)"><div class="card card-body">
      <h3 style="margin-bottom:var(--sp-lg)">Renewal History</h3>
      ${a.history.map(r=>`<div class="info-row"><span class="info-row-label">${d(r.renewed_on||r.start_date)}</span><span class="info-row-value">${g(r.plan_name||"—")} — ${u(r.amount||"0")}</span></div>`).join("")}
    </div></div>`:""}
  </div>`}export{b as default};
