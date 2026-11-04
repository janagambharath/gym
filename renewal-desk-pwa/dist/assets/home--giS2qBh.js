import{f as v,g as p,a as b,j as t,D as g,K as f,E as n,i as u,n as d}from"./index-DkN_O8_I.js";const w={async mount(a){await m(a),v(a,()=>m(a,!0))}};async function m(a,c=!1){const r=await p("/api/member/v1/dashboard");if(a.dataset.screenDisposed==="true"||c&&!r.ok)return;const l=r.ok?r.data:{},s=l.member||{},i={member_name:s.full_name,gym_name:l.gym?.name,membership:{days_remaining:s.days_left,status:s.status,plan_name:s.plan_name,end_date:s.membership_end}},e=i.membership||{};a.innerHTML=`${b({title:"My Gym"})}
    <div class="scroll-view"><div class="scroll-content">
      <div style="padding:var(--sp-xxl);text-align:center;background:linear-gradient(135deg,var(--brand),var(--brand-dark));color:white;border-radius:0 0 var(--r-xxl) var(--r-xxl)">
        <h2 style="color:white;margin-bottom:var(--sp-sm)">${t(i.member_name||"Member")}</h2>
        <div style="font-size:var(--fs-sm);opacity:0.9;margin-bottom:var(--sp-lg)">${t(i.gym_name||"")}</div>
        <div style="font-size:var(--fs-6xl);font-weight:var(--fw-extrabold)">${e.days_remaining!=null?e.days_remaining:"—"}</div>
        <div style="font-size:var(--fs-sm);opacity:0.8">days remaining</div>
        ${e.status?`<div style="margin-top:var(--sp-md)">${g(e.status)}</div>`:""}
      </div>
      <div style="padding:var(--sp-lg)"><div class="card card-body">
        <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Membership</div>
        <div class="info-row"><span class="info-row-label">Plan</span><span class="info-row-value">${t(e.plan_name||"—")}</span></div>
        <div class="info-row"><span class="info-row-label">Valid Until</span><span class="info-row-value">${f(e.end_date)}</span></div>
      </div></div>
      <div class="card" style="margin:0 var(--sp-lg) var(--sp-lg)">
        ${n({iconName:"person",label:"My Profile",onClick:"member-profile",iconBg:"var(--brand-subtle)",iconColor:"var(--brand)"})}
        ${n({iconName:"calendar",label:"Membership",onClick:"member-membership",iconBg:"var(--success-surface)",iconColor:"var(--success)"})}
        ${n({iconName:"wallet",label:"Payments",onClick:"member-payments",iconBg:"var(--status-pending-surface)",iconColor:"var(--status-pending)"})}
        ${n({iconName:"access",label:"Attendance",onClick:"member-access",iconBg:"#fce7f3",iconColor:"#db2777"})}
      </div>
      ${e.days_remaining!=null&&e.days_remaining<=7?`<div style="padding:0 var(--sp-lg) var(--sp-lg)">
        <button class="btn btn-primary btn-lg btn-full" id="mh-renew">${u("renewals",18,"white")} Renew Now</button>
      </div>`:""}
    </div></div>`,a.querySelectorAll("[data-action]").forEach(o=>o.addEventListener("click",()=>d.push(o.dataset.action))),a.querySelector("#mh-renew")?.addEventListener("click",()=>d.push("member-renew"))}export{w as default};
