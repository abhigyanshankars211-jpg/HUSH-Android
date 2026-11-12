let sb, me=null, username='', activeDM=null, activeGroup=null, dmChannel=null, groupChannel=null, profileCreatedAt=null, extraWords=[], isAdminUser=false, wallCache={};
const BUILTIN_WORDS=['fuck','shit','bitch','madarchod','bhosdike','bhosdi','chutiya','chutiye','randi','gaandu','harami','bhenchod','behenchod'];
const PHONE_RE=/(?:\+91[\s-]?)?[6-9]\d{9}\b|\b\d{5}[\s-]?\d{5}\b/;
const EMAIL_RE=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const URL_RE=/(https?:\/\/|www\.)\S+|\b[\w-]+\.(com|in|net|org|io|me|co)\b/i;
function safetyBlock(text){
 const t=String(text||'');
 if(!t.trim()) return '';
 if(PHONE_RE.test(t)) return 'Phone numbers are not allowed.';
 if(EMAIL_RE.test(t)) return 'Email addresses are not allowed.';
 if(URL_RE.test(t)) return 'Links are not allowed.';
 const low=t.toLowerCase();
 for(const w of [...BUILTIN_WORDS, ...extraWords]){
  const word=String(w||'').trim().toLowerCase();
  if(word.length>1 && low.includes(word)) return 'This word is on the safety list.';
 }
 return '';
}
async function signupsEnabled(){
 try{const {data,error}=await sb.rpc('signups_enabled'); if(error) return true; return data!==false;}catch(e){return true}
}
async function loadSafetyWords(){
 try{const {data,error}=await sb.rpc('list_safety_words'); if(!error && Array.isArray(data)) extraWords=data.filter(Boolean);}catch(e){}
}
async function assertCanPost(){
 if(!profileCreatedAt) return;
 if(Date.now()-new Date(profileCreatedAt).getTime()>24*60*60*1000) return;
 const {count,error}=await sb.from('posts').select('id',{count:'exact',head:true}).eq('user_id',me.id);
 if(error) return;
 if((count||0)>=1) throw new Error('New accounts can post only 1 photo in the first 24 hours.');
}
function ageOk(){try{return localStorage.getItem('hush_age_ok')==='yes'}catch(e){return false}}
async function showAppeal(){
 $('ageGate').classList.add('hidden');
 $('login').classList.remove('hidden');
 $('app').classList.add('hidden');
 $('loginCard').classList.add('hidden');
 $('appealBox').classList.remove('hidden');
 let status='';
 try{const {data,error}=await sb.rpc('my_ban_appeal'); if(!error && data && data.status) status=data.status;}catch(e){}
 $('appealStatus').textContent=status==='pending'?'Your appeal is with the admin. Please wait for a result.':status==='rejected'?'This appeal was rejected. You cannot send another one.':'Your account is restricted. You can send one appeal.';
 const locked=status==='pending'||status==='rejected';
 $('appealBtn').disabled=locked; $('appealText').disabled=locked;
}

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials=s=>(s||'?').slice(0,1).toUpperCase();
function notify(t){$('toast').textContent=t;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2600)}
function showError(t){$('loginError').textContent=t}
function modal(html){$('modalBody').innerHTML=html;$('modal').classList.remove('hidden')}
function closeModal(){$('modal').classList.add('hidden');const box=document.querySelector('.modalBox');if(box)box.classList.remove('wide')}
$('closeModal').onclick=closeModal;$('modal').onclick=e=>{if(e.target===$('modal'))closeModal()};
function page(p){document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.page===p));['wall','chats','groups','profile','admin'].forEach(x=>$(x+'Page').classList.toggle('hidden',x!==p));$('sectionTitle').textContent={wall:'Pic Wall',chats:'Chats',groups:'Groups',profile:'Profile & safety',admin:'Admin panel'}[p];$('sectionKicker').textContent={wall:'COMMUNITY SPACE',chats:'PRIVATE MESSAGES',groups:'YOUR COMMUNITIES',profile:'ACCOUNT & PRIVACY',admin:'MODERATION & SAFETY'}[p];if(p==='wall')loadPosts();if(p==='chats')loadDMs();if(p==='groups')loadGroups();if(p==='profile')loadBlocks();if(p==='admin')loadAdmin('pending')}
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>page(b.dataset.page));
async function init(){
 if(!ageOk()){$('ageGate').classList.remove('hidden');$('login').classList.add('hidden');return}
 $('ageGate').classList.add('hidden');
 if(!window.HUSH_CONFIG||!window.HUSH_CONFIG.SUPABASE_URL||window.HUSH_CONFIG.SUPABASE_URL.includes('YOUR_')){$('login').classList.remove('hidden');showError('Supabase config missing. Check config.js.');return}
 sb=window.supabase.createClient(window.HUSH_CONFIG.SUPABASE_URL,window.HUSH_CONFIG.SUPABASE_PUBLISHABLE_KEY);
 const {data:{session},error}=await sb.auth.getSession();if(error)console.error(error);
 if(session){
  me=session.user;
  const banned=await sb.rpc('is_hush_banned');
  if(banned.data===true){await showAppeal();return}
  const {data:p}=await sb.from('profiles').select('username,created_at').eq('id',me.id).maybeSingle();
  if(p?.username){username=p.username;profileCreatedAt=p.created_at||null;enterApp();return}
 }
 $('login').classList.remove('hidden');$('loginCard').classList.remove('hidden');
}
$('loginBtn').onclick=login;$('username').addEventListener('keydown',e=>{if(e.key==='Enter')login()});
$('ageYes').onclick=()=>{try{localStorage.setItem('hush_age_ok','yes')}catch(e){} init()};
$('ageNo').onclick=()=>$('ageNoMsg').classList.remove('hidden');
$('appealBtn').onclick=async()=>{
 const msg=$('appealText').value.trim();
 if(msg.length<8){$('appealStatus').textContent='Write at least 8 characters.';return}
 const bad=safetyBlock(msg); if(bad){$('appealStatus').textContent=bad;return}
 try{
  const {data,error}=await sb.rpc('submit_ban_appeal',{msg}); if(error) throw error;
  $('appealStatus').textContent='Appeal bhej diya. Admin dekhega.';
  $('appealBtn').disabled=true; $('appealText').disabled=true;
 }catch(e){$('appealStatus').textContent=e.message||'Could not send the appeal. The safety SQL may still need to be run once.'}
};
$('appealSignOut').onclick=async()=>{try{await sb.auth.signOut()}catch(e){} location.reload()};
$('deleteAccountBtn').onclick=async()=>{
 if(!confirm('Delete this account forever?'))return;
 if(!confirm('Posts, chats, and the profile will be deleted. This cannot be undone.'))return;
 try{
  const {data:posts}=await sb.from('posts').select('image_path').eq('user_id',me.id);
  const paths=(posts||[]).map(p=>p.image_path).filter(Boolean);
  if(paths.length) await sb.storage.from('pic-wall').remove(paths);
  const {error}=await sb.rpc('delete_my_account'); if(error) throw error;
  try{await sb.auth.signOut()}catch(e){}
  try{localStorage.removeItem('hush_age_ok')}catch(e){}
  location.reload();
 }catch(e){notify(e.message||'Could not delete the account. The safety SQL may still need to be run once.')}
};
$('adminLoginBtn').onclick=adminLogin;
$('adminCreateBtn').onclick=createPermanentAdmin;
$('adminPassword').addEventListener('keydown',e=>{if(e.key==='Enter')adminLogin()});
async function adminLogin(){
 const email=$('adminEmail').value.trim(), password=$('adminPassword').value;
 const desiredUsername=$('username').value.trim().replace(/\s+/g,'_');
 if(!email||password.length<8){showError('Enter an admin email and a password of at least 8 characters.');return}
 try{
  const {data,error}=await sb.auth.signInWithPassword({email,password});if(error)throw error;
  me=data.user;
  const {data:p,error:pe}=await sb.from('profiles').select('username').eq('id',me.id).maybeSingle();if(pe)throw pe;
  if(!p?.username){
   if(!/^[A-Za-z0-9_]{3,20}$/.test(desiredUsername))throw new Error('Profile not found. Enter a 3–20 character username, then sign in again.');
   const badName=safetyBlock(desiredUsername); if(badName) throw new Error(badName);
   const {error:insertError}=await sb.from('profiles').upsert({id:me.id,username:desiredUsername});
   if(insertError)throw insertError;
   username=desiredUsername;
  } else { username=p.username; }
  const a=await sb.rpc('is_hush_admin');if(a.error)throw a.error;
  if(a.data!==true){await sb.auth.signOut();throw new Error('The account exists, but admin access is not active yet. Add this UID to the admin_users table: '+me.id)}
  enterApp();
 }catch(e){showError(e.message||'Admin login failed.')}
}
async function createPermanentAdmin(){
 const email=$('adminEmail').value.trim(), password=$('adminPassword').value, u=$('username').value.trim().replace(/\s+/g,'_');
 if(!email||password.length<8||!/^[A-Za-z0-9_]{3,20}$/.test(u)){showError('Enter a username (3–20 characters), a valid email, and a password of at least 8 characters.');return}
 const badAdmin=safetyBlock(u); if(badAdmin){showError(badAdmin);return}
 try{
  const {data,error}=await sb.auth.signUp({email,password});if(error)throw error;
  if(!data.user)throw new Error('Could not create the account.');
  if(data.session){
   const {error:pe}=await sb.from('profiles').upsert({id:data.user.id,username:u});
   if(pe)throw pe;
   showError('Permanent account created. UID: '+data.user.id+' — add this UID to public.admin_users.');
  } else {
   showError('Account created. Confirm the email verification link, then sign in with the same email and password. UID: '+data.user.id);
  }
 }catch(e){showError(e.message||'Could not create the account.')}
}
async function login(){
 const u=$('username').value.trim().replace(/\s+/g,'_');
 if(!/^[A-Za-z0-9_]{3,20}$/.test(u)){showError('Username must be 3–20 characters (letters, numbers or _).');return}
 const bad=safetyBlock(u); if(bad){showError(bad+' Choose a different username.');return}
 $('loginBtn').disabled=true;showError('');
 try{
  let {data:{session},error}=await sb.auth.getSession();if(error)throw error;
  if(!session){
   const open=await signupsEnabled();
   if(!open) throw new Error('New members are paused. An admin has turned joining off.');
   const r=await sb.auth.signInAnonymously();if(r.error)throw r.error;session=r.data.session
  }
  if(!session?.user)throw new Error('Supabase did not return a session. Check Anonymous Sign-Ins, then reload.');
  me=session.user;
  const banned=await sb.rpc('is_hush_banned');
  if(banned.data===true){await showAppeal();return}
  const {error:upErr}=await sb.from('profiles').upsert({id:me.id,username:u});
  if(upErr)throw upErr;
  username=u;
  const {data:p}=await sb.from('profiles').select('created_at').eq('id',me.id).maybeSingle();
  profileCreatedAt=p?.created_at||null;
  enterApp();
 }catch(e){showError(e.message||'Could not sign in. Check Anonymous Sign-ins and try again.')}
 finally{$('loginBtn').disabled=false}
}
async function enterApp(){$('login').classList.add('hidden');$('app').classList.remove('hidden');$('myUsername').textContent=username;$('avatar').textContent=initials(username);$('profileUsername').textContent=username;$('profileAvatar').textContent=initials(username);$('profileId').textContent=me.id;if(!profileCreatedAt){const {data:p}=await sb.from('profiles').select('created_at').eq('id',me.id).maybeSingle();profileCreatedAt=p?.created_at||null}await loadSafetyWords();const a=await sb.rpc('is_hush_admin');isAdminUser=a.data===true;if(isAdminUser)$('adminNav').classList.remove('hidden');try{await sb.rpc('sweep_expired_posts')}catch(e){}page('wall');maybeGuide()}
$('signOut').onclick=async()=>{if(!confirm('Sign out? This anonymous account may not be recoverable in this browser.'))return;await sb.auth.signOut();location.reload()};
async function profiles(ids){if(!ids.length)return{};const {data,error}=await sb.from('profiles').select('id,username').in('id',[...new Set(ids)]);if(error)throw error;return Object.fromEntries((data||[]).map(x=>[x.id,x.username]))}
async function loadPosts(){
 const el=$('posts');el.innerHTML='<div class="empty">Loading posts…</div>';
 try{
  try{await sb.rpc('sweep_expired_posts')}catch(e){}
  const {data:rawPosts,error}=await sb.from('posts').select('*').eq('approved',true).order('created_at',{ascending:false}).limit(50);if(error)throw error;
  const freshCut=Date.now()-60*60*1000;
  const posts=(rawPosts||[]).filter(p=>new Date(p.created_at).getTime()>freshCut);
  wallCache=Object.fromEntries(posts.map(p=>[p.id,p]));
  if(!posts.length){el.innerHTML='<div class="empty">No photos right now. Send one for admin review. Every photo is removed after 1 hour.</div>';return}
  const names=await profiles(posts.map(p=>p.user_id));
  const ids=posts.map(p=>p.id);
  const {data:comments}=await sb.from('comments').select('*').in('post_id',ids).order('created_at');
  const {data:likes}=await sb.from('post_likes').select('post_id,user_id').in('post_id',ids);
  const commentNames=await profiles((comments||[]).map(c=>c.user_id));
  el.innerHTML=posts.map(p=>{const path=sb.storage.from('pic-wall').getPublicUrl(p.image_path).data.publicUrl;const cs=(comments||[]).filter(c=>c.post_id===p.id);const count=(likes||[]).filter(l=>l.post_id===p.id).length;const liked=(likes||[]).some(l=>l.post_id===p.id&&l.user_id===me.id);return `<article class="post"><img class="wallPhoto" src="${esc(path)}" alt="Community post" onclick="openPhoto('${p.id}')"><div class="postbody"><div class="meta"><span>@${esc(names[p.user_id]||'HUSH member')}</span><span>${new Date(p.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span></div><p>${esc(p.caption)}</p><div class="actions"><button class="linkbtn" onclick="toggleLike('${p.id}',${liked})">${liked?'♥':'♡'} ${count} Likes</button><button class="linkbtn" onclick="toggleComments('${p.id}')">Comments (${cs.length})</button><button class="linkbtn" onclick="reportItem('post','${p.id}')">Report</button><button class="linkbtn" onclick="markPhoto('${p.id}')">Mark delete</button>${isAdminUser?`<button class="linkbtn" onclick="adminDeletePhoto('${p.id}')">Delete</button>`:''}</div><div id="comments-${p.id}" class="comments hidden">${cs.map(c=>`<div class="comment"><b>@${esc(commentNames[c.user_id]||'member')}</b> ${esc(c.body)}</div>`).join('')}<form class="commentform" onsubmit="addComment(event,'${p.id}')"><input maxlength="180" placeholder="Write a comment…" required><button class="linkbtn">Send</button></form></div></div></article>`}).join('');
 }catch(e){el.innerHTML=`<div class="empty">Could not load Pic Wall: ${esc(e.message)}</div>`}
}
window.openPhoto=id=>{
 const p=wallCache[id];
 if(!p){notify('Photo not found.');return}
 const url=sb.storage.from('pic-wall').getPublicUrl(p.image_path).data.publicUrl;
 modal(`<div class="fullPhoto"><img src="${esc(url)}" alt="Full photo"></div><p>${esc(p.caption||'')}</p><p class="hint">This photo is removed automatically after 1 hour. Members can mark it. Only an admin can delete it.</p><button class="btn secondary" type="button" onclick="markPhoto('${p.id}')">Mark for delete</button>${isAdminUser?`<button class="btn danger" type="button" onclick="adminDeletePhoto('${p.id}')">Delete photo</button>`:''}`);
 const box=document.querySelector('.modalBox'); if(box) box.classList.add('wide');
};
window.markPhoto=async id=>{
 try{
  const {error}=await sb.rpc('mark_post_for_delete',{pid:id});
  if(error) throw error;
  notify('Marked for deletion. Only an admin can delete it.');
 }catch(e){notify(e.message||'Could not mark this photo. The cleanup SQL may still need to be run once.')}
};
window.adminDeletePhoto=async id=>{
 if(!isAdminUser){notify('Only an admin can delete a photo.');return}
 if(!confirm('Delete this photo forever?'))return;
 try{
  const p=wallCache[id];
  const {error}=await sb.rpc('admin_delete_post',{pid:id});
  if(error) throw error;
  if(p?.image_path){try{await sb.storage.from('pic-wall').remove([p.image_path])}catch(e){}}
  delete wallCache[id];
  closeModal();
  notify('Photo delete ho gayi.');
  if(!$('adminPage').classList.contains('hidden')) loadAdmin('photos'); else loadPosts();
 }catch(e){notify(e.message||'Could not delete the photo. The cleanup SQL may still need to be run once.')}
};
window.adminDeleteGroup=async id=>{
 if(!isAdminUser){notify('Only an admin can delete a group.');return}
 if(!confirm('This group, its members, and its messages will be deleted. This cannot be undone.'))return;
 try{
  const {error}=await sb.rpc('admin_delete_group',{gid:id});
  if(error) throw error;
  if(groupChannel){try{await sb.removeChannel(groupChannel)}catch(e){} groupChannel=null}
  activeGroup=null;
  notify('Group delete ho gaya.');
  loadGroups();
 }catch(e){notify(e.message||'Could not delete the group. The cleanup SQL may still need to be run once.')}
};
$('postBtn').onclick=()=>modal(`<h3>Share a picture</h3><form id="uploadForm"><div class="field"><label>JPG, PNG, or WebP. Max 5 MB.</label><input id="photo" type="file" accept="image/jpeg,image/png,image/webp" required><img id="photoPreview" class="previewShot hidden" alt="Preview"></div><div class="field"><label>Caption</label><textarea id="caption" maxlength="240" placeholder="Add a few words…"></textarea></div><p class="hint">Check the preview first. An admin will approve it. The photo is removed after 1 hour.</p><button class="btn primary">Submit for review</button></form>`);
$('refreshWall').onclick=()=>loadPosts();
function maybeGuide(){
 try{if(localStorage.getItem('hush_guide_ok')==='yes')return}catch(e){return}
 modal(`<h3>Quick guide</h3><p>1. Send a photo. An admin approves it. It is removed after 1 hour.</p><p>2. Do not post a phone number, email, or link.</p><p>3. If a photo should go, tap Mark for delete. Only an admin can delete it.</p><button class="btn primary" id="guideOk" type="button">Got it</button>`);
 const ok=$('guideOk'); if(ok) ok.onclick=()=>{try{localStorage.setItem('hush_guide_ok','yes')}catch(e){} closeModal()};
}
$('modalBody').addEventListener('change',e=>{
 if(e.target.id!=='photo')return;
 const f=e.target.files&&e.target.files[0];
 const img=$('photoPreview');
 if(!img)return;
 if(!f){img.classList.add('hidden');return}
 img.src=URL.createObjectURL(f);
 img.classList.remove('hidden');
});
$('modalBody').addEventListener('submit',async e=>{
 if(e.target.id==='uploadForm'){e.preventDefault();const f=$('photo').files[0];if(!f)return;if(f.size>5*1024*1024){notify('Image must be under 5 MB.');return}const cap=$('caption').value||'';const badCap=safetyBlock(cap);if(badCap){notify(badCap);return}try{await assertCanPost();const ext=f.name.split('.').pop().toLowerCase();const path=`${me.id}/${crypto.randomUUID()}.${ext}`;let r=await sb.storage.from('pic-wall').upload(path,f,{contentType:f.type,upsert:false});if(r.error)throw r.error;let p=await sb.from('posts').insert({user_id:me.id,image_path:path,caption:cap,approved:false});if(p.error)throw p.error;closeModal();notify('Photo submitted for admin review.');}catch(err){notify(err.message)}}
 if(e.target.id==='dmForm'){e.preventDefault();await startDM($('dmUsername').value)}
 if(e.target.id==='groupForm'){e.preventDefault();await createGroup($('gName').value,$('gDesc').value,$('gPrivate').checked)}
});
window.toggleLike=async(id,liked)=>{try{const q=liked?sb.from('post_likes').delete().eq('post_id',id).eq('user_id',me.id):sb.from('post_likes').insert({post_id:id,user_id:me.id});const {error}=await q;if(error)throw error;loadPosts()}catch(e){notify(e.message)}};
window.toggleComments=id=>$('comments-'+id).classList.toggle('hidden');
window.addComment=async(e,id)=>{e.preventDefault();const body=e.target.querySelector('input').value.trim();const bad=safetyBlock(body);if(bad){notify(bad);return}const {error}=await sb.from('comments').insert({post_id:id,user_id:me.id,body});if(error)notify(error.message);else loadPosts()};
window.reportItem=async(type,id)=>{const reason=prompt('Why are you reporting this content?');if(!reason)return;const {error}=await sb.from('reports').insert({reporter_id:me.id,target_type:type,target_id:id,reason});notify(error?error.message:'Report submitted. Thank you.')};
$('newChat').onclick=()=>modal(`<h3>Start a private chat</h3><form id="dmForm"><div class="field"><label>HUSH username</label><input id="dmUsername" required minlength="3" placeholder="Enter exact username"></div><button class="btn primary">Continue</button></form>`);
async function startDM(u){u=u.trim().replace(/^@/,'');try{const {data:target,error}=await sb.from('profiles').select('id,username').eq('username',u).maybeSingle();if(error)throw error;if(!target){notify('Username not found.');return}if(target.id===me.id){notify('You cannot message yourself.');return}const {data:blocks}=await sb.from('user_blocks').select('blocker_id,blocked_id').or(`and(blocker_id.eq.${me.id},blocked_id.eq.${target.id}),and(blocker_id.eq.${target.id},blocked_id.eq.${me.id})`);if(blocks?.length){notify('Messaging is unavailable because one of you has blocked the other.');return}
 const [a,b]=[me.id,target.id].sort();let {data:c,error:ce}=await sb.from('conversations').select('*').eq('user_a',a).eq('user_b',b).maybeSingle();if(ce)throw ce;if(!c){const r=await sb.from('conversations').insert({user_a:a,user_b:b}).select().single();if(r.error){const retry=await sb.from('conversations').select('*').eq('user_a',a).eq('user_b',b).single();if(retry.error)throw r.error;c=retry.data}else c=r.data}
 closeModal();activeDM={id:c.id,otherId:target.id,otherName:target.username};page('chats');await loadDMs();await openDM(c.id,target.id,target.username);
 }catch(e){notify(e.message)}}
