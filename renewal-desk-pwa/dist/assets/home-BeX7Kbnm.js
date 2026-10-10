import{f as m,a as c,g as i,B as v,J as p,C as n,i as b,n as d}from"./index-0beHVmet.js";const y={async mount(s){const t=await m("/api/member/v1/dashboard"),l=t.ok?t.data:{},e=l.member||{},r={member_name:e.full_name,gym_name:l.gym?.name,membership:{days_remaining:e.days_left,status:e.status,plan_name:e.plan_name,end_date:e.membership_end}},a=r.membership||{};s.innerHTML=`${c({title:"My Gym"})}
    <div class="scroll-view"><div class="scroll-content">
      <div style="padding:var(--sp-xxl);text-align:center;background:linear-gradient(135deg,var(--brand),var(--brand-dark));color:white;border-radius:0 0 var(--r-xxl) var(--r-xxl)">
        <h2 style="color:white;margin-bottom:var(--sp-sm)">${i(r.member_name||"Member")}</h2>
        <div style="font-size:var(--fs-sm);opacity:0.9;margin-bottom:var(--sp-lg)">${i(r.gym_name||"")}</div>
        <div style="font-size:var(--fs-6xl);font-weight:var(--fw-extrabold)">${a.days_remaining!=null?a.days_remaining:"—"}</div>
        <div style="font-size:var(--fs-sm);opacity:0.8">days remaining</div>
        ${a.status?`<div style="margin-top:var(--sp-md)">${v(a.status)}</div>`:""}
      </div>
      <div style="padding:var(--sp-lg)"><div class="card card-body">
        <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Membership</div>
        <div class="info-row"><span class="info-row-label">Plan</span><span class="info-row-value">${i(a.plan_name||"—")}</span></div>
        <div class="info-row"><span class="info-row-label">Valid Until</span><span class="info-row-value">${p(a.end_date)}</span></div>
      </div></div>
      <div class="card" style="margin:0 var(--sp-lg) var(--sp-lg)">
        ${n({iconName:"person",label:"My Profile",onClick:"member-profile",iconBg:"var(--brand-subtle)",iconColor:"var(--brand)"})}
        ${n({iconName:"calendar",label:"Membership",onClick:"member-membership",iconBg:"var(--success-surface)",iconColor:"var(--success)"})}
        ${n({iconName:"wallet",label:"Payments",onClick:"member-payments",iconBg:"var(--status-pending-surface)",iconColor:"var(--status-pending)"})}
        ${n({iconName:"access",label:"Attendance",onClick:"member-access",iconBg:"#fce7f3",iconColor:"#db2777"})}
      </div>
      ${a.days_remaining!=null&&a.days_remaining<=7?`<div style="padding:0 var(--sp-lg) var(--sp-lg)">
        <button class="btn btn-primary btn-lg btn-full" id="mh-renew">${b("renewals",18,"white")} Renew Now</button>
      </div>`:""}
    </div></div>`,s.querySelectorAll("[data-action]").forEach(o=>o.addEventListener("click",()=>d.push(o.dataset.action))),s.querySelector("#mh-renew")?.addEventListener("click",()=>d.push("member-renew"))}};export{y as default};
