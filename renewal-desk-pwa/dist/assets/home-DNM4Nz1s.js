import{k as o,a as d,e as r,C as c,J as m,D as e,i as v,n as l}from"./index-DcA9rnoc.js";const b={async mount(s){const i=await o("/api/member/v1/home"),n=i.ok?i.data:{},a=n.membership||{};s.innerHTML=`${d({title:"My Gym"})}
    <div class="scroll-view"><div class="scroll-content">
      <div style="padding:var(--sp-xxl);text-align:center;background:linear-gradient(135deg,var(--brand),var(--brand-dark));color:white;border-radius:0 0 var(--r-xxl) var(--r-xxl)">
        <h2 style="color:white;margin-bottom:var(--sp-sm)">${r(n.member_name||"Member")}</h2>
        <div style="font-size:var(--fs-sm);opacity:0.9;margin-bottom:var(--sp-lg)">${r(n.gym_name||"")}</div>
        <div style="font-size:var(--fs-6xl);font-weight:var(--fw-extrabold)">${a.days_remaining!=null?a.days_remaining:"—"}</div>
        <div style="font-size:var(--fs-sm);opacity:0.8">days remaining</div>
        ${a.status?`<div style="margin-top:var(--sp-md)">${c(a.status)}</div>`:""}
      </div>
      <div style="padding:var(--sp-lg)"><div class="card card-body">
        <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Membership</div>
        <div class="info-row"><span class="info-row-label">Plan</span><span class="info-row-value">${r(a.plan_name||"—")}</span></div>
        <div class="info-row"><span class="info-row-label">Valid Until</span><span class="info-row-value">${m(a.end_date)}</span></div>
      </div></div>
      <div class="card" style="margin:0 var(--sp-lg) var(--sp-lg)">
        ${e({iconName:"person",label:"My Profile",onClick:"member-profile",iconBg:"var(--brand-subtle)",iconColor:"var(--brand)"})}
        ${e({iconName:"calendar",label:"Membership",onClick:"member-membership",iconBg:"var(--success-surface)",iconColor:"var(--success)"})}
        ${e({iconName:"wallet",label:"Payments",onClick:"member-payments",iconBg:"var(--status-pending-surface)",iconColor:"var(--status-pending)"})}
        ${e({iconName:"access",label:"Attendance",onClick:"member-access",iconBg:"#fce7f3",iconColor:"#db2777"})}
      </div>
      ${a.days_remaining!=null&&a.days_remaining<=7?`<div style="padding:0 var(--sp-lg) var(--sp-lg)">
        <button class="btn btn-primary btn-lg btn-full" id="mh-renew">${v("renewals",18,"white")} Renew Now</button>
      </div>`:""}
    </div></div>`,s.querySelectorAll("[data-action]").forEach(t=>t.addEventListener("click",()=>l.push(t.dataset.action))),s.querySelector("#mh-renew")?.addEventListener("click",()=>l.push("member-renew"))}};export{b as default};