async function loadDMs(){try{const {data,error}=await sb.from('conversations').select('*').or(`user_a.eq.${me.id},user_b.eq.${me.id}`).order('created_at',{ascending:false});if(error)throw error;const others=(data||[]).map(c=>({c,other:c.user_a===me.id?c.user_b:c.user_a}));const ns=await profiles(others.map(x=>x.other));const ids=others.map(x=>x.c.id);let last={};if(ids.length){const {data:msgs}=await sb.from('messages').select('conversation_id,body,created_at').in('conversation_id',ids).order('created_at',{ascending:false}).limit(80);(msgs||[]).forEach(m=>{if(!last[m.conversation_id])last[m.conversation_id]=m.body||'Photo'})}$('chatList').innerHTML=others.length?others.map(x=>`<div class="chatItem ${activeDM?.id===x.c.id?'active':''}" onclick="chooseDM('${x.c.id}','${x.other}','${esc(ns[x.other]||'Member')}')">◉ @${esc(ns[x.other]||'Member')}<small>${esc(last[x.c.id]||'New chat')}</small></div>`).join(''):'<div class="empty">No chats yet. Start one with a username.</div>';if(activeDM)await openDM(activeDM.id,activeDM.otherId,activeDM.otherName)}catch(e){$('chatList').innerHTML=`<div class="empty">${esc(e.message)}</div>`}}
window.chooseDM=(id,otherId,name)=>{activeDM={id,otherId,otherName:name};loadDMs()};
async function signedChatUrl(path){if(!path)return null;const {data,error}=await sb.storage.from('chat-media').createSignedUrl(path,3600);if(error)throw error;return data.signedUrl}
async function messageMarkup(m,otherName=''){let image='';if(m.image_path){try{const url=await signedChatUrl(m.image_path);image=`<a href="${esc(url)}" target="_blank" rel="noopener"><img class="chatPhoto" src="${esc(url)}" alt="Shared photo"></a>`}catch(e){image='<small>Photo unavailable</small>'}}return `<div class="bubble ${m.sender_id===me.id?'mine':''}">${m.body?`<div>${esc(m.body)}</div>`:''}${image}<small class="msgTime">${new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</small></div>`}
async function openDM(id,otherId,name){if(dmChannel){await sb.removeChannel(dmChannel);dmChannel=null}const {data,error}=await sb.from('messages').select('*').eq('conversation_id',id).order('created_at');if(error){$('chatPanel').innerHTML=`<div class="empty">${esc(error.message)}</div>`;return}await drawDM(id,otherId,name,data||[]);dmChannel=sb.channel('dm-'+id).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`conversation_id=eq.${id}`},async payload=>{if(payload.new.sender_id!==me.id){const box=$('messages');if(box){box.insertAdjacentHTML('beforeend',await messageMarkup(payload.new));box.scrollTop=box.scrollHeight}}}).subscribe()}
async function drawDM(id,otherId,name,msgs){const items=await Promise.all(msgs.map(m=>messageMarkup(m)));$('chatPanel').innerHTML=`<div class="chatHead">@${esc(name)} <button class="linkbtn" style="float:right" onclick="blockMember('${otherId}','${esc(name)}')">Block</button></div><div id="messages" class="messages">${items.join('')}</div><form class="sendForm mediaSend" onsubmit="sendDM(event,'${id}')"><label class="attachBtn" title="Attach photo">＋<input id="dmPhoto" type="file" accept="image/jpeg,image/png,image/webp" hidden></label><input id="dmText" maxlength="2000" placeholder="Write a message…"><button class="btn primary">Send</button></form><small class="chatHint">Photos are private. Screenshots are possible. Do not share a phone number, address, or personal details. Max 5 MB.</small>`;$('messages').scrollTop=$('messages').scrollHeight}
window.sendDM=async(e,id)=>{e.preventDefault();const input=$('dmText'),file=$('dmPhoto')?.files?.[0],body=input.value.trim();if(!body&&!file)return;if(body){const bad=safetyBlock(body);if(bad){notify(bad);return}}if(file&&(file.size>5*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type))){notify('Choose a JPG, PNG or WebP image under 5 MB.');return}try{let image_path=null;if(file){const ext=file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';image_path=`direct/${id}/${me.id}/${crypto.randomUUID()}.${ext}`;const up=await sb.storage.from('chat-media').upload(image_path,file,{contentType:file.type,upsert:false});if(up.error)throw up.error}const {data,error}=await sb.from('messages').insert({conversation_id:id,sender_id:me.id,body:body||null,image_path}).select().single();if(error)throw error;input.value='';if(file)file.value='';const box=$('messages');box.insertAdjacentHTML('beforeend',await messageMarkup(data));box.scrollTop=box.scrollHeight}catch(err){notify(err.message)}};
window.blockMember=async(id,name)=>{if(!confirm(`Block @${name}?`))return;const {error}=await sb.from('user_blocks').insert({blocker_id:me.id,blocked_id:id});if(error)notify(error.message);else{activeDM=null;notify('Member blocked.');page('profile')}};
$('createGroup').onclick=()=>modal(`<h3>Create a group</h3><form id="groupForm"><div class="field"><label>Group name</label><input id="gName" maxlength="35" required></div><div class="field"><label>Short description</label><textarea id="gDesc" maxlength="150"></textarea></div><div class="field"><label><input id="gPrivate" type="checkbox" style="width:auto"> Private group (invites are not available yet)</label></div><button class="btn primary">Create group</button></form>`);
async function createGroup(name,description,is_private){try{const bad=safetyBlock(name)||safetyBlock(description);if(bad){notify(bad);return}const {data:g,error}=await sb.from('groups').insert({name,description,owner_id:me.id,is_private}).select().single();if(error)throw error;const {error:je}=await sb.from('group_members').insert({group_id:g.id,user_id:me.id});if(je)throw je;closeModal();notify('Group created.');loadGroups()}catch(e){notify(e.message)}}
async function loadGroups(){const el=$('groups');try{let q=sb.from('groups').select('*').order('created_at',{ascending:false});if(!isAdminUser)q=q.eq('is_private',false);const {data,error}=await q;if(error)throw error;if(!data?.length){el.innerHTML='<div class="empty">No public groups yet. Create the first one.</div>';return}const {data:members}=await sb.from('group_members').select('group_id,user_id').in('group_id',data.map(g=>g.id));el.innerHTML=data.map(g=>{const joined=(members||[]).some(m=>m.group_id===g.id&&m.user_id===me.id);const count=(members||[]).filter(m=>m.group_id===g.id).length;const del=isAdminUser?`<button class="btn danger" onclick="adminDeleteGroup('${g.id}')">Delete</button>`:'';return `<div class="groupCard"><div class="groupIcon">♧</div><h4>${esc(g.name)}</h4><p>${esc(g.description||'A HUSH community')}<br>${count} member(s)</p><button onclick="joinGroup('${g.id}',${joined})">${joined?'Open group':'Join group'}</button>${del}</div>`}).join('')}catch(e){el.innerHTML=`<div class="empty">${esc(e.message)}</div>`}}
window.joinGroup=async(id,joined)=>{if(!joined){const {error}=await sb.from('group_members').insert({group_id:id,user_id:me.id});if(error){notify(error.message);return}}activeGroup=id;page('groups');openGroup(id)};
async function openGroup(id){if(groupChannel){await sb.removeChannel(groupChannel);groupChannel=null}const {data:g}=await sb.from('groups').select('*').eq('id',id).single();if(g&&Number(g.disappear_after_hours)>0){try{await sb.rpc('sweep_group_messages',{gid:id})}catch(e){}}const {data:raw,error}=await sb.from('group_messages').select('*').eq('group_id',id).order('created_at');if(error){notify(error.message);return}let msgs=raw||[];if(g&&Number(g.disappear_after_hours)>0){const cut=Date.now()-24*60*60*1000;msgs=msgs.filter(m=>new Date(m.created_at).getTime()>cut)}const names=await profiles((msgs||[]).map(m=>m.sender_id));const items=await Promise.all((msgs||[]).map(async m=>{const html=await messageMarkup(m);return `<div class="groupMsgHead">@${esc(names[m.sender_id]||'member')}</div>${html}`}));$('groups').innerHTML=`<div class="groupCard groupChatCard" style="grid-column:1/-1"><button onclick="loadGroups()">← Back to groups</button>${isAdminUser?`<button class="btn danger" onclick="adminDeleteGroup('${id}')">Delete group</button>`:''}<h3>${esc(g.name)}</h3><p>${esc(g.description)}</p><div id="groupMessages" class="messages" style="height:260px;border:1px solid #eee;border-radius:12px">${items.join('')}</div><form class="sendForm mediaSend" onsubmit="sendGroup(event,'${id}')"><label class="attachBtn" title="Attach photo">＋<input id="groupPhoto" type="file" accept="image/jpeg,image/png,image/webp" hidden></label><input id="groupText" maxlength="2000" placeholder="Message the group…"><button class="btn primary">Send</button></form><small class="chatHint">${Number(g.disappear_after_hours)>0?'Messages disappear after 24 hours. ':''}Screenshots are possible. Do not share personal details. Max 5 MB.</small></div>`;groupChannel=sb.channel('group-'+id).on('postgres_changes',{event:'INSERT',schema:'public',table:'group_messages',filter:`group_id=eq.${id}`},async payload=>{if(payload.new.sender_id!==me.id){const n=await profiles([payload.new.sender_id]);const box=$('groupMessages');if(box){box.insertAdjacentHTML('beforeend',`<div class="groupMsgHead">@${esc(n[payload.new.sender_id]||'member')}</div>${await messageMarkup(payload.new)}`);box.scrollTop=box.scrollHeight}}}).subscribe()}
window.sendGroup=async(e,id)=>{e.preventDefault();const input=$('groupText'),file=$('groupPhoto')?.files?.[0],body=input.value.trim();if(!body&&!file)return;if(body){const bad=safetyBlock(body);if(bad){notify(bad);return}}if(file&&(file.size>5*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type))){notify('Choose a JPG, PNG or WebP image under 5 MB.');return}try{let image_path=null;if(file){const ext=file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';image_path=`group/${id}/${me.id}/${crypto.randomUUID()}.${ext}`;const up=await sb.storage.from('chat-media').upload(image_path,file,{contentType:file.type,upsert:false});if(up.error)throw up.error}const {data,error}=await sb.from('group_messages').insert({group_id:id,sender_id:me.id,body:body||null,image_path}).select().single();if(error)throw error;input.value='';if(file)file.value='';const box=$('groupMessages');box.insertAdjacentHTML('beforeend',`<div class="groupMsgHead">@${esc(username)}</div>${await messageMarkup(data)}`);box.scrollTop=box.scrollHeight}catch(err){notify(err.message)}};
$('blockBtn').onclick=async()=>{const u=$('blockUsername').value.trim().replace(/^@/,'');if(!u)return;const {data:p,error}=await sb.from('profiles').select('id').eq('username',u).maybeSingle();if(error||!p){notify(error?.message||'Username not found.');return}if(p.id===me.id){notify('You cannot block yourself.');return}const r=await sb.from('user_blocks').insert({blocker_id:me.id,blocked_id:p.id});notify(r.error?r.error.message:'Member blocked.');$('blockUsername').value='';loadBlocks()};
async function loadBlocks(){try{const {data,error}=await sb.from('user_blocks').select('blocked_id').eq('blocker_id',me.id);if(error)throw error;const ns=await profiles((data||[]).map(x=>x.blocked_id));$('blockedList').innerHTML=data?.length?data.map(x=>`<div class="blockedRow">@${esc(ns[x.blocked_id]||'member')} <button class="linkbtn" onclick="unblock('${x.blocked_id}')">Unblock</button></div>`).join(''):'No blocked members.'}catch(e){$('blockedList').textContent=e.message}}
window.unblock=async(id)=>{const {error}=await sb.from('user_blocks').delete().eq('blocker_id',me.id).eq('blocked_id',id);notify(error?error.message:'Unblocked.');loadBlocks()};

$('copyIdBtn').onclick=async()=>{try{await navigator.clipboard.writeText(me.id);notify('Account ID copied.')}catch(e){notify('Account ID: '+me.id)}};
document.querySelectorAll('.adminTab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.adminTab').forEach(x=>x.classList.toggle('active',x===b));loadAdmin(b.dataset.adminTab)});
async function requireAdmin(){const {data,error}=await sb.rpc('is_hush_admin');if(error)throw error;if(data!==true)throw new Error('Admin access is not enabled for this account. Run the admin setup SQL first.');}
async function safetyAdminHtml(){
 let open=true, sqlNote='';
 try{const {data,error}=await sb.rpc('signups_enabled'); if(error) sqlNote='Run supabase/secure_additive.sql once in the SQL Editor to use the new-member switch.'; else open=data!==false;}catch(e){sqlNote='The safety SQL still needs to be run once.'}
 let words=[];
 try{const {data,error}=await sb.rpc('list_safety_words'); if(!error&&Array.isArray(data)) words=data; else if(error) sqlNote=sqlNote||'Run the safety SQL to add extra words. The built-in filter is already on.';}catch(e){}
 let appeals=[];
 try{const {data,error}=await sb.rpc('list_ban_appeals'); if(!error&&Array.isArray(data)) appeals=data;}catch(e){}
 let groups=[];
 const gq=await sb.from('groups').select('id,name,disappear_after_hours').order('created_at',{ascending:false});
 if(gq.error) sqlNote=sqlNote||'Run the safety SQL to use disappearing chats.'; else groups=gq.data||[];
 const wordHtml=words.length?words.map(w=>`<span class="wordchip">${esc(w)} <button type="button" class="linkbtn" data-del-word="${esc(w)}">×</button></span>`).join(''):'<span class="idSmall">No extra words yet.</span>';
 const appealHtml=appeals.length?appeals.map(a=>`<div class="reportRow"><div><b>@${esc(a.username||'member')}</b><p>${esc(a.message||'')}</p><small>${esc(a.status)} · ${a.created_at?new Date(a.created_at).toLocaleString():''}</small></div><div>${a.status==='pending'?`<button class="btn primary" data-appeal="${a.id}" data-accept="1">Accept</button> <button class="btn danger" data-appeal="${a.id}" data-accept="0">Reject</button>`:`<span class="idSmall">${esc(a.status)}</span>`}</div></div>`).join(''):'<div class="empty">No appeals.</div>';
 const groupHtml=groups.length?groups.map(g=>`<div class="reportRow"><div><b>${esc(g.name)}</b><p>${Number(g.disappear_after_hours)>0?'24h disappearing on':'Messages saved'}</p></div><button class="btn secondary" data-disappear="${g.id}" data-on="${Number(g.disappear_after_hours)>0?'0':'1'}">${Number(g.disappear_after_hours)>0?'Turn off':'24h on'}</button></div>`).join(''):'<div class="empty">No groups.</div>';
 return `<div class="reportRow"><div><b>New members</b><p>${open?'Joining is open. New anonymous members can sign up.':'Joining is off. Existing members and admin login still work.'}</p><small>${esc(sqlNote)}</small></div><button id="signupToggle" class="btn ${open?'danger':'primary'}">${open?'Turn off':'Turn on'}</button></div><h3 style="margin:18px 0 8px">Safety words</h3><p class="idSmall">Phone numbers, emails, and links are always blocked. Built-in: ${esc(BUILTIN_WORDS.join(', '))}</p><form id="wordForm" class="inline" style="margin:10px 0"><input id="newWord" maxlength="40" placeholder="word or phrase"><button class="btn secondary" type="submit">Add</button></form><div id="wordList">${wordHtml}</div><h3 style="margin:18px 0 8px">Ban appeals</h3>${appealHtml}<h3 style="margin:18px 0 8px">Disappearing group chats</h3><p class="idSmall">When this is on, messages older than 24 hours in that group are deleted.</p>${groupHtml}`;
}
function bindSafetyAdmin(){
 const t=$('signupToggle');
 if(t) t.onclick=async()=>{
  const enabled=/turn on/i.test(t.textContent);
  try{const {error}=await sb.rpc('set_signups_enabled',{enabled}); if(error) throw error; notify(enabled?'New members on.':'New members off.'); loadAdmin('safety');}catch(e){notify(e.message||'Could not save the switch. Run the safety SQL once.')}
 };
 const form=$('wordForm');
 if(form) form.onsubmit=async e=>{
  e.preventDefault();
  const word=$('newWord').value.trim().toLowerCase();
  if(!/^[\p{L}\p{N} _-]{2,40}$/u.test(word)){notify('Use 2–40 letters, numbers, spaces, _ or -.');return}
  try{const {error}=await sb.rpc('add_safety_word',{word}); if(error) throw error; notify('Word added.'); loadAdmin('safety');}catch(err){notify(err.message||'Could not add that word.')}
 };
 $('adminContent').onclick=async ev=>{
  const del=ev.target.closest('[data-del-word]');
  if(del){try{const {error}=await sb.rpc('remove_safety_word',{word:del.getAttribute('data-del-word')}); if(error) throw error; loadAdmin('safety');}catch(e){notify(e.message)} return}
  const ap=ev.target.closest('[data-appeal]');
  if(ap){try{const {error}=await sb.rpc('decide_ban_appeal',{appeal_id:ap.dataset.appeal, accept:ap.dataset.accept==='1'}); if(error) throw error; notify('Appeal update ho gaya.'); loadAdmin('safety');}catch(e){notify(e.message)} return}
  const d=ev.target.closest('[data-disappear]');
  if(d){try{const {error}=await sb.rpc('set_group_disappear',{gid:d.dataset.disappear, turn_on:d.dataset.on==='1'}); if(error) throw error; notify('Group setting save ho gayi.'); loadAdmin('safety');}catch(e){notify(e.message)}}
 };
}
async function loadAdmin(tab='pending'){const el=$('adminContent');el.innerHTML='<div class="empty">Loading…</div>';try{await requireAdmin();try{const p=await sb.from('posts').select('id',{count:'exact',head:true}).eq('approved',false);const r=await sb.from('reports').select('id',{count:'exact',head:true}).neq('status','resolved');const pulse=$('adminPulse');if(pulse)pulse.innerHTML=`<span>${p.error?'–':(p.count||0)} pending photos</span><span>${r.error?'–':(r.count||0)} open reports</span><span>Only admins can delete</span>`}catch(e){}if(tab==='pending'){const {data,error}=await sb.from('posts').select('*').eq('approved',false).order('created_at',{ascending:true});if(error)throw error;if(!data.length){el.innerHTML='<div class="empty">No photos waiting for review.</div>';return}const names=await profiles(data.map(x=>x.user_id));el.innerHTML=`<div class="adminGrid">${data.map(p=>{const url=sb.storage.from('pic-wall').getPublicUrl(p.image_path).data.publicUrl;return `<article class="adminCard"><img src="${esc(url)}" alt="Pending community photo"><div><b>@${esc(names[p.user_id]||'member')}</b><p>${esc(p.caption||'No caption')}</p><small>${new Date(p.created_at).toLocaleString()}</small><div class="adminActions"><button class="btn primary" onclick="adminApprove('${p.id}')">Approve</button><button class="btn danger" onclick="adminReject('${p.id}','${esc(p.image_path)}')">Reject</button></div></div></article>`}).join('')}</div>`}else if(tab==='reports'){const {data,error}=await sb.from('reports').select('*').order('created_at',{ascending:false}).limit(100);if(error)throw error;if(!data.length){el.innerHTML='<div class="empty">No reports. Nice and quiet.</div>';return}el.innerHTML=data.map(r=>`<div class="reportRow"><div><b>${esc(r.target_type)} report</b><p>${esc(r.reason)}</p><small>Status: ${esc(r.status)} · ${new Date(r.created_at).toLocaleString()}</small></div><div><button class="btn secondary" onclick="adminReportStatus('${r.id}','reviewing')">Review</button> <button class="btn primary" onclick="adminReportStatus('${r.id}','resolved')">Resolve</button></div></div>`).join('')}else if(tab==='photos'){const listed=await sb.rpc('list_posts_for_admin');if(listed.error)throw listed.error;const rows=listed.data||[];rows.forEach(p=>{wallCache[p.id]=p});if(!rows.length){el.innerHTML='<div class="empty">No photos. Photos older than 1 hour are removed automatically.</div>';return}el.innerHTML=`<p class="idSmall">Members can mark photos. Only an admin can delete them. Every photo is removed after 1 hour.</p><div class="adminGrid">${rows.map(p=>{const url=p.image_path?sb.storage.from('pic-wall').getPublicUrl(p.image_path).data.publicUrl:'';return `<article class="adminCard">${url?`<img class="wallPhoto" src="${esc(url)}" alt="Photo" onclick="openPhoto('${p.id}')">`:''}<div><b>@${esc(p.username||'member')}</b><p>${esc(p.caption||'No caption')}</p><small>${Number(p.marks)||0} mark(s) · ${p.approved?'live':'pending'} · ${new Date(p.created_at).toLocaleString()}</small><div class="adminActions"><button class="btn danger" onclick="adminDeletePhoto('${p.id}')">Delete</button></div></div></article>`}).join('')}</div>`}else if(tab==='safety'){el.innerHTML=await safetyAdminHtml();bindSafetyAdmin()}else{const {data:users,error}=await sb.from('profiles').select('id,username,created_at').order('created_at',{ascending:false}).limit(150);if(error)throw error;const {data:bans,error:banError}=await sb.from('banned_users').select('user_id');if(banError)throw banError;const banned=new Set((bans||[]).map(x=>x.user_id));el.innerHTML=users.map(u=>`<div class="reportRow"><div><b>@${esc(u.username)}</b><p class="idSmall">${esc(u.id)}</p><small>Joined ${new Date(u.created_at).toLocaleDateString()}</small></div><div>${banned.has(u.id)?`<button class="btn secondary" onclick="adminUnban('${u.id}')">Unban</button>`:`<button class="btn danger" onclick="adminBan('${u.id}','${esc(u.username)}')">Ban</button>`}</div></div>`).join('')||'<div class="empty">No members found.</div>'}}catch(e){el.innerHTML=`<div class="empty">${esc(e.message)}<br><br>Admin tools are hidden until your account ID is added to admin_users using the setup SQL file.</div>`}}
window.adminApprove=async id=>{try{const {error}=await sb.from('posts').update({approved:true}).eq('id',id);if(error)throw error;notify('Photo approved and published.');loadAdmin('pending')}catch(e){notify(e.message)}};
window.adminReject=async(id,path)=>{if(!confirm('Reject and permanently delete this photo?'))return;try{const {error}=await sb.from('posts').delete().eq('id',id);if(error)throw error;await sb.storage.from('pic-wall').remove([path]);notify('Photo rejected and deleted.');loadAdmin('pending')}catch(e){notify(e.message)}};
window.adminReportStatus=async(id,status)=>{const {error}=await sb.from('reports').update({status}).eq('id',id);notify(error?error.message:'Report updated.');loadAdmin('reports')};
window.adminBan=async(id,name)=>{if(!confirm(`Ban @${name} from the HUSH app?`))return;const {error}=await sb.from('banned_users').insert({user_id:id,reason:'Admin moderation'});notify(error?error.message:'Member banned.');loadAdmin('members')};
window.adminUnban=async id=>{const {error}=await sb.from('banned_users').delete().eq('user_id',id);notify(error?error.message:'Member unbanned.');loadAdmin('members')};

init();
