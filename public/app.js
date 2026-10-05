const $=id=>document.getElementById(id);
let token=localStorage.getItem("se_token");

function api(url, options={}) {
  options.headers={...(options.headers||{}), "Content-Type":"application/json"};
  if(token) options.headers.Authorization="Bearer "+token;
  return fetch(url,options).then(async r=>{
    const data=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(data.message||"Request failed");
    return data;
  });
}

function showAuth(){
  $("auth").classList.remove("hidden");
  $("dashboard").classList.add("hidden");
  $("logout").classList.add("hidden");
}
function showDash(){
  $("auth").classList.add("hidden");
  $("dashboard").classList.remove("hidden");
  $("logout").classList.remove("hidden");
  loadDashboard();
}

$("loginTab").onclick=()=>{
  $("loginTab").classList.add("active"); $("registerTab").classList.remove("active");
  $("loginForm").classList.remove("hidden"); $("registerForm").classList.add("hidden");
};
$("registerTab").onclick=()=>{
  $("registerTab").classList.add("active"); $("loginTab").classList.remove("active");
  $("registerForm").classList.remove("hidden"); $("loginForm").classList.add("hidden");
};

$("loginForm").onsubmit=async e=>{
  e.preventDefault();
  try{
    const d=await api("/api/login",{method:"POST",body:JSON.stringify({
      email:$("loginEmail").value,password:$("loginPassword").value
    })});
    token=d.token; localStorage.setItem("se_token",token); showDash();
  }catch(err){$("loginMsg").textContent=err.message}
};

$("registerForm").onsubmit=async e=>{
  e.preventDefault();
  try{
    const d=await api("/api/register",{method:"POST",body:JSON.stringify({
      name:$("regName").value,email:$("regEmail").value,password:$("regPassword").value,
      referralCode:$("regReferral").value
    })});
    token=d.token; localStorage.setItem("se_token",token); showDash();
  }catch(err){$("regMsg").textContent=err.message}
};

$("logout").onclick=()=>{localStorage.removeItem("se_token");token=null;showAuth()};

$("copyBtn").onclick=async()=>{
  await navigator.clipboard.writeText($("refLink").value);
  $("copyBtn").textContent="Copied!";
  setTimeout(()=>$("copyBtn").textContent="Copy Referral Link",1200);
};

function initials(n){return n.split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase()}

function nodeHtml(n){
  return `<li><div class="node"><div class="avatar">${initials(n.name)}</div><b>${escapeHtml(n.name)}</b><small>${escapeHtml(n.referralCode)} · ${n.directCount}/3</small></div>${
    n.children?.length ? `<ul>${n.children.map(nodeHtml).join("")}</ul>`:""
  }</li>`;
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}

async function loadDashboard(){
  try{
    const me=await api("/api/me");
    $("welcome").textContent="Welcome, "+me.name;
    $("code").textContent=me.referralCode;
    $("directCount").textContent=me.directCount;
    $("refLink").value=me.referralLink;

    const direct=await api("/api/direct");
    $("directList").innerHTML=direct.length?direct.map(u=>`
      <div class="member"><b>${escapeHtml(u.name)}</b><small>${escapeHtml(u.email)}</small><br>
      <small>Code: ${escapeHtml(u.referralCode)} · ${u.directCount}/3</small></div>`).join("")
      :"<p>No direct members yet. Share your referral link to add members.</p>";

    const root=await api("/api/tree");
    $("tree").innerHTML=root?`<ul>${nodeHtml(root)}</ul>`:"<p>No tree data.</p>";
  }catch(e){
    localStorage.removeItem("se_token"); token=null; showAuth();
  }
}

// Prefill referral code from URL ?ref=CODE
const ref=new URLSearchParams(location.search).get("ref");
if(ref) $("regReferral").value=ref;
if(token) showDash(); else showAuth();
