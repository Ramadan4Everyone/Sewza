/* SEWZA v2 — offline-first, Supabase-ready digital measurement book. */
(() => {
  'use strict';

  const STORAGE_KEY = 'sewza_v2_data';
  const SETTINGS_KEY = 'sewza_v2_settings';
  const DB_NAME = 'sewza_offline_db';
  const DB_VERSION = 1;
  const STORE = 'app';
  const PENDING_SYNC_PREFIX = 'sewza_pending_sync_';
  const PENDING_DELETE_PREFIX = 'sewza_pending_delete_';
  const BOOT_MIN_MS = 2800; // how long the animated logo intro is shown at minimum

  const demoCustomers = [
    { id:'demo-1', name:'Aisha Bello', phone:'0803 123 4567', gender:'Female', category:'Dress', date:'Today', startDate:'', deliveryDate:'', unit:'in', notes:'Prefers a comfortable fit. Gold zipper.', measurements:{Bust:'34',Waist:'28',Hip:'38',Shoulder:'15',Sleeve:'24',Length:'58'}, history:[], price:'', paid:'', status:'In progress' },
    { id:'demo-2', name:'Tunde Adeyemi', phone:'0812 445 7788', gender:'Male', category:'Native wear', date:'Yesterday', startDate:'', deliveryDate:'', unit:'in', notes:'Keep native top slightly loose.', measurements:{Chest:'42',Shoulder:'18',Sleeve:'25', 'Buba Length':'31','Trouser Waist':'36','Trouser Length':'42'}, history:[], price:'', paid:'', status:'In progress' },
    { id:'demo-3', name:'Mariam Yusuf', phone:'0901 778 2345', gender:'Female', category:'Gown', date:'Sep 29', startDate:'', deliveryDate:'', unit:'in', notes:'', measurements:{Bust:'36',Waist:'30',Hip:'40',Shoulder:'14.5',Sleeve:'23',Length:'60'}, history:[], price:'', paid:'', status:'Ready' },
    { id:'demo-4', name:'David Okafor', phone:'0705 222 1100', gender:'Male', category:'Shirt', date:'Sep 27', initial:'D', startDate:'', deliveryDate:'', unit:'in', notes:'French cuff.', measurements:{Chest:'40',Shoulder:'17',Sleeve:'24',Length:'29',Waist:'34',Neck:'16'}, history:[], price:'', paid:'', status:'In progress' }
  ];

  const templates = {
    femaleTop:['Bust','Waist','Hip','Shoulder','Top Length','Full Length','Sleeve Length','Sleeve Round'],
    femaleTrouser:['Trouser Length','Lap (Thigh)','Ankle'],
    maleTop:['Chest','Waist / Stomach','Top Length','Shoulder','Back','Sleeve','Neck'],
    maleTrouser:['Trouser Length','Lap (Thigh)','Ankle'],
    dress:['Bust','Waist','Hip','Shoulder','Top Length','Full Length','Sleeve Length','Sleeve Round'],
    native:['Chest','Waist / Stomach','Top Length','Shoulder','Back','Sleeve','Neck','Trouser Length','Lap (Thigh)','Ankle'],
    shirt:['Neck','Chest','Shoulder','Back','Sleeve','Shirt Length','Waist / Stomach'],
    trouser:['Waist / Stomach','Hip','Lap (Thigh)','Knee','Inseam','Trouser Length','Ankle'],
    agbada:['Chest','Shoulder','Sleeve','Agbada Length','Trouser Waist','Trouser Length','Lap (Thigh)','Ankle']
  };
  const requiredMeasurementFields = {
    Female:['Bust','Waist','Hip','Shoulder','Full Length'],
    Male:['Chest','Waist / Stomach','Shoulder','Top Length']
  };
  const commonCustom = ['Neck','Armhole','Bicep','Wrist','Back Length','Front Length'];

  const tonePresets = [
    {id:'classic',name:'Classic Bell',notes:[660,880,1046],type:'sine'},
    {id:'urgent',name:'Urgent Pulse',notes:[740,740,980,980],type:'square'},
    {id:'double',name:'Double Alert',notes:[520,780,520,780],type:'triangle'},
    {id:'rising',name:'Rising Signal',notes:[440,554,659,880],type:'sine'},
    {id:'bright',name:'Bright Chime',notes:[784,988,1174],type:'sine'},
    {id:'deep',name:'Deep Guard',notes:[220,330,220],type:'triangle'},
    {id:'rapid',name:'Rapid Warning',notes:[880,660,880,660,880],type:'square'},
    {id:'soft',name:'Soft Reminder',notes:[523,659,784],type:'sine'}
  ];

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  let customers = [];
  let selectedCustomer = null;
  let currentTemplate = 'dress';
  let currentUnit = localStorage.getItem('sewza_unit') || 'in';
  let audioContext = null;
  let reminderTimer = null;
  let searchTimer = null;
  let dbPromise = null;
  let isDemo = false;
  let currentUser = null;
  let currentProfile = null;
  let savingCustomer = false;
  let avatarRemoveRequested = false; // profile picture taken away, waiting for "Save profile"

  const defaultSettings = {
    theme:'sewza', textTheme:'classic', alarmEnabled:false, alarmTime:'08:00', tone:'classic',
    cloudStatus:'Local only', lastSync:null
  };
  let settings = {...defaultSettings, ...safeJSON(localStorage.getItem(SETTINGS_KEY), {})};

  function safeJSON(value, fallback) { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } }
  // A bad connection must never show a raw browser message such as "Failed to fetch".
  // Every network problem is shown to the person as "Internet failed" instead.
  const NETWORK_ERROR_RE=/failed to (fetch|catch)|fetch failed|load failed|networkerror|network request failed|network error|err_internet|err_network|err_name_not_resolved|err_connection|timeout|timed out|authretryablefetcherror/i;
  const INTERNET_FAILED='Internet failed';
  const INTERNET_FAILED_HELP='Please check your connection and try again.';
  function isNetworkError(error){
    if(!error) return false;
    const text=typeof error==='string'?error:`${error.name||''} ${error.message||''}`;
    return NETWORK_ERROR_RE.test(text) || (!navigator.onLine && !!text.trim());
  }
  function networkSafeText(text){ return NETWORK_ERROR_RE.test(String(text||'')) ? `${INTERNET_FAILED}. ${INTERNET_FAILED_HELP}` : text; }
  function escapeHTML(value='') { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function uid(prefix='id') { try { return crypto.randomUUID(); } catch { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,9)}`; } }
  function localDateInputValue(date=new Date()) { const d=new Date(date); const offset=d.getTimezoneOffset(); return new Date(d.getTime()-offset*60000).toISOString().slice(0,10); }
  function parseDateOnly(value) { if(!value) return null; const [y,m,d]=value.split('-').map(Number); return y&&m&&d ? new Date(y,m-1,d) : null; }
  function formatDate(value) { const d=parseDateOnly(value); return d ? d.toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}) : 'Not set'; }
  function formatMoney(value) { const n=Number(value||0); return Number.isFinite(n) && n ? `₦${n.toLocaleString()}` : '₦0'; }
  function normalizeCustomer(c) {
    const legacyPaid=Number(c.paid||0);
    let payments=Array.isArray(c.paymentHistory)?c.paymentHistory:[];
    if(!payments.length && legacyPaid>0){
      const stamp=c.updatedAt||c.createdAt||new Date().toISOString();
      const d=new Date(stamp);
      payments=[{id:'legacy-paid',amount:legacyPaid,date:localDateInputValue(d),time:d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),method:'Existing payment',note:'Imported from previous SEWZA record'}];
    }
    return {...c, id:c.id || uid('customer'), history:Array.isArray(c.history)?c.history:[], measurements:c.measurements||{}, customMeasurements:c.customMeasurements||[], paymentHistory:payments, unit:c.unit||'in', price:c.price||'', paid:legacyPaid, status:c.status||'In progress', fabricWidth:Number(c.fabricWidth)||45};
  }
  function paymentTotal(c){ const history=Array.isArray(c?.paymentHistory)?c.paymentHistory:[]; return history.length?history.reduce((n,p)=>n+Number(p.amount||0),0):Number(c?.paid||0); }
  function balance(c){ return Math.max(0,Number(c?.price||0)-paymentTotal(c)); }
  function nigeriaWhatsAppPhone(phone){
    let digits=String(phone||'').replace(/\D/g,'');
    if(digits.startsWith('00')) digits=digits.slice(2);
    if(digits.startsWith('0')) digits='234'+digits.slice(1);
    if(digits.length===10) digits='234'+digits;
    return digits;
  }
  function whatsappMessage(c, custom=''){
    const bal=balance(c);
    const status=c.status||'In progress';
    return custom || `Hello ${c.name}, this is ${currentProfile?.business_name||'your tailor'} from SEWZA. Your ${c.category||'outfit'} is ${status.toLowerCase()}. Your outstanding balance is ${formatMoney(bal)}. Thank you for choosing us.`;
  }
  function sendWhatsApp(c,message){
    const phone=nigeriaWhatsAppPhone(c?.phone); if(!phone){showToast('No phone number','Add a valid customer phone number first.');return false;}
    const url=`https://wa.me/${phone}?text=${encodeURIComponent(message)}`; window.open(url,'_blank','noopener'); return true;
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    if (!('indexedDB' in window)) return Promise.resolve(null);
    // Wait for migrate.js to carry any data saved under the app's previous name into this database first.
    dbPromise = Promise.resolve(window.__sewzaReady).catch(() => {}).then(() => new Promise(resolve => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => { const db=req.result; if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    }));
    return dbPromise;
  }
  async function idbGet(key) {
    const db=await openDB(); if(!db) return null;
    return new Promise(resolve=>{const tx=db.transaction(STORE,'readonly'); const r=tx.objectStore(STORE).get(key); r.onsuccess=()=>resolve(r.result??null); r.onerror=()=>resolve(null);});
  }
  async function idbSet(key,value) {
    const db=await openDB(); if(!db) return false;
    return new Promise(resolve=>{const tx=db.transaction(STORE,'readwrite'); tx.objectStore(STORE).put(value,key); tx.oncomplete=()=>resolve(true); tx.onerror=()=>resolve(false);});
  }

  function userStorageKey(){
    return currentUser?.id ? `sewza_customers_${currentUser.id}` : null;
  }
  function pendingSyncKey(){
    return currentUser?.id ? `${PENDING_SYNC_PREFIX}${currentUser.id}` : null;
  }
  function pendingDeleteKey(){
    return currentUser?.id ? `${PENDING_DELETE_PREFIX}${currentUser.id}` : null;
  }
  function markPendingSync(){
    const key=pendingSyncKey();
    if(key) localStorage.setItem(key,'1');
  }
  function hasPendingSync(){
    const key=pendingSyncKey();
    return !!(key && localStorage.getItem(key)==='1');
  }
  function queueDelete(id){
    const key=pendingDeleteKey(); if(!key)return;
    const list=safeJSON(localStorage.getItem(key),[]);
    if(!list.includes(id)) list.push(id);
    localStorage.setItem(key,JSON.stringify(list));
    markPendingSync();
  }
  function getQueuedDeletes(){
    const key=pendingDeleteKey();
    return key ? safeJSON(localStorage.getItem(key),[]) : [];
  }
  function clearQueuedDelete(id){
    const key=pendingDeleteKey(); if(!key)return;
    const list=getQueuedDeletes().filter(x=>String(x)!==String(id));
    if(list.length) localStorage.setItem(key,JSON.stringify(list)); else localStorage.removeItem(key);
  }
  async function loadData(includeCloud=true){
    const key=userStorageKey();
    if(!key) return [];
    const stored=await idbGet(key);
    let local=Array.isArray(stored)?stored.map(normalizeCustomer):[];
    if(!local.length){
      const legacy=safeJSON(localStorage.getItem(key),null);
      if(Array.isArray(legacy)){ local=legacy.map(normalizeCustomer); await idbSet(key,local); }
    }
    const client=supabaseClient();
    if(includeCloud && client && currentUser && navigator.onLine && !hasPendingSync()){
      try{
        const {data:rows,error}=await client.from('customers').select('*').eq('user_id',currentUser.id).order('created_at',{ascending:false});
        if(!error && Array.isArray(rows)){
          const ids=rows.map(r=>r.id);
          let measurements=[];
          if(ids.length){ const mr=await client.from('measurements').select('*').eq('user_id',currentUser.id).in('customer_id',ids).order('measured_at',{ascending:false}); if(!mr.error) measurements=mr.data||[]; }
          const grouped={}; measurements.forEach(m=>{(grouped[m.customer_id] ||= []).push(m);});
          local=rows.map(r=>{
            const sets=grouped[r.id]||[]; const latest=sets[0];
            return normalizeCustomer({id:r.id,name:r.name,phone:r.phone,gender:r.gender,category:r.category,date:r.created_at?new Date(r.created_at).toLocaleDateString():'Today',initial:(r.name||'T')[0].toUpperCase(),startDate:r.start_date||'',deliveryDate:r.delivery_date||'',unit:r.unit||'in',notes:r.notes||'',photo:r.photo_url||'',photo_url:r.photo_url||'',price:r.order_price??'',paid:r.amount_paid??'',paymentHistory:Array.isArray(r.payment_history)?r.payment_history:[],status:r.order_status||'In progress',fabricWidth:r.fabric_width||45,measurements:latest?.values||{},customMeasurements:latest?.custom_values||[],history:sets.slice(1,20).map(x=>({date:x.measured_at?.slice(0,10),unit:x.unit,measurements:x.values||{},customMeasurements:x.custom_values||[]})),cloudId:r.id,createdAt:r.created_at,updatedAt:r.updated_at});
          });
          settings.cloudStatus='Synced'; settings.lastSync=new Date().toISOString(); saveSettings();
        }
      }catch(e){ console.warn('SEWZA cloud load skipped:',e); }
    }
    return local;
  }
  // Only one cloud sync runs at a time; a request made mid-sync queues exactly one follow-up run,
  // so rapid saves never create duplicate rows in the cloud.
  let syncRunning=null, syncQueued=false;
  function syncCloudData(){
    if(syncRunning){ syncQueued=true; return syncRunning; }
    syncRunning=(async()=>{
      try{ return await syncCloudDataNow(); }
      finally{
        syncRunning=null;
        if(syncQueued){ syncQueued=false; syncCloudData().then(()=>{updateOfflineBadge();}).catch(()=>{}); }
      }
    })();
    return syncRunning;
  }
  async function syncCloudDataNow(){
    const client=supabaseClient();
    if(!client||!currentUser||!navigator.onLine)return false;
    try{
      // Push deletions first so a removed customer can never be recreated by an old local copy.
      for(const id of getQueuedDeletes()) {
        const {error:measurementError}=await client.from('measurements').delete().eq('customer_id',id).eq('user_id',currentUser.id);
        if(measurementError) throw measurementError;
        const {error:customerError}=await client.from('customers').delete().eq('id',id).eq('user_id',currentUser.id);
        if(customerError) throw customerError;
        try{ await client.storage.from('customer-photos').remove([`${currentUser.id}/${id}/photo.jpg`]); }catch(e){ console.warn('SEWZA photo delete skipped:',e); }
        clearQueuedDelete(id);
      }

      for(const c of customers){
        const cloudId=c.cloudId || c.id || crypto.randomUUID();
        let photoUrl=c.photo_url||c.photo||null;
        // If a photo was captured while offline, upload it now and replace the local data URL with its cloud URL.
        if(typeof photoUrl==='string' && photoUrl.startsWith('data:')){
          try{
            const uploaded=await uploadToBucket('customer-photos',`${currentUser.id}/${cloudId}/photo.jpg`,photoUrl);
            if(uploaded){ photoUrl=uploaded; c.photo=c.photo_url=uploaded; }
          }catch(photoError){ console.warn('SEWZA offline photo sync skipped:',photoError); }
        }
        const row={id:cloudId,user_id:currentUser.id,name:c.name,phone:c.phone||null,gender:c.gender||null,category:c.category||null,photo_url:photoUrl,unit:c.unit||'in',notes:c.notes||null,start_date:c.startDate||null,delivery_date:c.deliveryDate||null,order_price:Number(c.price||0),amount_paid:Number(paymentTotal(c)),order_status:c.status||'In progress',updated_at:new Date().toISOString()};
        const {error}=await client.from('customers').upsert(row,{onConflict:'id'});
        if(error)throw error;
        if(Array.isArray(c.paymentHistory)&&c.paymentHistory.length){
          try{ const paymentUpdate=await client.from('customers').update({payment_history:c.paymentHistory}).eq('id',cloudId).eq('user_id',currentUser.id); if(paymentUpdate.error) console.warn('SEWZA payment history cloud field is not available yet:',paymentUpdate.error); }catch(paymentError){ console.warn('SEWZA payment history cloud field is not available yet:',paymentError); }
        }
        c.cloudId=cloudId;
        // The customer's photo was removed: delete the stored file too (never if a new photo exists).
        if(c.photoRemovePending){
          if(photoUrl) delete c.photoRemovePending;
          else{
            try{
              const {error:removeError}=await client.storage.from('customer-photos').remove([`${currentUser.id}/${cloudId}/photo.jpg`]);
              if(removeError) console.warn('SEWZA photo removal skipped:',removeError); else delete c.photoRemovePending;
            }catch(removeError){ console.warn('SEWZA photo removal skipped:',removeError); }
          }
        }
        const {data:existing}=await client.from('measurements').select('id').eq('customer_id',cloudId).eq('user_id',currentUser.id).order('measured_at',{ascending:false}).limit(1);
        const hasAnyMeasurement=Object.keys(c.measurements||{}).length>0 || (c.customMeasurements||[]).length>0;
        // Measurements are optional: no empty measurement set is stored for a customer saved without any.
        if((!existing?.length && hasAnyMeasurement) || (existing?.length && JSON.stringify(c.measurements||{})!==JSON.stringify(c._lastSyncedMeasurements||{}))){
          const {error:measurementError}=await client.from('measurements').insert({user_id:currentUser.id,customer_id:cloudId,garment_type:c.category||'Dress',unit:c.unit||'in',values:c.measurements||{},custom_values:c.customMeasurements||[],measured_at:new Date().toISOString()});
          if(measurementError)throw measurementError;
          c._lastSyncedMeasurements=c.measurements||{};
        }
      }
      localStorage.removeItem(pendingSyncKey()||'');
      gsSyncSoon();
      settings.cloudStatus='Synced'; settings.lastSync=new Date().toISOString(); saveSettings();
      await idbSet(userStorageKey(),customers);
      try{localStorage.setItem(userStorageKey(),JSON.stringify(customers));}catch{}
      return true;
    }catch(e){
      console.warn('SEWZA cloud sync failed:',e);
      markPendingSync();
      settings.cloudStatus='Local only'; saveSettings();
      return false;
    }
  }
  // Saves on this device only (fast, works offline). Cloud sync is separate.
  async function saveLocal(){
    const key=userStorageKey();
    customers=customers.map(normalizeCustomer);
    if(key){ await idbSet(key,customers); try{localStorage.setItem(key,JSON.stringify(customers));}catch{} }
    markPendingSync();
    updateOfflineBadge();
  }
  // Cloud sync in the background so the screen never waits on the network.
  function syncInBackground(){
    syncCloudData().then(()=>{updateOfflineBadge();}).catch(e=>console.warn('SEWZA background sync skipped:',e));
  }
  async function saveData(){
    await saveLocal();
    await syncCloudData();
  }
  function saveSettings() { localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings)); }

  function getDeliveryStatus(c) {
    if(!c?.deliveryDate) return {key:'none',label:'No delivery date',detail:'Set a delivery date to track this order.',days:null};
    const delivery=parseDateOnly(c.deliveryDate), today=parseDateOnly(localDateInputValue());
    const days=Math.round((delivery-today)/86400000);
    if(days<=0) return {key:'red',label:days===0?'Due today':'Overdue',detail:days===0?'It is time for delivery.':`Delivery was due ${Math.abs(days)} day${Math.abs(days)===1?'':'s'} ago.`,days};
    if(days<=2) return {key:'yellow',label:`${days} day${days===1?'':'s'} left`,detail:'Delivery is approaching.',days};
    return {key:'green',label:`${days} days left`,detail:'Order is on schedule.',days};
  }
  function showToast(title='Saved',msg='Done.') { const t=$('#toast'); if(!t)return; if(NETWORK_ERROR_RE.test(`${title} ${msg}`)){title=INTERNET_FAILED;msg=INTERNET_FAILED_HELP;} t.querySelector('b').textContent=title; t.querySelector('small').textContent=msg; t.classList.add('show'); clearTimeout(showToast.timer); showToast.timer=setTimeout(()=>t.classList.remove('show'),3200); }
  function avatarHTML(c) { return c.photo ? `<img src="${escapeHTML(c.photo)}" alt="">` : escapeHTML(c.initial || c.name?.[0] || 'T'); }

  function updateOfflineBadge() {
    const online=navigator.onLine;
    const label=online ? (settings.cloudStatus==='Synced'?'Cloud synced':'Ready to sync') : 'Offline — saved on this device';
    $$('[data-offline-status]').forEach(el=>{el.textContent=label; el.classList.toggle('offline',!online); el.classList.toggle('synced',online&&settings.cloudStatus==='Synced');});
    const stat=$('#backupStatus'); if(stat) stat.textContent=online ? (settings.cloudStatus==='Synced'?'Synced':'Ready') : 'Offline';
    const sub=$('#backupSub'); if(sub) sub.textContent=online ? (settings.cloudStatus==='Synced'?'Cloud backup connected':'Local data ready for Supabase sync') : 'Changes are safe on this device';
  }

  function renderRecent() {
    const el=$('#recentCustomers'); if(!el)return;
    el.innerHTML=customers.slice(0,5).map(c=>{const s=getDeliveryStatus(c); return `<div class="customer-row" data-customer="${escapeHTML(c.id)}"><div class="customer-avatar">${avatarHTML(c)}</div><div class="customer-info"><b>${escapeHTML(c.name)}</b><small>${escapeHTML(c.category)} · ${escapeHTML(c.phone||'No phone')}</small></div>${s.key!=='none'?`<span class="mini-status ${s.key}" title="${escapeHTML(s.detail)}"></span>`:''}<time>${escapeHTML(c.date||'Today')}</time></div>`;}).join('') || '<div class="empty-state rich"><div class="empty-ico">♙</div><b>No customers yet</b><small>Your customers will appear here as soon as you add them.</small><button class="primary-btn" type="button" data-empty-add>＋ Add your first customer</button></div>';
    $$('#recentCustomers .customer-row').forEach(x=>x.onclick=()=>openProfile(x.dataset.customer));
  }
  function renderCustomers(filter='') {
    const q=filter.trim().toLowerCase();
    const list=customers.filter(c=>{
      const paymentText=(c.paymentHistory||[]).map(p=>`${p.amount||''} ${p.date||''} ${p.time||''} ${p.method||''} ${p.note||''}`).join(' ');
      const measurementText=[...Object.entries(c.measurements||{}),...(c.customMeasurements||[]).map(x=>[x.name,x.value])].flat().join(' ');
      const historyText=(c.history||[]).map(h=>`${h.date||''} ${h.unit||''} ${JSON.stringify(h.measurements||{})} ${JSON.stringify(h.customMeasurements||[])}`).join(' ');
      const haystack=`${c.name} ${c.phone||''} ${c.category||''} ${c.gender||''} ${c.status||''} ${c.notes||''} ${c.startDate||''} ${c.deliveryDate||''} ${c.price||''} ${paymentTotal(c)} ${balance(c)} ${paymentText} ${measurementText} ${historyText}`.toLowerCase();
      return haystack.includes(q);
    });
    const el=$('#customerGrid'); if(!el)return;
    el.innerHTML=list.length ? list.map(c=>{const s=getDeliveryStatus(c); return `<article class="customer-card" data-customer="${escapeHTML(c.id)}"><div class="card-top"><div class="customer-avatar">${avatarHTML(c)}</div><div><h3>${escapeHTML(c.name)}</h3><p>${escapeHTML(c.phone||'No phone number')}</p></div></div><div class="card-meta"><span class="pill">${escapeHTML(c.category)}</span><span class="pill">${Object.keys(c.measurements||{}).length + (c.customMeasurements||[]).filter(x=>x.value).length} measurements</span><span class="pill delivery-pill ${s.key}">${s.key==='none'?'No delivery date':`${escapeHTML(s.label)} · ${formatDate(c.deliveryDate)}`}</span></div></article>`;}).join('') : `<div class="panel empty-state" style="grid-column:1/-1"><h3>No customer found</h3><p class="muted">Try another name or add a new customer.</p></div>`;
    $$('#customerGrid .customer-card').forEach(x=>x.onclick=()=>openProfile(x.dataset.customer));
  }
  function updateStats() {
    $('#totalCustomers').textContent=customers.length;
    $('#totalMeasurements').textContent=customers.reduce((n,c)=>n+Object.keys(c.measurements||{}).length+(c.customMeasurements||[]).filter(x=>x.value).length,0);
    const recent=customers.filter(c=>c.createdAt && Date.now()-new Date(c.createdAt).getTime()<7*86400000).length;
    const recentEl=$('#recentCount'); if(recentEl)recentEl.textContent=recent;
    const outstanding=customers.reduce((n,c)=>n+balance(c),0); const outEl=$('#outstandingAmount'); if(outEl)outEl.textContent=formatMoney(outstanding);
  }
  function renderDeliveryDashboard() {
    const scheduled=customers.filter(c=>c.deliveryDate).map(c=>({customer:c,status:getDeliveryStatus(c)})).sort((a,b)=>parseDateOnly(a.customer.deliveryDate)-parseDateOnly(b.customer.deliveryDate));
    const counts={green:scheduled.filter(x=>x.status.key==='green').length,yellow:scheduled.filter(x=>x.status.key==='yellow').length,red:scheduled.filter(x=>x.status.key==='red').length};
    $('#deliverySummary').innerHTML=`<div class="delivery-stat green"><span></span><b>${counts.green}</b><small>On schedule</small></div><div class="delivery-stat yellow"><span></span><b>${counts.yellow}</b><small>Approaching</small></div><div class="delivery-stat red"><span></span><b>${counts.red}</b><small>Due / overdue</small></div>`;
    $('#deliveryList').innerHTML=scheduled.length ? scheduled.slice(0,6).map(({customer:c,status})=>`<button class="delivery-item ${status.key}" data-delivery-customer="${escapeHTML(c.id)}" type="button"><span class="delivery-dot"></span><span class="delivery-item-main"><b>${escapeHTML(c.name)}</b><small>${formatDate(c.deliveryDate)} · ${escapeHTML(status.detail)}</small></span><strong>${escapeHTML(status.label)}</strong></button>`).join('') : '<div class="empty-delivery">No delivery schedules yet.</div>';
    $$('#deliveryList .delivery-item').forEach(x=>x.onclick=()=>openProfile(x.dataset.deliveryCustomer));
    updateAlarmButton();
  }

  function currentGender(){ return $('#measurementGender')?.value || $('#customerGender')?.value || 'Female'; }
  function renderFields(values={}) {
    const gender=values.gender||currentGender();
    const top=gender==='Male'?templates.maleTop:templates.femaleTop;
    const trouser=templates[gender==='Male'?'maleTrouser':'femaleTrouser'];
    const names=[...top,...(document.querySelector('#includeTrouser')?.checked?trouser:[])];
    const custom=(values.customMeasurements||[]).filter(x=>x.name);
    // Every measurement is optional: tailors can save a customer with only the measurements they have.
    const fields=names.map(name=>measurementFieldHTML(name,values.measurements?.[name]||'',values.unit||currentUnit,false)).join('');
    $('#measurementFields').innerHTML=fields;
    $('#customMeasurementFields').innerHTML=custom.map((m,i)=>customFieldHTML(m.name,m.value,m.unit||values.unit||currentUnit,i)).join('');
    updateUnitButtons(values.unit||currentUnit);
    updateGenderButtons(gender);
    renderDraftFabricEstimate();
  }
  function updateGenderButtons(gender){ $$('#measurementGender option').forEach(o=>o.selected=o.value===gender); }
  function measurementFieldHTML(name,value,unit,required=false) { return `<label class="measurement-field ${required?'required-measurement':''}"><span>${escapeHTML(name)} ${required?'<em>Required</em>':''}<small>${escapeHTML(unit)}</small></span><div class="measurement-input"><input inputmode="decimal" data-measure="${escapeHTML(name)}" value="${escapeHTML(value)}" placeholder="e.g. 34.5" ${required?'required':''}><span>${escapeHTML(unit)}</span></div></label>`; }
  function customFieldHTML(name,value,unit,index) { return `<div class="custom-measure-row"><label><span>Measurement name</span><input data-custom-name="${index}" value="${escapeHTML(name)}" placeholder="e.g. Armhole"></label><label><span>Value</span><div class="measurement-input"><input inputmode="decimal" data-custom-value="${index}" value="${escapeHTML(value)}" placeholder="e.g. 16"><span>${escapeHTML(unit)}</span></div></label><button class="icon-danger remove-custom" type="button" data-remove-custom="${index}" aria-label="Remove measurement">×</button></div>`; }
  function updateUnitButtons(unit=currentUnit) { $$('.unit-btn').forEach(b=>b.classList.toggle('active',b.dataset.unit===unit)); $$('#unitLabel').forEach(x=>x.textContent=unit==='in'?'inches':'centimetres'); }
  function setUnit(unit) { currentUnit=unit; localStorage.setItem('sewza_unit',unit); updateUnitButtons(unit); $$('#measurementFields input[data-measure]').forEach(i=>{const unitSpan=i.closest('.measurement-input')?.querySelector('span'); if(unitSpan)unitSpan.textContent=unit;}); $$('#customMeasurementFields .measurement-input span').forEach(s=>s.textContent=unit); }
  function collectMeasurements() {
    const measurements={}; $$('[data-measure]').forEach(i=>{if(i.value.trim())measurements[i.dataset.measure]=i.value.trim();});
    const custom=[]; const rows=$$('#customMeasurementFields .custom-measure-row');
    rows.forEach(row=>{const name=row.querySelector('input[data-custom-name]')?.value.trim();const value=row.querySelector('input[data-custom-value]')?.value.trim();if(name||value)custom.push({name:name||'Custom',value,unit:currentUnit});});
    return {measurements,customMeasurements:custom};
  }

  function resetCustomerForm() {
    const form=$('#customerForm'); form.reset(); delete form.dataset.editingId; clearTimeout(draftTimer);
    $('#startDate').value=localDateInputValue(); $('#deliveryDate').value=localDateInputValue(new Date(Date.now()+7*86400000));
    $('#price').value=''; $('#paid').value=''; $('#orderStatus').value='In progress'; $('#fabricWidth').value='45'; $('#includeTrouser').checked=false; $('#measurementGender').value='Female';
    $('#photoPreview').style.backgroundImage=''; $('#photoPreview').classList.remove('has-photo'); delete $('#photoPreview').dataset.photo; delete $('#photoPreview').dataset.photoRemoved;
    currentTemplate='dress'; $$('.template').forEach(b=>b.classList.toggle('active',b.dataset.template==='dress')); renderStyleOptions('Female'); renderFields();
    $('#formTitle').textContent='Add customer'; $('#formSubtitle').textContent='Create a profile, then save their measurements.';
  }

  async function createCustomer(e) {
    e.preventDefault();
    if(savingCustomer)return; // ignore double taps while the record is being saved
    savingCustomer=true;
    try{ await saveCustomerForm(e); }
    catch(err){ console.error('SEWZA save failed:',err); showToast('Could not save','Please try again.'); }
    finally{ savingCustomer=false; }
  }
  async function saveCustomerForm(e) {
    const form=e.target; const name=$('#customerName').value.trim(); const startDate=$('#startDate').value; const deliveryDate=$('#deliveryDate').value;
    if(!name){showToast('Name required','Please add the customer name.');$('#customerName').focus();return;}
    if(deliveryDate && startDate && parseDateOnly(deliveryDate)<parseDateOnly(startDate)){showToast('Check the dates','Delivery date cannot be before the starting date.');return;}
    const {measurements,customMeasurements}=collectMeasurements(); const editingId=form.dataset.editingId;
    let photo=$('#photoPreview').dataset.photo||'';
    const photoRemoved=$('#photoPreview').dataset.photoRemoved==='1' && !photo; // the photo is optional and can be taken away
    if(editingId){
      const index=customers.findIndex(c=>String(c.id)===String(editingId)); if(index<0)return;
      const old=customers[index];
      const newSet={date:localDateInputValue(),unit:currentUnit,measurements,customMeasurements};
      const history=[...(old.history||[])];
      if(Object.keys(old.measurements||{}).length || (old.customMeasurements||[]).length) history.unshift({date:old.updatedAt||old.createdAt||localDateInputValue(),unit:old.unit||'in',measurements:old.measurements||{},customMeasurements:old.customMeasurements||[]});
      customers[index]={...old,name,phone:$('#customerPhone').value.trim(),gender:$('#customerGender').value,category:$('#customerCategory').value,startDate,deliveryDate,initial:name[0]?.toUpperCase()||'T',measurements,customMeasurements,unit:currentUnit,notes:$('#customerNotes').value.trim(),photo:photoRemoved?'':(photo||old.photo||''),price:$('#price').value.trim(),paid:$('#paid').value.trim(),status:$('#orderStatus').value,paymentHistory:old.paymentHistory||[],fabricWidth:Number($('#fabricWidth').value)||45,history:history.slice(0,20),updatedAt:new Date().toISOString()};
      // A newly chosen photo is kept on the device first and uploaded by the background sync.
      if(photo && photo.startsWith('data:')) customers[index].photo_url='';
      if(photo) delete customers[index].photoRemovePending;
      // A removed photo is cleared here and deleted from cloud storage by the background sync.
      if(photoRemoved){ customers[index].photo_url=''; if(old.photo||old.photo_url) customers[index].photoRemovePending=true; }
      await saveLocal(); selectedCustomer=customers.find(c=>String(c.id)===String(editingId))||customers[index]; refreshUI(); showToast('Profile updated',`${name}'s record was updated.`); openProfile(selectedCustomer.id); discardDraft(); syncInBackground(); return;
    }
    const c=normalizeCustomer({id:uid('customer'),name,phone:$('#customerPhone').value.trim(),gender:$('#customerGender').value,category:$('#customerCategory').value,date:'Today',initial:name[0]?.toUpperCase()||'T',startDate,deliveryDate,measurements,customMeasurements,unit:currentUnit,notes:$('#customerNotes').value.trim(),photo:'',price:$('#price').value.trim(),paid:$('#paid').value.trim(),status:$('#orderStatus').value,paymentHistory:[],fabricWidth:Number($('#fabricWidth').value)||45,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    c.photo=photo;
    customers.unshift(c);
    await saveLocal();
    // The record is on the device now: celebrate straight away, then finish everything else.
    showCelebration();
    refreshUI(); resetCustomerForm(); discardDraft(); openProfile(c.id);
    showToast('Customer saved',navigator.onLine?'Your measurement record is saved.':'Saved on this device. It will sync when you are back online.');
    syncInBackground();
  }

  function refreshUI(){renderRecent();renderCustomers($('#searchInput')?.value||'');updateStats();renderDeliveryDashboard();renderOwingList();renderBusinessCentre();updateOfflineBadge();renderSlideshow();try{renderChecklist();}catch(e){console.warn('SEWZA checklist skipped:',e);}}

  function populateProfile(c) {
    $('#profileAvatar').innerHTML=avatarHTML(c); $('#profileName').textContent=c.name; $('#profileMeta').textContent=`${c.phone||'No phone'} · ${c.category} · ${c.unit==='cm'?'cm':'in'}`; $('#profileDate').textContent=`Updated ${c.updatedAt?new Date(c.updatedAt).toLocaleDateString():(c.date||'today')}`; $('#profileNotes').textContent=c.notes||'No notes yet.';
    const entries=[...Object.entries(c.measurements||{}),...(c.customMeasurements||[]).filter(x=>x.value).map(x=>[x.name,x.value])];
    $('#profileMeasurements').innerHTML=entries.length?entries.map(([k,v])=>`<div class="measure-card"><span>${escapeHTML(k)}</span><b>${escapeHTML(v)}</b><small>${c.unit||'in'}</small></div>`).join(''):'<p class="muted">No measurements saved.</p>';
    if($('#paymentDate'))$('#paymentDate').value=localDateInputValue(); if($('#paymentTime'))$('#paymentTime').value=new Date().toTimeString().slice(0,5); const status=getDeliveryStatus(c); $('#profileDeliveryStatus').className=`status-badge ${status.key}`; $('#profileDeliveryStatus').textContent=status.key==='none'?'No schedule':status.label; $('#profileStartDate').textContent=c.startDate?formatDate(c.startDate):'Not set'; $('#profileDeliveryDate').textContent=c.deliveryDate?formatDate(c.deliveryDate):'Not set'; $('#profileDeliveryMessage').textContent=status.key==='none'?'No delivery date has been set.':`${status.detail} Starting date: ${c.startDate?formatDate(c.startDate):'Not recorded'}.`;
    $('#profilePrice').textContent=formatMoney(c.price); $('#profilePaid').textContent=formatMoney(paymentTotal(c)); $('#profileBalance').textContent=formatMoney(balance(c)); renderPaymentHistory(c); renderFabricEstimate(c); $('#profileOrderStatus').textContent=c.status||'In progress';
    const receiptBtn=$('#receiptBtn'), receiptNote=$('#profileReceiptNote'); const canReceipt=receiptIsAllowed(c); if(receiptBtn){receiptBtn.disabled=!canReceipt;receiptBtn.classList.toggle('is-disabled',!canReceipt);receiptBtn.textContent=canReceipt?'🧾 Send receipt':'✓ Account settled';} if(receiptNote)receiptNote.textContent=canReceipt?'Send an outstanding-payment receipt to the customer.':'No receipt needs to be sent because this customer has no outstanding balance.';
    $('#historyDate').textContent=c.updatedAt?new Date(c.updatedAt).toLocaleDateString():c.date||'Today';
    const hist=$('#measurementHistory'); const history=c.history||[]; hist.innerHTML=history.length?history.map((h,i)=>`<div class="history-item"><span>Previous set ${i+1}</span><b>${formatDate(h.date)}</b><small>${escapeHTML(h.unit||'in')} · ${Object.keys(h.measurements||{}).length+(h.customMeasurements||[]).length} fields</small></div>`).join(''):'<div class="history-item muted-row"><span>Older sets</span><small>They will appear here when measurements are updated.</small></div>';
  }
  function renderPaymentHistory(c){
    const el=$('#paymentHistory'); if(!el)return;
    const list=Array.isArray(c.paymentHistory)?c.paymentHistory:[];
    el.innerHTML=list.length?list.slice().reverse().map(p=>`<div class="payment-row"><div><b>${formatMoney(p.amount)}</b><small>${escapeHTML(p.date||'')} · ${escapeHTML(p.time||'')} · ${escapeHTML(p.method||'Cash')}</small></div><span>${escapeHTML(p.note||'Payment received')}</span></div>`).join(''):'<div class="empty-state compact">No payment history yet. Record the first payment above.</div>';
  }
  function recordPayment(){
    if(!selectedCustomer)return; const amount=Number($('#paymentAmount')?.value||0); if(!amount||amount<=0){showToast('Enter payment','Add a valid payment amount.');return;}
    const c=selectedCustomer; const now=new Date(); const chosenDate=$('#paymentDate')?.value||localDateInputValue(now); const chosenTime=$('#paymentTime')?.value||now.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hour12:false}); const payment={id:uid('payment'),amount,date:chosenDate,time:chosenTime,method:$('#paymentMethod')?.value||'Cash',note:$('#paymentNote')?.value.trim()||''};
    c.paymentHistory=Array.isArray(c.paymentHistory)?c.paymentHistory:[]; c.paymentHistory.push(payment); c.paid=paymentTotal(c); c.updatedAt=now.toISOString();
    saveData().then(()=>{populateProfile(c);refreshUI();$('#paymentAmount').value='';$('#paymentDate').value=localDateInputValue();$('#paymentTime').value=new Date().toTimeString().slice(0,5);$('#paymentNote').value='';showToast('Payment recorded',`${formatMoney(amount)} received from ${c.name}.`);try{window.SEWZA_PUSH?.notifyPayment?.(c.name,amount);}catch{}});
  }
  function owingReminderMessage(c){
    return `Hello ${c.name}, this is ${currentProfile?.business_name||'your tailor'}. Your ${c.category||'outfit'} is ${c.status==='Ready'?'ready for collection':'being prepared'}. Your outstanding balance is *${formatMoney(balance(c))}*. Please complete the balance when convenient. Thank you for choosing us.`;
  }
  function bindOwingActions(rootSelector){
    $$(rootSelector+' [data-owing-call]').forEach(b=>b.onclick=()=>{const c=customers.find(x=>String(x.id)===String(b.dataset.owingCall));if(c?.phone)window.location.href=`tel:${c.phone.replace(/[^+0-9]/g,'')}`;else showToast('No phone number','Add a phone number for this customer.');});
    $$(rootSelector+' [data-owing-wa]').forEach(b=>b.onclick=()=>{const c=customers.find(x=>String(x.id)===String(b.dataset.owingWa));if(c)sendWhatsApp(c,owingReminderMessage(c));});
    $$(rootSelector+' [data-owing-receipt]').forEach(b=>b.onclick=()=>{const c=customers.find(x=>String(x.id)===String(b.dataset.owingReceipt));if(c){selectedCustomer=c;openReceipt();}});
  }
  function owingRowHTML(c,compact=false){
    return `<div class="owing-row ${compact?'compact-owing':''}"><div class="owing-avatar">${avatarHTML(c)}</div><div class="owing-main"><b>${escapeHTML(c.name)}</b><small>${escapeHTML(c.phone||'No phone')} · ${escapeHTML(c.category||'Order')}</small></div><strong>${formatMoney(balance(c))}</strong><div class="owing-actions"><button type="button" class="owing-call" data-owing-call="${escapeHTML(c.id)}">Call</button><button type="button" class="owing-wa" data-owing-wa="${escapeHTML(c.id)}">Reminder</button><button type="button" class="owing-receipt" data-owing-receipt="${escapeHTML(c.id)}">Receipt</button></div></div>`;
  }
  function getOwingCustomers(){return customers.filter(c=>balance(c)>0).sort((a,b)=>balance(b)-balance(a));}
  function renderOwingList(){
    const el=$('#owingList'); if(!el)return; const owing=getOwingCustomers();
    const total=owing.reduce((n,c)=>n+balance(c),0); if($('#owingTotal'))$('#owingTotal').textContent=formatMoney(total);
    el.innerHTML=owing.length?owing.slice(0,8).map(c=>owingRowHTML(c)).join(''):'<div class="empty-state compact">No outstanding balances. Your customers are all settled.</div>';
    bindOwingActions('#owingPanel');
  }
  function renderBusinessCentre(){
    const owing=getOwingCustomers(), total=owing.reduce((n,c)=>n+balance(c),0);
    const today=localDateInputValue();
    const payments=customers.flatMap(c=>(c.paymentHistory||[]).map(p=>({...p,customer:c}))).sort((a,b)=>`${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
    const todayPaid=payments.filter(p=>p.date===today).reduce((n,p)=>n+Number(p.amount||0),0);
    const set=(id,val)=>{const el=$('#'+id);if(el)el.textContent=val;};
    set('businessOutstanding',formatMoney(total)); set('businessOwingCount',owing.length); set('businessTodayPaid',formatMoney(todayPaid)); set('businessOwingTotal',formatMoney(total));
    const list=$('#businessOwingList'); if(list)list.innerHTML=owing.length?owing.map(c=>owingRowHTML(c,true)).join(''):'<div class="empty-state compact">No customers owe you right now.</div>';
    bindOwingActions('#view-business');
    const payEl=$('#businessPaymentList'); if(payEl){const recent=payments.slice(0,10);payEl.innerHTML=recent.length?recent.map(p=>`<div class="business-payment-row"><div><b>${escapeHTML(p.customer.name)}</b><small>${escapeHTML(p.date||'')} · ${escapeHTML(p.time||'')} · ${escapeHTML(p.method||'Cash')}</small></div><strong>${formatMoney(p.amount)}</strong></div>`).join(''):'<div class="empty-state compact">No payments recorded yet.</div>';}
  }

  function receiptIsAllowed(c){ return !!c && balance(c)>0; }
  function openReceipt(){
    if(!selectedCustomer)return;
    if(!receiptIsAllowed(selectedCustomer)){showToast('Receipt not available','This customer has no outstanding balance.');return;}
    renderReceipt(selectedCustomer); $('#receiptModal').classList.add('show'); $('#receiptModal').setAttribute('aria-hidden','false'); saveUIState();
  }
  function closeReceipt(){ $('#receiptModal').classList.remove('show'); $('#receiptModal').setAttribute('aria-hidden','true'); saveUIState(); }
  function receiptHTML(c){
    const profile=currentProfile||{}; const business=profile.business_name||'Your Tailoring Business'; const paid=paymentTotal(c), bal=balance(c);
    const logo=profile.avatar_url||'sewza-mark.png';
    const rows=(c.paymentHistory||[]).slice().reverse().map(p=>`<div class="receipt-line"><span>${escapeHTML(p.date||'')} · ${escapeHTML(p.time||'')} · ${escapeHTML(p.method||'')}</span><b>${formatMoney(p.amount)}</b></div>`).join('');
    return `<div class="receipt-paper"><div class="receipt-brand"><img src="${escapeHTML(logo)}" alt="Business logo"><div><span class="receipt-kicker">PAYMENT RECEIPT</span><h2>${escapeHTML(business)}</h2><small>Customer payment record</small></div></div><div class="receipt-rule"></div><div class="receipt-customer"><b>${escapeHTML(c.name)}</b><span>${escapeHTML(c.phone||'No phone')} · ${escapeHTML(c.category||'Order')}</span></div><div class="receipt-money"><div><span>Order total</span><b>${formatMoney(c.price)}</b></div><div><span>Total paid</span><b>${formatMoney(paid)}</b></div><div class="receipt-balance"><span>Balance due</span><b>${formatMoney(bal)}</b></div></div><div class="receipt-history"><h4>Payment history</h4>${rows||'<p>No payments recorded yet.</p>'}</div><div class="receipt-footer"><strong>Please complete the outstanding balance when convenient.</strong><small>Powered by SEWZA</small></div></div>`;
  }
  function renderReceipt(c){ $('#receiptPreview').innerHTML=receiptHTML(c); }
  function receiptText(c){
    const p=currentProfile?.business_name||'Your Tailoring Business';
    return `*${p} — PAYMENT RECEIPT*\n\nCustomer: ${c.name}\nOrder: ${c.category||'Order'}\nOrder total: ${formatMoney(c.price)}\nTotal paid: ${formatMoney(paymentTotal(c))}\n*Balance due: ${formatMoney(balance(c))}*\nDate: ${new Date().toLocaleDateString()}\n\nThank you for your patronage. Please complete the outstanding balance when convenient.\n\n_Powered by SEWZA_`;
  }
  // Compact receipt image (720px wide, height fits the content) so it is light to share and never overflows.
  async function createReceiptImage(c){
    const W=600, S=1.2, M=48, RIGHT=W-M;
    const payments=(c.paymentHistory||[]).slice().reverse();
    const rowCount=Math.max(1,payments.length);
    const histTop=346, rowsTop=histTop+30, rowStep=26;
    const ruleY=rowsTop+rowCount*rowStep+4;
    const H=ruleY+96;
    const canvas=document.createElement('canvas'); canvas.width=Math.round(W*S); canvas.height=Math.round(H*S);
    const ctx=canvas.getContext('2d'); if(!ctx)throw new Error('Canvas unavailable');
    ctx.scale(S,S);
    const fit=(text,maxW)=>{ let t=String(text??''); if(ctx.measureText(t).width<=maxW)return t; while(t.length>1&&ctx.measureText(t+'…').width>maxW)t=t.slice(0,-1); return t+'…'; };
    ctx.fillStyle='#f3f6f3'; ctx.fillRect(0,0,W,H);
    ctx.fillStyle='#ffffff'; roundRect(ctx,24,24,W-48,H-48,24); ctx.fill();
    const business=currentProfile?.business_name||'Your Tailoring Business';
    const logoSrc=currentProfile?.avatar_url||'sewza-mark.png';
    try{
      const img=await new Promise((resolve,reject)=>{const im=new Image(); if(/^https?:/.test(logoSrc))im.crossOrigin='anonymous'; im.onload=()=>resolve(im); im.onerror=reject; im.src=logoSrc;});
      ctx.save(); roundRect(ctx,M,48,44,44,12); ctx.clip(); ctx.drawImage(img,M,48,44,44); ctx.restore();
    }catch{ctx.fillStyle='#0f766e';roundRect(ctx,M,48,44,44,12);ctx.fill();ctx.fillStyle='#ffffff';ctx.font='800 21px Arial';ctx.textAlign='center';ctx.fillText(business.charAt(0).toUpperCase(),M+22,77);ctx.textAlign='left';}
    ctx.fillStyle='#173126'; ctx.font='700 21px Arial'; ctx.fillText(fit(business,RIGHT-(M+58)),M+58,68);
    ctx.fillStyle='#6a786f'; ctx.font='600 11px Arial'; ctx.fillText('PAYMENT RECEIPT',M+58,88);
    ctx.strokeStyle='#dfe7e1'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(M,112); ctx.lineTo(RIGHT,112); ctx.stroke();
    ctx.fillStyle='#173126'; ctx.font='700 19px Arial'; ctx.fillText(fit(c.name,RIGHT-M),M,144);
    ctx.fillStyle='#6a786f'; ctx.font='500 13px Arial'; ctx.fillText(fit(`${c.phone||'No phone'}  ·  ${c.category||'Order'}`,RIGHT-M),M,166);
    const half=(RIGHT-M-12)/2;
    const boxes=[['ORDER TOTAL',formatMoney(c.price),M,190,half,'#f5f7f4'],['TOTAL PAID',formatMoney(paymentTotal(c)),M+half+12,190,half,'#f5f7f4'],['BALANCE DUE',formatMoney(balance(c)),M,262,RIGHT-M,'#edf8f1']];
    boxes.forEach(([label,value,x,y,w,bg])=>{ctx.fillStyle=bg;roundRect(ctx,x,y,w,62,14);ctx.fill();ctx.fillStyle='#6a786f';ctx.font='700 11px Arial';ctx.fillText(label,x+16,y+22);ctx.fillStyle='#173126';ctx.font='700 21px Arial';ctx.fillText(fit(value,w-32),x+16,y+48);});
    ctx.fillStyle='#173126'; ctx.font='700 16px Arial'; ctx.fillText('Payment history',M,histTop);
    if(!payments.length){ ctx.fillStyle='#6a786f'; ctx.font='500 13px Arial'; ctx.fillText('No payments recorded yet.',M,rowsTop+8); }
    payments.forEach((p,i)=>{
      const y=rowsTop+8+i*rowStep;
      ctx.textAlign='right'; ctx.fillStyle='#173126'; ctx.font='700 13px Arial'; const amount=formatMoney(p.amount); ctx.fillText(amount,RIGHT,y); const amountW=ctx.measureText(amount).width; ctx.textAlign='left';
      ctx.fillStyle='#6a786f'; ctx.font='500 12px Arial'; ctx.fillText(fit(`${p.date||''} · ${p.time||''} · ${p.method||''}`,RIGHT-M-amountW-14),M,y);
    });
    ctx.strokeStyle='#dfe7e1'; ctx.beginPath(); ctx.moveTo(M,ruleY); ctx.lineTo(RIGHT,ruleY); ctx.stroke();
    ctx.textAlign='center'; ctx.fillStyle='#173126'; ctx.font='600 12.5px Arial'; ctx.fillText(fit('Please complete the outstanding balance when convenient.',RIGHT-M),W/2,ruleY+30);
    ctx.fillStyle='#0f766e'; ctx.font='800 13px Arial'; ctx.fillText('Powered by SEWZA',W/2,ruleY+54); ctx.textAlign='left';
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not create receipt image')),'image/png'));
  }

  function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
  async function sendReceiptWhatsApp(){
    if(!selectedCustomer)return;
    if(!receiptIsAllowed(selectedCustomer)){showToast('Receipt not available','This customer has no outstanding balance.');return;}
    const c=selectedCustomer, message=receiptText(c);
    try{
      const blob=await createReceiptImage(c);
      const file=new File([blob],`SEWZA-${c.name.replace(/[^a-z0-9]+/gi,'-')}-receipt.png`,{type:'image/png'});
      if(navigator.canShare?.({files:[file]}) && navigator.share){
        await navigator.share({title:`${currentProfile?.business_name||'SEWZA'} receipt`,text:message,files:[file]});
        showToast('Receipt ready to share','Choose WhatsApp in the share menu.'); return;
      }
    }catch(e){ if(e?.name==='AbortError')return; console.warn('Receipt image share unavailable:',e); }
    sendWhatsApp(c,message); showToast('WhatsApp opened','The receipt message is ready. The visual receipt can be shared from the receipt preview on supported phones.');
  }

  function openProfile(id){selectedCustomer=customers.find(c=>String(c.id)===String(id));if(!selectedCustomer)return;populateProfile(selectedCustomer);showView('profile');}

  function showView(name){if(name!=='login'&&!currentUser){name='login';}$$('.view').forEach(v=>v.classList.remove('active'));const target=$(`#view-${name}`);if(!target)return;target.classList.add('active');$$('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===name));window.scrollTo({top:0,behavior:'smooth'});if(name==='customers')renderCustomers($('#searchInput')?.value||'');if(name==='business')renderBusinessCentre();if(name==='dashboard'){refreshUI();checkDeliveryReminders();}if(name==='calculator')calcOnShow();saveUIState({scrollY:0});}

  function editProfile(){if(!selectedCustomer)return;showView('add');setAddMode('single');$('#formTitle').textContent='Edit customer';$('#formSubtitle').textContent='Update details or save a new measurement set.';const c=selectedCustomer;$('#customerName').value=c.name;$('#customerPhone').value=c.phone||'';$('#customerGender').value=c.gender||'Female';renderStyleOptions(c.gender||'Female',c.category||'Dress / Gown');$('#customerCategory').value=c.category||'Dress / Gown'; if(!$('#customerCategory').value)$('#customerCategory').value='Custom';$('#customerNotes').value=c.notes||'';$('#startDate').value=c.startDate||localDateInputValue();$('#deliveryDate').value=c.deliveryDate||'';$('#price').value=c.price||'';$('#paid').value=paymentTotal(c)||'';$('#orderStatus').value=c.status||'In progress';$('#fabricWidth').value=c.fabricWidth||45;$('#measurementGender').value=c.gender||'Female';$('#includeTrouser').checked=Object.keys(c.measurements||{}).some(k=>/Trouser|Lap|Ankle|Thigh/i.test(k));$('#customerForm').dataset.editingId=c.id;currentUnit=c.unit||'in';currentTemplate=templateForCategory(c.category);$$('.template').forEach(b=>b.classList.toggle('active',b.dataset.template===currentTemplate));renderFields(c);{const pv=$('#photoPreview');pv.style.backgroundImage='';pv.classList.remove('has-photo');delete pv.dataset.photo;delete pv.dataset.photoRemoved;const pi=$('#customerPhoto');if(pi)pi.value='';}if(c.photo){$('#photoPreview').dataset.photo=c.photo;$('#photoPreview').style.backgroundImage=`url("${c.photo}")`;$('#photoPreview').classList.add('has-photo');}}
  function templateForCategory(category){const x=baseCategoryKey(category);if(x.includes('trouser'))return 'trouser';if(x.includes('shirt'))return 'shirt';if(x.includes('native')||x.includes('two-piece'))return 'native';if(x.includes('agbada'))return 'agbada';return 'dress';}

  function numericMeasurements(measurements={}){
    return Object.fromEntries(Object.entries(measurements||{}).map(([k,v])=>[k,Number(String(v).replace(/[^0-9.]/g,''))||0]));
  }
  function estimateFabricYards(c={}){
    const m=numericMeasurements(c.measurements||{});
    const width=Number(c.fabricWidth)||45;
    const g=String(c.gender||'Female');
    const cat=baseCategoryKey(c.category);
    const full=m['Full Length']||m['Agbada Length']||m['Length']||m['Top Length']||m['Shirt Length']||0;
    const hip=m.Hip||m.Chest||m.Bust||m['Waist / Stomach']||0;
    const sleeve=m['Sleeve Length']||m.Sleeve||0;
    const trouser=m['Trouser Length']||0;
    const flare=cat.includes('flare');
    const twoPiece=cat.includes('two-piece')||cat.includes('two piece');
    const native=cat.includes('native');
    const agbada=cat.includes('agbada');
    const shirt=cat.includes('shirt');
    const trouserOnly=cat.includes('trouser');
    const skirt=cat.includes('skirt');
    let yards=0,label='Garment',confidence='Planning estimate';
    if(agbada){
      yards=(width<=45?6.0:5.0)+(full>48?.5:0)+(hip>=46?.5:0); label='Agbada set';
    } else if(flare){
      yards=(width<=45?4.0:3.0)+(hip>=42?.5:0)+(hip>=50?.5:0)+(full>55?.5:0); label='Flare gown';
    } else if(cat.includes('gown')||cat.includes('dress')){
      yards=(width<=45?3.25:2.5)+(full>55?.5:0)+(sleeve>20?.25:0)+(hip>=46?.25:0); label='Dress / gown';
    } else if(native){
      yards=(width<=45?3.5:2.75)+(trouser>40?.5:0)+(hip>=46?.25:0); label='Native wear';
    } else if(twoPiece){
      yards=(width<=45?3.75:3.0)+(trouser>40?.5:0)+(full>45?.25:0); label='Two-piece';
    } else if(trouserOnly){
      yards=width<=45?2.25:1.75; label='Trousers';
    } else if(shirt){
      yards=width<=45?2.25:1.75; label='Shirt';
    } else if(skirt){
      yards=(width<=45?2.0:1.5)+(hip>=44?.5:0)+(full>35?.5:0); label='Skirt';
    } else {
      yards=(width<=45?3.0:2.4)+(g==='Female'&&full>50?.5:0); label='Custom garment';
    }
    return {yards:Math.max(.5,Math.ceil(yards*2)/2),label:styleDisplayLabel(c.category)||label,width,confidence};
  }
  function draftCustomerForFabric(){
    const {measurements,customMeasurements}=collectMeasurements();
    return {gender:currentGender(),category:$('#customerCategory')?.value||'Dress / Gown',fabricWidth:Number($('#fabricWidth')?.value)||45,measurements,customMeasurements};
  }
  function renderDraftFabricEstimate(){
    const title=$('#draftFabricTitle'), text=$('#draftFabricText'), badge=$('#draftFabricYards');
    if(!title||!text||!badge)return;
    const c=draftCustomerForFabric();
    const hasValues=Object.values(c.measurements).some(Boolean);
    if(!hasValues){title.textContent='Add the key measurements to estimate fabric';text.textContent='Choose the garment style and enter the measurements. SEWZA will show an approximate yardage before you save.';badge.textContent='— yards';return;}
    const e=estimateFabricYards(c);
    title.textContent=`Approximately ${e.yards} yards may be needed`;
    text.textContent=`${e.label} · ${e.width}" fabric width. This is a planning estimate; allow extra for shrinkage, print matching, lining and cutting style.`;
    badge.textContent=`${e.yards} yd`;
  }
  function renderFabricEstimate(c){
    const el=$('#fabricEstimate'); if(!el)return;
    const e=estimateFabricYards(c);
    el.innerHTML=`<div class="fabric-estimate-icon">✂</div><div><span class="eyebrow">SMART FABRIC GUIDE</span><b>Approximately ${e.yards} yards</b><small>${escapeHTML(e.label)} · ${e.width}" fabric width</small><p>Planning estimate only. Add extra for shrinkage, print matching, lining, pleats and cutting style.</p></div>`;
  }

  function showCelebration(){const modal=$('#celebration'),confetti=$('#confetti');confetti.innerHTML='';for(let i=0;i<32;i++){const piece=document.createElement('i');piece.style.setProperty('--x',`${Math.random()*260-130}px`);piece.style.setProperty('--y',`${Math.random()*220-120}px`);piece.style.setProperty('--r',`${Math.random()*720-360}deg`);piece.style.setProperty('--d',`${Math.random()*.7}s`);confetti.appendChild(piece);}modal.classList.add('show');modal.setAttribute('aria-hidden','false');}
  function closeCelebration(){$('#celebration').classList.remove('show');$('#celebration').setAttribute('aria-hidden','true');}

  function setTheme(theme){settings.theme=theme;document.body.dataset.theme=theme;saveSettings();$$('[data-theme-choice]').forEach(b=>b.classList.toggle('active',b.dataset.themeChoice===theme));}
  function setTextTheme(theme){settings.textTheme=theme;document.body.dataset.textTheme=theme;saveSettings();$$('button[data-text-theme]').forEach(b=>b.classList.toggle('active',b.dataset.textTheme===theme));}
  function isAlarmEnabled(){return !!settings.alarmEnabled;}
  function setAlarmEnabled(enabled){settings.alarmEnabled=enabled;saveSettings();if(enabled){unlockAudio();requestNotificationPermission();showToast('Delivery alarms enabled','SEWZA will remind you while the app is open.');}else showToast('Delivery alarms paused','You can turn them on again anytime.');updateAlarmButton();}
  function updateAlarmButton(){const b=$('#alarmBtn');if(b){b.textContent=isAlarmEnabled()?'🔔 Alarms on':'🔔 Enable alarms';b.classList.toggle('alarm-active',isAlarmEnabled());}const h=$('#helpAlarmToggle');if(h){h.classList.toggle('on',isAlarmEnabled());h.querySelector('b').textContent=isAlarmEnabled()?'On':'Off';}}
  async function requestNotificationPermission(){if(!('Notification'in window))return;if(Notification.permission==='default'){try{await Notification.requestPermission();}catch{}}}
  function unlockAudio(){try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;if(!audioContext)audioContext=new C();if(audioContext.state==='suspended')audioContext.resume();}catch{}}
  function playTone(id=settings.tone){try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;if(!audioContext)audioContext=new C();const tone=tonePresets.find(t=>t.id===id)||tonePresets[0],now=audioContext.currentTime;tone.notes.forEach((freq,i)=>{const o=audioContext.createOscillator(),g=audioContext.createGain(),start=now+i*.19;o.type=tone.type;o.frequency.setValueAtTime(freq,start);g.gain.setValueAtTime(.0001,start);g.gain.exponentialRampToValueAtTime(.12,start+.025);g.gain.exponentialRampToValueAtTime(.0001,start+.16);o.connect(g);g.connect(audioContext.destination);o.start(start);o.stop(start+.18);});}catch{}}
  function shouldRingNow(c){const s=getDeliveryStatus(c);if(!c.deliveryDate||s.key!=='red')return false;if(s.days<0)return true;const now=new Date(),[h,m]=(settings.alarmTime||'08:00').split(':').map(Number);return now.getHours()>h||(now.getHours()===h&&now.getMinutes()>=m);}
  function showDeliveryReminder(c){$('#reminderTitle').textContent=getDeliveryStatus(c).days===0?`It is time for ${c.name}'s delivery`:`${c.name}'s delivery is overdue`;$('#reminderText').textContent=`Delivery date: ${formatDate(c.deliveryDate)}. Check the order and contact the customer if needed.`;$('#reminderModal').classList.add('show');$('#reminderModal').setAttribute('aria-hidden','false');playTone(settings.tone);if('Notification'in window&&Notification.permission==='granted'){try{new Notification('SEWZA delivery reminder',{body:`It is time for ${c.name}'s delivery.`,tag:`sewza-${c.id}-${c.deliveryDate}`});}catch{}}}
  function closeReminder(){$('#reminderModal').classList.remove('show');$('#reminderModal').setAttribute('aria-hidden','true');}
  function checkDeliveryReminders(){if(!isAlarmEnabled())return;customers.filter(shouldRingNow).forEach(c=>{const key=`sewza_alerted_${c.id}_${c.deliveryDate}`;if(localStorage.getItem(key)!=='1'){localStorage.setItem(key,'1');showDeliveryReminder(c);}});}
  function startReminderClock(){clearInterval(reminderTimer);reminderTimer=setInterval(()=>{renderDeliveryDashboard();if($('#view-dashboard').classList.contains('active'))renderRecent();checkDeliveryReminders();},30000);}

  function renderTones(){const list=$('#toneList');if(!list)return;list.innerHTML=tonePresets.map(t=>`<label class="tone-option ${t.id===settings.tone?'selected':''}"><input type="radio" name="sewzaTone" value="${t.id}" ${t.id===settings.tone?'checked':''}/><span class="tone-copy"><b>${escapeHTML(t.name)}</b><small>Built-in reminder sound</small></span><button type="button" class="tone-preview" data-tone-preview="${t.id}">▶</button></label>`).join('');$$('input[name="sewzaTone"]').forEach(i=>i.onchange=()=>{settings.tone=i.value;saveSettings();renderTones();playTone(settings.tone);});$$('[data-tone-preview]').forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();unlockAudio();playTone(b.dataset.tonePreview);});}

  function exportData(){const payload={app:'SEWZA',version:2,exportedAt:new Date().toISOString(),customers};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`sewza-backup-${localDateInputValue()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);showToast('Backup exported','Your records were exported as a JSON backup.');}
  function importData(file){if(!file)return;const r=new FileReader();r.onload=async()=>{try{const payload=JSON.parse(r.result);const incoming=Array.isArray(payload)?payload:payload.customers;if(!Array.isArray(incoming))throw new Error('Invalid backup');customers=incoming.map(normalizeCustomer);await saveData();refreshUI();showToast('Backup restored',`${customers.length} customer records are now available offline.`);}catch{showToast('Import failed','That backup file is not a valid SEWZA export.');}};r.readAsText(file);}
  function downloadCSV(){const rows=[['Name','Phone','Category','Unit','Delivery date','Price','Paid','Balance','Status','Measurements']];customers.forEach(c=>rows.push([c.name,c.phone,c.category,c.unit,c.deliveryDate,c.price,c.paid,balance(c),c.status,Object.entries(c.measurements||{}).map(([k,v])=>`${k}: ${v} ${c.unit}`).join('; ')]));const csv=rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');const blob=new Blob([csv],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`sewza-customers-${localDateInputValue()}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}

  async function deleteProfile(){
    if(!selectedCustomer)return;
    const ok=window.confirm(`Delete ${selectedCustomer.name}'s customer profile?\n\nThis will remove the customer, measurements and customer photo from your SEWZA cloud workspace too.`);
    if(!ok)return;
    const target=selectedCustomer;
    const name=target.name;
    const cloudId=target.cloudId||target.id;
    customers=customers.filter(c=>String(c.id)!==String(target.id));
    if(currentUser && cloudId) queueDelete(cloudId);
    selectedCustomer=null;
    await saveData();
    refreshUI();
    showView('customers');
    showToast('Profile deleted',navigator.onLine?`${name}'s profile and cloud data were removed.`:`${name}'s profile was removed locally and will be deleted from the cloud when you reconnect.`);
  }

  // Supabase-ready adapter hooks. The actual connection is intentionally separate so this ZIP stays runnable offline.
  window.SEWZA = window.SEWZA || {};
  window.SEWZA.getData = () => customers.map(normalizeCustomer);
  window.SEWZA.replaceData = async data => {customers=(Array.isArray(data)?data:[]).map(normalizeCustomer);await saveData();refreshUI();};
  window.SEWZA.markCloudSynced = () => {settings.cloudStatus='Synced';settings.lastSync=new Date().toISOString();saveSettings();updateOfflineBadge();};
  window.SEWZA.getSettings = () => ({...settings});


  function supabaseClient(){
    return window.SEWZA_SUPABASE?.client || null;
  }

  // Remember who is signed in on this device so SEWZA opens fully offline (even after the
  // Supabase access token has expired). Cleared on sign out.
  const OFFLINE_USER_KEY='sewza_offline_user';
  function cacheOfflineUser(user,profile){
    try{
      if(!user?.id)return;
      const prev=safeJSON(localStorage.getItem(OFFLINE_USER_KEY),null);
      const hasProfile=profile&&Object.keys(profile).length;
      const keep=!hasProfile&&prev&&prev.id===user.id?prev.profile:null;
      localStorage.setItem(OFFLINE_USER_KEY,JSON.stringify({id:user.id,email:user.email||'',user_metadata:user.user_metadata||{},profile:hasProfile?profile:keep}));
    }catch{}
  }
  function readOfflineUser(){ const d=safeJSON(localStorage.getItem(OFFLINE_USER_KEY),null); return d&&d.id?d:null; }
  function clearOfflineUser(){ try{localStorage.removeItem(OFFLINE_USER_KEY);}catch{} }
  async function restoreOfflineSession(){
    const cached=readOfflineUser(); if(!cached)return false;
    await activateUserSession({id:cached.id,email:cached.email,user_metadata:cached.user_metadata||{}},cached.profile||{});
    return true;
  }

  function setAuthMessage(message='', isError=false){
    const el=$('#authMessage');
    if(!el)return;
    el.textContent=networkSafeText(message);
    el.classList.toggle('error',!!isError);
    el.classList.toggle('success',!isError && !!message);
  }

  function setAuthMode(signUp){
    const form=$('#loginForm');
    const fields=$('#signupFields');
    const submit=$('#authSubmitBtn');
    const toggle=$('#authToggleBtn');
    const title=$('#authTitle');
    const eyebrow=$('#authEyebrow');
    const subtitle=$('#authSubtitle');
    const pass=$('#loginPassword');
    const forgot=$('#forgotPasswordBtn');
    if(!fields||!submit||!toggle||!title||!eyebrow||!subtitle)return;

    form?.classList.toggle('signup-mode',!!signUp);
    fields.hidden=!signUp;
    $('#signupName')?.toggleAttribute('required',!!signUp);
    $('#signupBusiness')?.toggleAttribute('required',!!signUp);
    if(pass) pass.autocomplete=signUp?'new-password':'current-password';
    const passLbl=$('#passLabelText'); if(passLbl) passLbl.textContent=signUp?'Create password':'Password';
    if(pass) pass.placeholder=signUp?'Create a password (at least 6 characters)':'Enter your password';

    if(signUp){
      eyebrow.textContent='GET STARTED';
      title.textContent='Create your SEWZA account';
      subtitle.textContent='Your new workspace starts clean and private.';
      submit.innerHTML='Create account <span>→</span>';
      toggle.textContent='Already have an account? Sign in';
      if(forgot)forgot.hidden=true;
      setAuthMessage('');
    }else{
      eyebrow.textContent='WELCOME BACK';
      title.textContent='Sign in to SEWZA';
      subtitle.textContent='Continue to your tailoring workspace.';
      submit.innerHTML='Sign in <span>→</span>';
      toggle.textContent='New to SEWZA? Create an account';
      if(forgot)forgot.hidden=false;
      setAuthMessage('');
    }
    setTimeout(()=>$('#loginEmail')?.focus(),120);
  }

  async function ensureProfile(user, businessNameOverride=''){
    const client=supabaseClient();
    if(!client||!user)return null;
    const metadata=user.user_metadata||{};
    const fullName=metadata.full_name||metadata.name||'';
    const businessName=businessNameOverride.trim()||metadata.business_name||'';
    const payload={
      id:user.id,
      full_name:fullName,
      business_name:businessName,
      updated_at:new Date().toISOString()
    };
    const {data,error}=await client.from('profiles').upsert(payload,{onConflict:'id'}).select().single();
    if(error){
      console.warn('SEWZA: profile setup failed.',error.message);
      return {full_name:fullName,business_name:businessName};
    }
    return data;
  }

  async function getProfile(user){
    const client=supabaseClient();
    if(!client||!user)return null;
    const {data,error}=await client.from('profiles').select('full_name,business_name,avatar_url,plan').eq('id',user.id).maybeSingle();
    if(error){
      console.warn('SEWZA: profile fetch failed.',error.message);
      return null;
    }
    return data;
  }

  async function uploadToBucket(bucket,path,fileOrDataUrl){
    const client=supabaseClient(); if(!client||!currentUser)return null;
    let file=fileOrDataUrl;
    if(typeof fileOrDataUrl==='string' && fileOrDataUrl.startsWith('data:')){ const blob=await (await fetch(fileOrDataUrl)).blob(); file=new File([blob],path.split('/').pop()||'upload.jpg',{type:blob.type||'image/jpeg'}); }
    const {error}=await client.storage.from(bucket).upload(path,file,{upsert:true,contentType:file.type||'image/jpeg'});
    if(error)throw error;
    const {data}=client.storage.from(bucket).getPublicUrl(path);
    return data?.publicUrl||null;
  }

  async function saveProfileSettings(){
    if(!currentUser)return;
    const client=supabaseClient(); if(!client)return;
    const fullName=$('#accountFullName')?.value.trim()||'';
    const businessName=$('#accountBusinessName')?.value.trim()||'';
    const file=$('#accountAvatarInput')?.files?.[0];
    let avatar=currentProfile?.avatar_url||'';
    const removeAvatar=avatarRemoveRequested && !file;
    if(file){ if(file.size>5*1024*1024){showToast('Image too large','Choose a profile photo under 5MB.');return;} avatar=await uploadToBucket('profile-avatars',`${currentUser.id}/avatar.jpg`,file); }
    else if(removeAvatar){ avatar=''; }
    const {data,error}=await client.from('profiles').upsert({id:currentUser.id,full_name:fullName,business_name:businessName,avatar_url:avatar||null,updated_at:new Date().toISOString()},{onConflict:'id'}).select().single();
    if(error)throw error; currentProfile=data;
    if(removeAvatar){ avatarRemoveRequested=false; try{ await client.storage.from('profile-avatars').remove([`${currentUser.id}/avatar.jpg`]); }catch(e){ console.warn('SEWZA avatar removal skipped:',e); } } updateSignedInUser(currentUser,currentProfile); renderAccountPanel(); showToast('Profile updated','Your SEWZA profile has been saved.');
  }
  function renderAccountPanel(){
    const p=currentProfile||{}, m=currentUser?.user_metadata||{};
    const full=p.full_name||m.full_name||''; const biz=p.business_name||m.business_name||'';
    $('#accountFullName')?.setAttribute('value',full); $('#accountBusinessName')?.setAttribute('value',biz);
    const name=$('#accountDisplayName'); if(name)name.textContent=biz||full||currentUser?.email||'SEWZA';
    const email=$('#accountEmail'); if(email)email.textContent=currentUser?.email||''; const side=$('#accountEmailSide'); if(side)side.textContent=currentUser?.email||'';
    avatarRemoveRequested=false;
    const img=$('#accountAvatarPreview'); if(img){ if(p.avatar_url){img.style.backgroundImage=`url("${p.avatar_url}")`;img.classList.add('has-photo');img.textContent='';} else {img.style.backgroundImage='';img.classList.remove('has-photo');img.textContent=(biz||full||'S').charAt(0).toUpperCase();} }
  }

  function updateSignedInUser(user,profile=null){
    if(!user)return;
    const metadata=user.user_metadata||{};
    const business=(profile?.business_name||metadata.business_name||'').trim();
    const fullName=(profile?.full_name||metadata.full_name||metadata.name||'').trim();
    const display=business||fullName||user.email?.split('@')[0]||'SEWZA';
    const initial=(business||fullName||'S').trim().charAt(0).toUpperCase();
    const profileName=$('#profileBusinessName');
    const avatar=$('#profileAvatarTop');
    const dashboardTitle=$('#view-dashboard h1');
    if(profileName)profileName.textContent=display;
    if(avatar){ if(profile?.avatar_url){avatar.innerHTML=`<img src="${escapeHTML(profile.avatar_url)}" alt=""/>`;} else avatar.textContent=initial; }
    { // mirror the profile picture + email into the main menu
      const mAv=$('#menuAvatar'), mEm=$('#menuEmail');
      if(mAv){ if(profile?.avatar_url){mAv.innerHTML=`<img src="${escapeHTML(profile.avatar_url)}" alt=""/>`;} else mAv.textContent=initial; }
      if(mEm)mEm.textContent=user.email||'';
    }
    if(dashboardTitle)dashboardTitle.textContent=`${isNewAccount()?'Welcome':'Welcome back'}, ${display}.`;
    try{ renderSlideshow(); }catch(e){ console.warn('SEWZA slideshow skipped:',e); }
  }

  async function activateUserSession(user, profile=null){
    currentUser=user;
    currentProfile=profile||{};
    isDemo=false;
    cacheOfflineUser(user,currentProfile);

    // Open local data first so returning users see their workspace immediately.
    restoreDepth++;
    try{
      customers=await loadData(false);
      selectedCustomer=null;
      updateSignedInUser(user,currentProfile);
      refreshUI();
      resetCustomerForm();
      loadCalcState();
      await restoreWorkspace();
      updateOfflineBadge();
    }finally{ restoreDepth--; }
    saveUIState();
    if(!navigator.onLine) onboardingCheck();

    // Profile and cloud data finish in the background after the UI is visible.
    if(!profile){
      getProfile(user).then(p=>{
        if(!p || currentUser?.id!==user.id)return;
        currentProfile=p;
        cacheOfflineUser(user,p);
        updateSignedInUser(user,p);
      }).catch(e=>console.warn('SEWZA profile load skipped:',e));
    }
    if(navigator.onLine){
      loadData(true).then(fresh=>{
        if(currentUser?.id!==user.id)return;
        customers=fresh;
        repointSelection();
        refreshUI();
        updateOfflineBadge();
        onboardingCheck();
      }).catch(e=>{ console.warn('SEWZA cloud load skipped:',e); onboardingCheck(); });
      if(hasPendingSync()) syncCloudData().then(()=>refreshUI()).catch(e=>console.warn('SEWZA background sync skipped:',e));
      gsSyncSoon();
    }
  }

  function friendlyAuthError(error, signUp=false){
    if(isNetworkError(error))return `${INTERNET_FAILED}. ${INTERNET_FAILED_HELP}`;
    const msg=String(error?.message||'').toLowerCase();
    if(msg.includes('invalid login credentials'))return 'Incorrect email or password. Please try again.';
    if(msg.includes('user already registered')||msg.includes('already been registered'))return 'An account with this email already exists. Please sign in instead.';
    if(msg.includes('password')&&msg.includes('6'))return 'Your password must be at least 6 characters.';
    if(msg.includes('email'))return 'Please enter a valid email address.';
    if(msg.includes('rate limit'))return 'Too many attempts. Please wait a moment and try again.';
    if(msg.includes('email not confirmed'))return 'This account still needs email confirmation. Turn off email confirmation in Supabase Authentication settings, then try again.';
    return error?.message|| (signUp?'We could not create your account. Please try again.':'We could not sign you in. Please try again.');
  }

  function signOut(){
    if(currentUser?.email){ try{localStorage.setItem('sewza_last_email',currentUser.email);}catch{} }
    const client=supabaseClient(); currentUser=null; currentProfile=null; customers=[]; selectedCustomer=null;
    if(client) client.auth.signOut().catch(()=>{});
    $('#loginEmail').value=localStorage.getItem('sewza_last_email')||'';
    $('#loginPassword').value=''; setAuthMode(false); showView('login');
    showToast('Signed out','Your email is remembered. Enter your password to sign back in.');
  }

  async function handleAuthSubmit(e){
    e.preventDefault();
    const client=supabaseClient();
    if(!client){
      // The sign-in library is downloaded from the internet, so a missing client usually means a bad connection.
      setAuthMessage(navigator.onLine&&window.supabase?'SEWZA could not connect to Supabase. Check your configuration and refresh.':`${INTERNET_FAILED}. ${INTERNET_FAILED_HELP}`,true);
      return;
    }

    const email=$('#loginEmail')?.value.trim().toLowerCase();
    const password=$('#loginPassword')?.value||'';
    const signUp=!$('#signupFields')?.hidden;
    const submit=$('#authSubmitBtn');

    if(!email||!password){
      setAuthMessage('Enter your email and password to continue.',true);
      return;
    }
    if(password.length<6){
      setAuthMessage('Your password must be at least 6 characters.',true);
      return;
    }
    if(!navigator.onLine){
      setAuthMessage('Internet failed. Connect to the internet to sign in. Once signed in on this device, SEWZA opens offline.',true);
      return;
    }

    let fullName='',businessName='';
    if(signUp){
      fullName=$('#signupName')?.value.trim()||'';
      businessName=$('#signupBusiness')?.value.trim()||'';
      if(!fullName||!businessName){
        setAuthMessage('Enter your full name and business name.',true);
        return;
      }
    }

    if(submit){submit.disabled=true;submit.innerHTML=signUp?'Creating your workspace…':'Signing you in…';}
    setAuthMessage(signUp?'Creating your secure SEWZA workspace…':'Checking your account…');

    try{
      if(signUp){
        const {data,error}=await client.auth.signUp({
          email,
          password,
          options:{data:{full_name:fullName,business_name:businessName}}
        });
        if(error)throw error;

        // With Supabase email confirmation disabled, a session is returned immediately.
        if(!data.session||!data.user){
          throw new Error('Your SEWZA account was created, but Supabase is waiting for email confirmation. Disable "Confirm email" in Supabase Authentication settings so users can enter SEWZA immediately after signup.');
        }

        const profile=await ensureProfile(data.user,businessName);
        await activateUserSession(data.user,profile);
        showToast('Workspace created',`${businessName} is ready.`);
        $('#loginForm')?.reset();
      }else{
        const {data,error}=await client.auth.signInWithPassword({email,password});
        if(error)throw error;
        if(!data.user)throw new Error('No active account session was returned.');
        const profile=await getProfile(data.user)||await ensureProfile(data.user);
        await activateUserSession(data.user,profile);
        showToast('Welcome back',`Opening ${profile?.business_name||'your workspace'}.`);
        $('#loginForm')?.reset();
      }
    }catch(error){
      console.error('SEWZA authentication error:',error);
      setAuthMessage(friendlyAuthError(error,signUp),true);
    }finally{
      if(submit){
        submit.disabled=false;
        submit.innerHTML=signUp?'Create account <span>→</span>':'Sign in <span>→</span>';
      }
    }
  }

  // =====================================================================
  // Password reset with a code: email -> code from Gmail -> new password
  // =====================================================================
  let rsHold=false;           // true from "code verified" until the new password is saved or cancelled
  let rsStep=1, rsLen=6, rsTimer=null, rsBusy=false, rsEmailValue='';
  const RS_COOLDOWN=60;

  function rsMsg(text='',isError=false){
    const el=$('#rsMessage'); if(!el)return;
    el.textContent=networkSafeText(text);
    el.classList.toggle('error',!!isError);
    el.classList.toggle('success',!isError&&!!text);
  }
  function rsFriendly(error){
    if(isNetworkError(error))return `${INTERNET_FAILED}. ${INTERNET_FAILED_HELP}`;
    const msg=String(error?.message||'').toLowerCase();
    const secs=msg.match(/(\d+)\s*second/);
    if(secs&&(msg.includes('only request')||msg.includes('security purposes')))return `Please wait ${secs[1]} seconds before asking for another code.`;
    if(msg.includes('rate limit')||msg.includes('too many'))return 'Too many attempts. Please wait a few minutes and try again.';
    if(msg.includes('expired')||msg.includes('invalid'))return 'That code is not right or has expired. Check it and try again, or ask for a new one.';
    if(msg.includes('same')&&msg.includes('password'))return 'Your new password must be different from your old one.';
    if(msg.includes('password')&&(msg.includes('6')||msg.includes('weak')||msg.includes('short')))return 'Your password must be at least 6 characters.';
    if(msg.includes('email'))return 'Please enter a valid email address.';
    return error?.message||'Something went wrong. Please try again.';
  }
  function rsShowStep(n){
    rsStep=n;
    const card=$('#resetCard'); if(!card)return;
    [...card.querySelectorAll('.rs-pane')].forEach(p=>{
      const on=Number(p.dataset.step)===n;
      p.hidden=!on;
      if(on){ p.classList.remove('rs-in'); void p.offsetWidth; p.classList.add('rs-in'); }
    });
    const steps=$('#rsSteps'); if(steps){ steps.dataset.step=String(Math.min(n,3)); steps.classList.toggle('rs-all',n===4); }
    rsMsg('');
  }
  function rsOpen(){
    const login=$('#loginForm'),card=$('#resetCard'); if(!login||!card)return;
    rsEmailValue=($('#loginEmail')?.value||'').trim().toLowerCase();
    $('#rsEmail').value=rsEmailValue;
    login.hidden=true; card.hidden=false;
    rsBuildCode(6); rsClearPass(); rsShowStep(1);
    setTimeout(()=>$('#rsEmail')?.focus(),150);
  }
  async function rsClose(){
    const client=supabaseClient();
    clearInterval(rsTimer); rsTimer=null;
    // A code that was verified created a temporary session: end it so the user must sign in normally.
    if(rsHold&&client){ try{ await client.auth.signOut(); }catch{} }
    rsHold=false; rsBusy=false;
    const login=$('#loginForm'),card=$('#resetCard');
    if(card)card.hidden=true; if(login)login.hidden=false;
    if(rsEmailValue&&$('#loginEmail')&&!$('#loginEmail').value)$('#loginEmail').value=rsEmailValue;
    setAuthMessage('');
    setTimeout(()=>$('#loginEmail')?.focus(),120);
  }
  function rsClearPass(){
    ['#rsNewPass','#rsNewPass2'].forEach(id=>{const i=$(id); if(i){i.value='';i.type='password';}});
    $$('[data-rs-show]').forEach(b=>b.textContent='Show');
    rsMeter(''); rsMatchCheck();
  }
  function rsCooldown(){
    const btn=$('#rsResendBtn'); if(!btn)return;
    clearInterval(rsTimer);
    let left=RS_COOLDOWN; btn.disabled=true; btn.textContent=`Resend code in ${left}s`;
    rsTimer=setInterval(()=>{
      left--;
      if(left<=0){clearInterval(rsTimer);rsTimer=null;btn.disabled=false;btn.textContent='Resend code';}
      else btn.textContent=`Resend code in ${left}s`;
    },1000);
  }
  async function rsSendCode(isResend=false){
    if(rsBusy)return;
    const client=supabaseClient();
    const email=($('#rsEmail')?.value||'').trim().toLowerCase();
    if(!client){rsMsg(navigator.onLine&&window.supabase?'SEWZA could not connect to Supabase.':`${INTERNET_FAILED}. ${INTERNET_FAILED_HELP}`,true);return;}
    if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){rsMsg('Enter the email address you signed up with.',true);$('#rsEmail')?.focus();return;}
    if(!navigator.onLine){rsMsg(`${INTERNET_FAILED}. ${INTERNET_FAILED_HELP}`,true);return;}
    rsBusy=true;
    const btn=$('#rsSendBtn'); const old=btn?btn.innerHTML:'';
    if(btn&&!isResend){btn.disabled=true;btn.innerHTML='Sending your code…';}
    rsMsg(isResend?'Sending a new code…':'');
    try{
      const {error}=await client.auth.resetPasswordForEmail(email);
      if(error)throw error;
      rsEmailValue=email;
      $('#rsSentTo').textContent=email;
      rsBuildCode(rsLen);
      rsShowStep(2);
      rsCooldown();
      rsMsg(isResend?'A new code is on its way.':'Code sent. It can take a minute to arrive.',false);
      setTimeout(()=>$$('#rsCode input')[0]?.focus(),200);
    }catch(error){
      console.error('SEWZA password reset error:',error);
      rsMsg(rsFriendly(error),true);
    }finally{
      rsBusy=false;
      if(btn){btn.disabled=false;btn.innerHTML=old;}
    }
  }

  // --- code boxes ---
  function rsBuildCode(n){
    const wrap=$('#rsCode'); if(!wrap)return;
    rsLen=Math.max(6,Math.min(10,n));
    wrap.style.setProperty('--n',rsLen);
    wrap.innerHTML='';
    for(let i=0;i<rsLen;i++){
      const inp=document.createElement('input');
      inp.type='text'; inp.inputMode='numeric'; inp.maxLength=1; inp.pattern='[0-9]*';
      inp.autocomplete=i===0?'one-time-code':'off';
      inp.setAttribute('aria-label',`Digit ${i+1}`);
      inp.style.setProperty('--i',i);
      wrap.appendChild(inp);
    }
  }
  function rsCodeValue(){ return $$('#rsCode input').map(i=>i.value).join(''); }
  function rsCodeFill(digits){
    const d=String(digits||'').replace(/\D/g,'').slice(0,10);
    if(d.length>rsLen) rsBuildCode(d.length);
    const boxes=$$('#rsCode input');
    boxes.forEach((b,i)=>{b.value=d[i]||'';b.classList.toggle('filled',!!b.value);});
    const next=Math.min(d.length,boxes.length-1);
    boxes[next]?.focus();
    return d;
  }
  function rsBindCode(){
    const wrap=$('#rsCode'); if(!wrap)return;
    wrap.addEventListener('input',e=>{
      const t=e.target; if(!(t instanceof HTMLInputElement))return;
      const boxes=$$('#rsCode input'); const i=boxes.indexOf(t);
      const v=t.value.replace(/\D/g,'');
      if(v.length>1){ // autofill from the keyboard / SMS-style suggestion
        rsCodeFill(v); rsMaybeAuto(); return;
      }
      t.value=v; t.classList.toggle('filled',!!v);
      wrap.classList.remove('rs-bad');
      if(v&&i<boxes.length-1)boxes[i+1].focus();
      rsMaybeAuto();
    });
    wrap.addEventListener('keydown',e=>{
      const t=e.target; if(!(t instanceof HTMLInputElement))return;
      const boxes=$$('#rsCode input'); const i=boxes.indexOf(t);
      if(e.key==='Backspace'&&!t.value&&i>0){boxes[i-1].value='';boxes[i-1].classList.remove('filled');boxes[i-1].focus();e.preventDefault();}
      else if(e.key==='ArrowLeft'&&i>0){boxes[i-1].focus();e.preventDefault();}
      else if(e.key==='ArrowRight'&&i<boxes.length-1){boxes[i+1].focus();e.preventDefault();}
    });
    wrap.addEventListener('paste',e=>{
      const txt=(e.clipboardData||window.clipboardData)?.getData('text')||'';
      if(!/\d/.test(txt))return;
      e.preventDefault(); rsCodeFill(txt); rsMaybeAuto();
    });
    wrap.addEventListener('focusin',e=>{ if(e.target instanceof HTMLInputElement)e.target.select(); });
  }
  let rsAutoTimer=null;
  function rsMaybeAuto(){
    clearTimeout(rsAutoTimer);
    if(rsCodeValue().length===rsLen) rsAutoTimer=setTimeout(()=>rsVerify(),250);
  }
  async function rsVerify(){
    if(rsBusy)return;
    const client=supabaseClient(); const code=rsCodeValue();
    if(!client){rsMsg(`${INTERNET_FAILED}. ${INTERNET_FAILED_HELP}`,true);return;}
    if(code.length<rsLen){rsMsg(`Enter all ${rsLen} digits of your code.`,true);$$('#rsCode input').find(i=>!i.value)?.focus();return;}
    if(!navigator.onLine){rsMsg(`${INTERNET_FAILED}. ${INTERNET_FAILED_HELP}`,true);return;}
    rsBusy=true; rsHold=true;
    const btn=$('#rsVerifyBtn'); const old=btn?btn.innerHTML:'';
    if(btn){btn.disabled=true;btn.innerHTML='Checking your code…';}
    rsMsg('');
    try{
      const {data,error}=await client.auth.verifyOtp({email:rsEmailValue,token:code,type:'recovery'});
      if(error)throw error;
      if(!data?.session)throw new Error('The code could not be confirmed. Please try again.');
      $('#rsCode')?.classList.add('rs-ok');
      await new Promise(r=>setTimeout(r,450));
      rsShowStep(3);
      setTimeout(()=>$('#rsNewPass')?.focus(),200);
    }catch(error){
      rsHold=false;
      console.error('SEWZA code verification error:',error);
      const w=$('#rsCode'); if(w){w.classList.remove('rs-bad');void w.offsetWidth;w.classList.add('rs-bad');}
      $$('#rsCode input').forEach(i=>{i.value='';i.classList.remove('filled');});
      $$('#rsCode input')[0]?.focus();
      rsMsg(rsFriendly(error),true);
    }finally{
      rsBusy=false;
      if(btn){btn.disabled=false;btn.innerHTML=old;}
    }
  }

  // --- new password ---
  function rsMeter(pw){
    const m=$('#rsMeter'),t=$('#rsMeterText'); if(!m||!t)return;
    let score=0;
    if(pw.length>=6)score++;
    if(pw.length>=9)score++;
    if(/[a-z]/.test(pw)&&/[A-Z]/.test(pw))score++;
    if(/\d/.test(pw)&&/[^A-Za-z0-9]/.test(pw)||pw.length>=12)score++;
    if(!pw)score=0;
    else if(pw.length<6)score=1;
    m.dataset.level=String(score);
    t.textContent=['Enter a password','Too short or weak','Okay','Good','Strong'][pw&&pw.length<6?1:score]||'';
    if(pw&&pw.length<6)t.textContent='Too short — use at least 6 characters';
  }
  function rsMatchCheck(){
    const a=$('#rsNewPass')?.value||'',b=$('#rsNewPass2')?.value||'',el=$('#rsMatch'); if(!el)return true;
    if(!b){el.textContent='';el.className='rs-match';return false;}
    const ok=a===b;
    el.textContent=ok?'✓ Passwords match':'Passwords do not match yet';
    el.className='rs-match '+(ok?'ok':'bad');
    return ok;
  }
  async function rsSavePassword(){
    if(rsBusy)return;
    const client=supabaseClient();
    const a=$('#rsNewPass')?.value||'',b=$('#rsNewPass2')?.value||'';
    if(!client){rsMsg(`${INTERNET_FAILED}. ${INTERNET_FAILED_HELP}`,true);return;}
    if(a.length<6){rsMsg('Your password must be at least 6 characters.',true);$('#rsNewPass')?.focus();return;}
    if(a!==b){rsMsg('The two passwords do not match.',true);$('#rsNewPass2')?.focus();return;}
    if(!navigator.onLine){rsMsg(`${INTERNET_FAILED}. ${INTERNET_FAILED_HELP}`,true);return;}
    rsBusy=true;
    const btn=$('#rsSaveBtn'); const old=btn?btn.innerHTML:'';
    if(btn){btn.disabled=true;btn.innerHTML='Saving…';}
    rsMsg('');
    try{
      const {data,error}=await client.auth.updateUser({password:a});
      if(error)throw error;
      const user=data?.user||(await client.auth.getUser())?.data?.user;
      if(!user)throw new Error('Your password was saved, but we could not open your session. Please sign in with your new password.');
      rsShowStep(4);
      await new Promise(r=>setTimeout(r,1700));
      const profile=await getProfile(user)||await ensureProfile(user);
      rsHold=false;
      await activateUserSession(user,profile);
      showToast('Password updated',`Welcome back. Opening ${profile?.business_name||'your workspace'}.`);
      const card=$('#resetCard'),login=$('#loginForm');
      if(card)card.hidden=true; if(login)login.hidden=false;
      rsClearPass(); rsBuildCode(6); $('#loginForm')?.reset();
    }catch(error){
      console.error('SEWZA new password error:',error);
      if(rsStep===4)rsShowStep(3);
      rsMsg(rsFriendly(error),true);
    }finally{
      rsBusy=false;
      if(btn){btn.disabled=false;btn.innerHTML=old;}
    }
  }

  function bindPasswordReset(){
    $('#forgotPasswordBtn')?.addEventListener('click',rsOpen);
    $('#rsPane1')?.addEventListener('submit',e=>{e.preventDefault();rsSendCode(false);});
    $('#rsPane2')?.addEventListener('submit',e=>{e.preventDefault();rsVerify();});
    $('#rsPane3')?.addEventListener('submit',e=>{e.preventDefault();rsSavePassword();});
    $('#rsResendBtn')?.addEventListener('click',()=>rsSendCode(true));
    $('#rsChangeEmailBtn')?.addEventListener('click',()=>{clearInterval(rsTimer);rsTimer=null;rsBuildCode(rsLen);rsShowStep(1);$('#rsEmail')?.focus();});
    $('#rsBackBtn')?.addEventListener('click',rsClose);
    $('#rsNewPass')?.addEventListener('input',e=>{rsMeter(e.target.value);rsMatchCheck();});
    $('#rsNewPass2')?.addEventListener('input',rsMatchCheck);
    $$('[data-rs-show]').forEach(b=>b.addEventListener('click',()=>{
      const i=document.getElementById(b.dataset.rsShow); if(!i)return;
      i.type=i.type==='password'?'text':'password'; b.textContent=i.type==='password'?'Show':'Hide';
    }));
    rsBindCode();
  }

  async function signOut(){
    const client=supabaseClient();
    if(client){
      let signOutError=null;
      try{ ({error:signOutError}=await client.auth.signOut()); }catch(e){ signOutError=e; }
      if(signOutError){
        console.error('SEWZA sign out error:',signOutError);
        if(isNetworkError(signOutError)) showToast(INTERNET_FAILED,INTERNET_FAILED_HELP);
        else showToast('Sign out failed',signOutError.message);
        return;
      }
    }
    clearOfflineUser();
    currentUser=null;
    currentProfile=null;
    customers=[];
    isDemo=false;
    refreshUI();
    showView('login');
    setAuthMode(false);
    setAuthMessage('You have been signed out.');
  }

  async function restoreAuthSession(){
    const client=supabaseClient();
    // Supabase library unavailable (offline cold start): open the saved workspace for this device.
    if(!client){ if(!(await restoreOfflineSession())) showView('login'); return; }
    let data=null,error=null;
    try{
      const timeout=new Promise(resolve=>setTimeout(()=>resolve({data:null,error:{name:'AuthRetryableFetchError',message:'timeout'}}),6000));
      ({data,error}=await Promise.race([client.auth.getSession(),timeout]));
    }catch(e){ error=e; }
    const networkProblem=!navigator.onLine||error?.name==='AuthRetryableFetchError'||/fetch|network|timeout/i.test(String(error?.message||''));
    if(data?.session?.user){
      await activateUserSession(data.session.user);
    }else if(networkProblem && await restoreOfflineSession()){
      // Offline: the saved workspace is open; sync resumes automatically when the connection returns.
    }else if(error){
      console.error('SEWZA session check failed:',error);
      showView('login');
      return;
    }else{
      clearOfflineUser();
      currentUser=null;
      currentProfile=null;
      customers=[];
      refreshUI();
      showView('login');
    }

    client.auth.onAuthStateChange(async (event,session)=>{
      if(event==='SIGNED_IN'&&session?.user){
        if(rsHold) return; // password reset in progress: stay on the reset page until a new password is saved
        if(currentUser?.id===session.user.id){ quietCloudRefresh(); return; }
        await activateUserSession(session.user);
      }
      if(event==='SIGNED_OUT'){
        clearOfflineUser();
        currentUser=null;
        currentProfile=null;
        customers=[];
        refreshUI();
        showView('login');
      }
    });
  }

  // =====================================================================
  // v7 — resume where the user left off + animated Calculator
  // =====================================================================
  const UI_STATE_KEY='sewza_ui_state_v1';
  const DRAFT_PREFIX='sewza_draft_';
  const CALC_KEY_PREFIX='sewza_calc_v1_';
  let restoreDepth=0;          // >0 while the workspace is being restored: nothing is saved meanwhile
  let draftArmed=false;        // true once the user has touched the form
  let draftTimer=null;
  let scrollSaveTimer=null;
  let calcSaveTimer=null;

  async function idbDel(key){
    const db=await openDB(); if(!db) return false;
    return new Promise(resolve=>{const tx=db.transaction(STORE,'readwrite'); tx.objectStore(STORE).delete(key); tx.oncomplete=()=>resolve(true); tx.onerror=()=>resolve(false);});
  }

  // ---------- where the user was ----------
  function uiKey(){ return currentUser?.id ? `${UI_STATE_KEY}_${currentUser.id}` : null; }
  function currentViewName(){ const v=document.querySelector('.view.active'); return v ? v.id.replace(/^view-/,'') : ''; }
  function saveUIState(override={}){
    if(restoreDepth>0 || !currentUser) return;
    const key=uiKey(), view=currentViewName();
    if(!key || !view || view==='login') return;
    const receiptOpen=!!$('#receiptModal')?.classList.contains('show');
    const st={
      view,
      customerId:(view==='profile'||receiptOpen)?(selectedCustomer?.id||''):'',
      receiptCustomerId:receiptOpen?(selectedCustomer?.id||''):'',
      scrollY:Math.max(0,Math.round(window.scrollY||0)),
      t:Date.now(), ...override
    };
    try{ localStorage.setItem(key,JSON.stringify(st)); }catch{}
  }
  function onScrollSave(){ clearTimeout(scrollSaveTimer); scrollSaveTimer=setTimeout(()=>saveUIState(),300); }

  // ---------- unfinished "Add customer" form ----------
  function draftKey(){ return currentUser?.id ? `${DRAFT_PREFIX}customer_${currentUser.id}` : null; }
  function snapshotCustomerForm(){
    const form=$('#customerForm'); const {measurements,customMeasurements}=collectMeasurements();
    return {
      v:1, editingId:form.dataset.editingId||'', name:$('#customerName').value.trim(), phone:$('#customerPhone').value.trim(),
      gender:$('#customerGender').value, measGender:$('#measurementGender').value, category:$('#customerCategory').value,
      startDate:$('#startDate').value, deliveryDate:$('#deliveryDate').value, fabricWidth:Number($('#fabricWidth').value)||45,
      includeTrouser:$('#includeTrouser').checked, unit:currentUnit, measurements, customMeasurements,
      price:$('#price').value.trim(), paid:$('#paid').value.trim(), status:$('#orderStatus').value,
      notes:$('#customerNotes').value, photo:$('#photoPreview').dataset.photo||'', photoRemoved:$('#photoPreview').dataset.photoRemoved==='1', template:currentTemplate
    };
  }
  function draftIsBlank(s){
    return !s.editingId && !s.name && !s.phone && !s.notes && !s.price && !s.paid && !s.photo &&
      !Object.keys(s.measurements||{}).length && !(s.customMeasurements||[]).some(x=>x.name||x.value);
  }
  function scheduleDraftSave(){
    if(!currentUser || restoreDepth>0) return;
    draftArmed=true; clearTimeout(draftTimer); draftTimer=setTimeout(writeDraft,350);
  }
  function writeDraft(){
    clearTimeout(draftTimer);
    const key=draftKey(); if(!key||!currentUser||!draftArmed) return;
    let snap; try{ snap=snapshotCustomerForm(); }catch{ return; }
    if(draftIsBlank(snap)){ try{localStorage.removeItem(key);}catch{} idbDel(key); return; }
    snap.savedAt=Date.now();
    try{ localStorage.setItem(key,JSON.stringify(snap,(k,v)=>(typeof v==='string'&&v.startsWith('data:'))?'':v)); }catch{} // instant text copy
    idbSet(key,snap);                                                                                                   // full copy with photo
  }
  function discardDraft(){
    clearTimeout(draftTimer); draftArmed=false;
    const key=draftKey(); if(!key) return;
    try{localStorage.removeItem(key);}catch{}
    idbDel(key);
  }
  async function loadDraft(){
    const key=draftKey(); if(!key) return null;
    const a=await idbGet(key); const b=safeJSON(localStorage.getItem(key),null);
    let d=a||b;
    if(a&&b&&(b.savedAt||0)>(a.savedAt||0)) d={...b, photo:b.photo||(a.editingId===b.editingId?a.photo:'')||''};
    return d&&d.v ? d : null;
  }
  function applyCustomerDraft(s){
    resetCustomerForm();
    const form=$('#customerForm');
    let editingId=s.editingId||'';
    if(editingId && !customers.some(c=>String(c.id)===String(editingId))) editingId='';
    if(editingId){ form.dataset.editingId=editingId; $('#formTitle').textContent='Edit customer'; $('#formSubtitle').textContent='Update details or save a new measurement set.'; }
    $('#customerName').value=s.name||''; $('#customerPhone').value=s.phone||'';
    const g=['Female','Male','Other'].includes(s.gender)?s.gender:'Female';
    $('#customerGender').value=g;
    renderStyleOptions(g,s.category);
    $('#measurementGender').value=(s.measGender!==undefined&&s.measGender!==null)?s.measGender:(g==='Other'?'':g);
    if([...$('#customerCategory').options].some(o=>o.value===s.category)) $('#customerCategory').value=s.category;
    $('#startDate').value=s.startDate||''; $('#deliveryDate').value=s.deliveryDate||'';
    $('#fabricWidth').value=String(s.fabricWidth===60?60:45); $('#includeTrouser').checked=!!s.includeTrouser;
    $('#price').value=s.price||''; $('#paid').value=s.paid||''; $('#orderStatus').value=s.status||'In progress'; $('#customerNotes').value=s.notes||'';
    currentUnit=s.unit==='cm'?'cm':'in'; try{localStorage.setItem('sewza_unit',currentUnit);}catch{}
    currentTemplate=s.template||'dress'; $$('.template').forEach(b=>b.classList.toggle('active',b.dataset.template===currentTemplate));
    renderFields({gender:currentGender(),unit:currentUnit,measurements:s.measurements||{},customMeasurements:s.customMeasurements||[]});
    if(s.photo){ const pv=$('#photoPreview'); pv.dataset.photo=s.photo; pv.style.backgroundImage=`url("${s.photo}")`; pv.classList.add('has-photo'); }
    else if(s.photoRemoved){ $('#photoPreview').dataset.photoRemoved='1'; }
    draftArmed=true;
  }

  // ---------- reopening the app ----------
  async function restoreWorkspace(){
    const key=uiKey(); const st=key?safeJSON(localStorage.getItem(key),null):null;
    try{ const d=await loadDraft(); if(d) applyCustomerDraft(d); }catch(e){ console.warn('SEWZA draft restore skipped:',e); }
    let view=st?.view||'dashboard';
    const valid=['dashboard','customers','add','profile','business','calculator','themes','help','account'];
    if(!valid.includes(view)) view='dashboard';
    if(view==='profile'){
      const c=customers.find(x=>String(x.id)===String(st.customerId));
      if(c) openProfile(c.id); else view='customers';
    }
    if(view!=='profile'){ if(view==='account') renderAccountPanel(); showView(view); }
    if(st?.receiptCustomerId){
      const c=customers.find(x=>String(x.id)===String(st.receiptCustomerId));
      if(c && receiptIsAllowed(c)){ selectedCustomer=c; openReceipt(); }
    }
    if(st?.scrollY>0) setTimeout(()=>window.scrollTo({top:st.scrollY,behavior:'instant'}),140);
  }
  // After a cloud refresh the customer objects are replaced; keep the open profile pointing at the fresh copy.
  function repointSelection(){
    if(!selectedCustomer) return;
    const f=customers.find(c=>String(c.id)===String(selectedCustomer.id));
    if(!f) return;
    selectedCustomer=f;
    if($('#view-profile')?.classList.contains('active') && !document.activeElement?.closest?.('#view-profile')) populateProfile(f);
  }
  function quietCloudRefresh(){
    if(!currentUser||!navigator.onLine) return;
    const uid0=currentUser.id;
    loadData(true).then(fresh=>{ if(currentUser?.id!==uid0) return; customers=fresh; repointSelection(); refreshUI(); updateOfflineBadge(); }).catch(()=>{});
  }
  function flushEverything(){
    if(draftArmed) writeDraft();
    saveUIState();
    saveCalcStateNow();
  }

  // =====================================================================
  // Calculator
  // =====================================================================
  const calc={tokens:[],done:false,lastExpr:'',error:'',history:[],tab:'calc',cv:{value:'',unit:'in'},quote:{yards:'',price:'',qty:'',sew:'',extra:'',deposit:''}};
  const CALC_LAYOUT=[
    ['AC','fn','AC'],['±','fn','±'],['%','fn','%'],['÷','op','÷'],
    ['7','num','7'],['8','num','8'],['9','num','9'],['×','op','×'],
    ['4','num','4'],['5','num','5'],['6','num','6'],['−','op','−'],
    ['1','num','1'],['2','num','2'],['3','num','3'],['+','op','+'],
    ['0','num','0'],['.','num','.'],['⌫','fn','⌫'],['=','eq','=']
  ];
  const CV_UNITS={in:{f:.0254,l:'in',n:'Inches'},cm:{f:.01,l:'cm',n:'Centimetres'},ft:{f:.3048,l:'ft',n:'Feet'},yd:{f:.9144,l:'yd',n:'Yards'},m:{f:1,l:'m',n:'Metres'}};

  function calcKey(){ return `${CALC_KEY_PREFIX}${currentUser?.id||'guest'}`; }
  function saveCalcStateNow(){
    clearTimeout(calcSaveTimer);
    try{ localStorage.setItem(calcKey(),JSON.stringify({tokens:calc.tokens,done:calc.done,lastExpr:calc.lastExpr,history:calc.history.slice(0,30),tab:calc.tab,cv:calc.cv,quote:calc.quote})); }catch{}
  }
  function saveCalcState(){ clearTimeout(calcSaveTimer); calcSaveTimer=setTimeout(saveCalcStateNow,400); }
  function loadCalcState(){
    const s=safeJSON(localStorage.getItem(calcKey()),null);
    calc.tokens=[]; calc.done=false; calc.lastExpr=''; calc.error=''; calc.history=[]; calc.tab='calc'; calc.cv={value:'',unit:'in'}; calc.quote={yards:'',price:'',qty:'',sew:'',extra:'',deposit:''};
    if(s&&typeof s==='object'){
      if(Array.isArray(s.tokens)&&s.tokens.every(t=>t&&(t.t==='n'||t.t==='o')&&typeof t.v==='string')) calc.tokens=s.tokens;
      calc.done=!!s.done&&calc.tokens.length===1&&calc.tokens[0].t==='n'; calc.lastExpr=String(s.lastExpr||'');
      if(Array.isArray(s.history)) calc.history=s.history.filter(h=>h&&typeof h.expr==='string'&&Number.isFinite(Number(h.raw))).slice(0,30);
      if(['calc','convert','quote'].includes(s.tab)) calc.tab=s.tab;
      if(s.cv&&CV_UNITS[s.cv.unit]) calc.cv={value:String(s.cv.value||''),unit:s.cv.unit};
      if(s.quote) calc.quote={...calc.quote,...Object.fromEntries(Object.keys(calc.quote).map(k=>[k,String(s.quote[k]??'')]))};
    }
    calcSyncInputs(); setCalcTab(calc.tab,true); calcRender(true); calcRenderHistory(); cvRender(); quoteRender(true);
  }

  function groupDigits(s){
    const neg=s.startsWith('-'); const x=neg?s.slice(1):s;
    if(/e/i.test(x)) return s;
    const [i,f]=x.split('.'); const gi=i.replace(/\B(?=(\d{3})+(?!\d))/g,',');
    return (neg?'-':'')+gi+(f!==undefined?'.'+f:'');
  }
  function fmtResult(v){
    if(!Number.isFinite(v)) return '0';
    v=Number(v.toPrecision(12)); if(v===0) return '0';
    const a=Math.abs(v);
    if(a>=1e15||a<1e-9) return v.toExponential(6).replace(/\.?0+e/,'e').replace('e+','e');
    return v.toLocaleString('en-US',{maximumFractionDigits:10});
  }
  function plainNumber(v){ v=Number(v.toPrecision(12)); return Object.is(v,-0)?'0':String(v); }
  function tokensToString(tokens){ return tokens.map(t=>t.t==='n'?groupDigits(t.v)+(t.pct?'%':''):` ${t.v} `).join('').trim(); }
  function calcEval(tokens){
    const t=tokens.slice(); while(t.length&&t[t.length-1].t==='o') t.pop();
    if(!t.length) return {ok:true,value:0};
    const nums=[],ops=[];
    for(let i=0;i<t.length;i++){ if(i%2===0){ if(t[i].t!=='n') return {ok:false,error:'Invalid input'}; nums.push(t[i]); } else { if(t[i].t!=='o') return {ok:false,error:'Invalid input'}; ops.push(t[i].v); } }
    const num=x=>Number(x.v);
    const terms=[]; let curOp='+', curVal=num(nums[0]), curPct=!!nums[0].pct, single=true;
    for(let k=0;k<ops.length;k++){
      const op=ops[k], nx=nums[k+1];
      if(op==='×'||op==='÷'){
        const a=curPct?curVal/100:curVal, b=nx.pct?num(nx)/100:num(nx);
        if(op==='÷'&&b===0) return {ok:false,error:"Can't divide by 0"};
        curVal=op==='×'?a*b:a/b; curPct=false; single=false;
      }else{
        terms.push({op:curOp,val:curVal,pct:curPct&&single});
        curOp=op; curVal=num(nx); curPct=!!nx.pct; single=true;
      }
    }
    terms.push({op:curOp,val:curVal,pct:curPct&&single});
    let total=0;
    terms.forEach((tm,idx)=>{ let v=tm.val; if(tm.pct) v=idx===0?v/100:total*v/100; total=tm.op==='−'?total-v:total+v; });
    if(!Number.isFinite(total)) return {ok:false,error:'Number too large'};
    return {ok:true,value:total};
  }
  function calcPress(key){
    if(calc.error){ calc.error=''; calc.tokens=[]; calc.done=false; calc.lastExpr=''; if(key==='AC'||key==='⌫'){ calcRender(); saveCalcState(); return; } }
    const last=()=>calc.tokens[calc.tokens.length-1];
    if(/^[0-9]$/.test(key)){
      if(calc.done){ calc.tokens=[{t:'n',v:key}]; calc.done=false; }
      else{
        const l=last();
        if(!l||l.t==='o') calc.tokens.push({t:'n',v:key});
        else if(l.pct) return;
        else if(l.v.replace(/[^0-9]/g,'').length>=15) return;
        else if(l.v==='0') l.v=key; else if(l.v==='-0') l.v='-'+key; else l.v+=key;
      }
    }else if(key==='.'){
      if(calc.done){ calc.tokens=[{t:'n',v:'0.'}]; calc.done=false; }
      else{ const l=last(); if(!l||l.t==='o') calc.tokens.push({t:'n',v:'0.'}); else if(l.pct||l.v.includes('.')||/e/i.test(l.v)) return; else l.v+='.'; }
    }else if(key==='+'||key==='−'||key==='×'||key==='÷'){
      calc.done=false;
      const l=last();
      if(!l) calc.tokens.push({t:'n',v:'0'},{t:'o',v:key});
      else if(l.t==='o') l.v=key;
      else{ l.v=l.v.replace(/\.$/,''); calc.tokens.push({t:'o',v:key}); }
    }else if(key==='%'){
      const l=last(); if(!l||l.t!=='n'||l.pct) return; l.v=l.v.replace(/\.$/,''); l.pct=true; calc.done=false;
    }else if(key==='±'){
      const l=last();
      if(!l||l.t==='o'){ calc.tokens.push({t:'n',v:'-0'}); calc.done=false; }
      else if(l.v==='0'&&!calc.done) l.v='-0';
      else l.v=l.v.startsWith('-')?l.v.slice(1):'-'+l.v;
    }else if(key==='⌫'){
      if(calc.done){ calc.tokens=[]; calc.done=false; calc.lastExpr=''; }
      else{
        const l=last(); if(!l){ calcRender(); return; }
        if(l.t==='o') calc.tokens.pop();
        else if(l.pct) l.pct=false;
        else{ l.v=l.v.slice(0,-1); if(l.v===''||l.v==='-') calc.tokens.pop(); }
      }
    }else if(key==='AC'){
      calc.tokens=[]; calc.done=false; calc.lastExpr='';
    }else if(key==='='){
      if(calc.done||!calc.tokens.length){ return; }
      const hasOp=calc.tokens.some(t=>t.t==='o'||t.pct);
      const clean=calc.tokens.map(t=>t.t==='n'?{...t,v:t.v.replace(/\.$/,'')}:t);
      const res=calcEval(clean);
      if(!res.ok){ calc.error=res.error; calc.lastExpr=tokensToString(clean); calcRender(false,true); saveCalcState(); return; }
      if(!hasOp){ return; }
      const exprText=tokensToString(clean.length&&clean[clean.length-1].t==='o'?clean.slice(0,-1):clean);
      const raw=plainNumber(res.value);
      calc.history.unshift({expr:exprText,result:fmtResult(res.value),raw});
      calc.history=calc.history.slice(0,30);
      calc.tokens=[{t:'n',v:raw}]; calc.done=true; calc.lastExpr=exprText;
      calcRender(false,false,true); calcRenderHistory(); saveCalcState(); return;
    }
    calcRender(); saveCalcState();
  }
  function calcRender(silent=false,shake=false,solved=false){
    const exprEl=$('#calcExpr'), resEl=$('#calcResult'); if(!exprEl||!resEl) return;
    let expr='', res='0';
    if(calc.error){ expr=calc.lastExpr; res=calc.error; }
    else if(calc.done&&calc.tokens[0]){ expr=calc.lastExpr+' ='; res=fmtResult(Number(calc.tokens[0].v)); }
    else if(calc.tokens.length){
      expr=tokensToString(calc.tokens);
      const hasOp=calc.tokens.some(t=>t.t==='o'||t.pct);
      const lastNum=[...calc.tokens].reverse().find(t=>t.t==='n');
      if(hasOp){ const r=calcEval(calc.tokens); res=r.ok?fmtResult(r.value):groupDigits(lastNum.v); }
      else res=groupDigits(calc.tokens[0].v)+(calc.tokens[0].pct?'%':'');
      if(!hasOp) expr='';
    }
    const changed=resEl.textContent!==res;
    exprEl.textContent=expr; resEl.textContent=res;
    resEl.className='calc-result'+(res.length>16?' len-lg':res.length>11?' len-md':'')+(calc.error?' is-error':'');
    exprEl.scrollLeft=exprEl.scrollWidth;
    if(!silent){
      if(changed||solved){ resEl.classList.remove('bump','solved'); void resEl.offsetWidth; resEl.classList.add(solved?'solved':'bump'); }
      if(shake){ const c=$('#calcDisplay'); c?.classList.remove('shake'); void c?.offsetWidth; c?.classList.add('shake'); }
    }
    const l=calc.tokens[calc.tokens.length-1];
    $$('#calcKeys .calc-key.k-op').forEach(b=>b.classList.toggle('active',!!(l&&l.t==='o'&&!calc.error&&b.dataset.key===l.v)));
      }
  function calcUseValue(raw){
    calc.error='';
    const l=calc.tokens[calc.tokens.length-1];
    if(calc.done||!l||l.t==='n'&&!calc.tokens.some(t=>t.t==='o')) calc.tokens=[{t:'n',v:raw}];
    else if(l.t==='o') calc.tokens.push({t:'n',v:raw});
    else l.v=raw, l.pct=false;
    calc.done=false; calcRender(); saveCalcState();
  }
  function calcRenderHistory(){
    const el=$('#calcHistory'); if(!el) return;
    el.innerHTML=calc.history.length?calc.history.map((h,i)=>`<button type="button" class="calc-hist-row" data-hist="${i}" style="--d:${Math.min(i,8)*35}ms"><small>${escapeHTML(h.expr)} =</small><b>${escapeHTML(h.result)}</b></button>`).join(''):'<div class="empty-state compact">Your calculations will appear here.</div>';
  }
  function buildCalcKeys(){
    const wrap=$('#calcKeys'); if(!wrap) return;
    wrap.innerHTML=CALC_LAYOUT.map(([label,kind,key],i)=>`<button type="button" class="calc-key k-${kind}" data-key="${key}" style="--k:${i}" aria-label="${key==='⌫'?'Backspace':key==='AC'?'Clear all':key==='±'?'Plus or minus':key==='.'?'Decimal point':key}">${label}</button>`).join('');
    wrap.addEventListener('pointerdown',e=>{
      const b=e.target.closest('.calc-key'); if(!b) return;
      const r=b.getBoundingClientRect(); const s=document.createElement('span'); s.className='ripple';
      const size=Math.max(r.width,r.height)*1.4; s.style.cssText=`width:${size}px;height:${size}px;left:${e.clientX-r.left-size/2}px;top:${e.clientY-r.top-size/2}px`;
      b.appendChild(s); setTimeout(()=>s.remove(),600);
      try{ navigator.vibrate&&navigator.vibrate(8); }catch{}
    });
    wrap.addEventListener('mousedown',e=>{ if(e.target.closest('.calc-key')) e.preventDefault(); }); // keep focus off the keys so the keyboard always reaches the calculator
    wrap.addEventListener('click',e=>{ const b=e.target.closest('.calc-key'); if(b) calcPress(b.dataset.key); });
  }
  function calcKeyboard(e){
    if(currentViewName()!=='calculator'||calc.tab!=='calc') return;
    if(e.ctrlKey||e.metaKey||e.altKey) return;
    const t=e.target;
    if(t&&(t.matches?.('input,textarea,select')||t.isContentEditable)) return;
    if(t?.closest?.('button')&&(e.key==='Enter'||e.key===' ')) return;   // a focused button handles Enter/Space itself
    let k=null;
    if(/^[0-9]$/.test(e.key)) k=e.key; else if(e.key==='.'||e.key===',') k='.';
    else if(e.key==='+') k='+'; else if(e.key==='-') k='−'; else if(e.key==='*'||e.key==='x'||e.key==='X') k='×'; else if(e.key==='/') k='÷';
    else if(e.key==='%') k='%'; else if(e.key==='Enter'||e.key==='=') k='='; else if(e.key==='Backspace') k='⌫'; else if(e.key==='Escape'||e.key==='Delete') k='AC';
    if(!k) return;
    e.preventDefault(); calcPress(k);
    const b=$(`#calcKeys [data-key="${k}"]`); if(b){ b.classList.add('pressed'); setTimeout(()=>b.classList.remove('pressed'),130); }
  }
  function setCalcTab(tab,silent=false){
    if(!['calc','convert','quote'].includes(tab)) tab='calc';
    calc.tab=tab;
    const idx=['calc','convert','quote'].indexOf(tab);
    const tabs=$('#calcTabs'); if(tabs){ tabs.style.setProperty('--i',idx); $$('#calcTabs .seg-btn').forEach(b=>{const on=b.dataset.calcTab===tab; b.classList.toggle('active',on); b.setAttribute('aria-selected',on?'true':'false');}); }
    ['calc','convert','quote'].forEach(p=>$(`#calcPane-${p}`)?.classList.toggle('active',p===tab));
    if(!silent) saveCalcState();
  }
  function calcOnShow(){ try{ if(document.activeElement&&document.activeElement.tagName==='BUTTON') document.activeElement.blur(); }catch{} calcRender(true); calcRenderHistory(); cvRender(); quoteRender(true); }

  // ----- converter -----
  function parseNum(s){ const n=Number(String(s??'').replace(/,/g,'').trim()); return Number.isFinite(n)?n:NaN; }
  function fmtNum(n,dp=4){ if(!Number.isFinite(n)) return '—'; return Number(n.toFixed(dp)).toLocaleString('en-US',{maximumFractionDigits:dp}); }
  function cvRender(){
    const el=$('#cvResults'); if(!el) return;
    $$('#cvUnits .chip').forEach(b=>b.classList.toggle('active',b.dataset.cvUnit===calc.cv.unit));
    const v=parseNum(calc.cv.value), has=String(calc.cv.value).trim()!==''&&Number.isFinite(v);
    const metres=has?v*CV_UNITS[calc.cv.unit].f:NaN;
    el.innerHTML=Object.entries(CV_UNITS).map(([k,u],i)=>{
      const out=has?metres/u.f:NaN, txt=has?fmtNum(out):'—';
      return `<button type="button" class="cv-card${k===calc.cv.unit?' source':''}" data-cv-copy="${has?escapeHTML(String(Number(out.toFixed(4)))+' '+u.l):''}" style="--d:${i*45}ms"><span>${u.n}</span><b>${txt}</b><small>${u.l}</small></button>`;
    }).join('');
  }
  // ----- quote -----
  const QUOTE_FIELDS={yards:'#qYards',price:'#qPrice',qty:'#qQty',sew:'#qSew',extra:'#qExtra',deposit:'#qDeposit'};
  function calcSyncInputs(){
    Object.entries(QUOTE_FIELDS).forEach(([k,sel])=>{ const el=$(sel); if(el) el.value=calc.quote[k]||''; });
    const cv=$('#cvValue'); if(cv) cv.value=calc.cv.value||'';
  }
  function animateTo(el,to,fmt){
    if(!el) return;
    const from=Number(el.dataset.v||0); el.dataset.v=String(to);
    if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches||from===to){ el.textContent=fmt(to); return; }
    const start=performance.now(), dur=420;
    const step=now=>{ const p=Math.min(1,(now-start)/dur), e=1-Math.pow(1-p,3); el.textContent=fmt(from+(to-from)*e); if(p<1&&el.dataset.v===String(to)) requestAnimationFrame(step); else el.textContent=fmt(to); };
    requestAnimationFrame(step);
  }
  function quoteRender(instant=false){
    const el=$('#quoteResult'); if(!el) return;
    const q=calc.quote, n=k=>{ const x=parseNum(q[k]); return Number.isFinite(x)&&x>0?x:0; };
    const yards=n('yards'), price=n('price'), qty=Math.max(1,Math.floor(n('qty'))||1), sew=n('sew'), extra=n('extra'), dep=Math.min(100,n('deposit'));
    const any=yards||price||sew||extra;
    if(!any){ el.innerHTML='<div class="quote-empty"><b>Fill in the numbers above</b><span>Your total, deposit and balance appear here instantly.</span></div>'; return; }
    const per=yards*price+sew+extra, total=per*qty, deposit=total*dep/100, bal=total-deposit, totalYards=yards*qty;
    const row=(k,v)=>`<div class="quote-row"><span>${k}</span><b>${v}</b></div>`;
    const had=el.querySelector('#quoteTotal');
    el.innerHTML=`<div class="quote-total"><span>Quote total</span><b id="quoteTotal" data-v="${had?had.dataset.v:0}">${formatMoney(had?Number(had.dataset.v):0)}</b><small>${qty} outfit${qty===1?'':'s'} · ${formatMoney(per)} each</small></div>
      <div class="quote-rows">${yards?row('Fabric needed',`${fmtNum(totalYards,2)} yards`):''}${yards&&price?row('Fabric cost',formatMoney(yards*price*qty)):''}${sew?row('Sewing',formatMoney(sew*qty)):''}${extra?row('Extras',formatMoney(extra*qty)):''}${dep?row(`Deposit (${fmtNum(dep,2)}%)`,formatMoney(deposit)):''}${dep?row('Balance after deposit',formatMoney(bal)):''}</div>`;
    animateTo($('#quoteTotal'),total,formatMoney);
    if(instant){ const t=$('#quoteTotal'); if(t){ t.dataset.v=String(total); t.textContent=formatMoney(total); } }
  }

  function bindV7(){
    // calculator
    buildCalcKeys();
    $('#calcTabs')?.addEventListener('click',e=>{ const b=e.target.closest('[data-calc-tab]'); if(b) setCalcTab(b.dataset.calcTab); });
    $('#calcHistory')?.addEventListener('click',e=>{ const b=e.target.closest('[data-hist]'); if(!b) return; const h=calc.history[Number(b.dataset.hist)]; if(h) calcUseValue(h.raw); });
    $('#calcClearHistory')?.addEventListener('click',()=>{ calc.history=[]; calcRenderHistory(); saveCalcState(); });
    document.addEventListener('keydown',calcKeyboard);
    $('#cvValue')?.addEventListener('input',e=>{ calc.cv.value=e.target.value; cvRender(); saveCalcState(); });
    $('#cvUnits')?.addEventListener('click',e=>{ const b=e.target.closest('[data-cv-unit]'); if(!b) return; calc.cv.unit=b.dataset.cvUnit; cvRender(); saveCalcState(); });
    $('#cvResults')?.addEventListener('click',e=>{ const b=e.target.closest('[data-cv-copy]'); const t=b?.dataset.cvCopy; if(!t) return; try{ navigator.clipboard?.writeText(t); }catch{} showToast('Copied',t); });
    Object.entries(QUOTE_FIELDS).forEach(([k,sel])=>$(sel)?.addEventListener('input',e=>{ calc.quote[k]=e.target.value; quoteRender(); saveCalcState(); }));
    $('#quoteResetBtn')?.addEventListener('click',()=>{ Object.keys(calc.quote).forEach(k=>calc.quote[k]=''); calcSyncInputs(); quoteRender(true); saveCalcState(); });
    // resume: keep the unfinished Add-customer form
    const f=$('#customerForm');
    ['input','change','click'].forEach(ev=>f?.addEventListener(ev,()=>scheduleDraftSave()));
    $('#customerPhoto')?.addEventListener('change',()=>setTimeout(scheduleDraftSave,400));
    window.addEventListener('scroll',onScrollSave,{passive:true});
    window.addEventListener('pagehide',flushEverything);
    document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') flushEverything(); });
  }

  // =====================================================================
  // Dashboard slideshow — SEWZA illustrations only
  // =====================================================================
  // Want to show your own illustrations too? Put the image files in the "slides" folder and list them here, e.g.
  //   {src:'slides/our-team.jpg', title:'Our team', sub:'Lagos studio'}
  const CUSTOM_SLIDES=[];
  const SLIDE_MS=5500;
  const builtInSlides=[
    {src:'slides/slide-fitting.svg',tag:'Perfect fit',title:'Tailors who measure with confidence',sub:'Every fitting saved, every customer remembered.',alt:'A tailor measuring a gown on a mannequin'},
    {src:'slides/slide-measure.svg',tag:'Measurement book',title:'Every measurement, safely kept',sub:'Say goodbye to the paper notebook.',alt:'A measuring tape, notebook and sewing tools'},
    {src:'slides/slide-customer.svg',tag:'Made for tailors',title:'The perfect fit starts with a measurement',sub:'Keep every customer\'s measurements one tap away.',alt:'A tailor taking a customer\'s measurements'},
    {src:'slides/slide-receipts.svg',tag:'Payments',title:'Get paid and stay organised',sub:'Record payments and send receipts in seconds.',alt:'A phone showing a payment receipt'},
    {src:'slides/slide-studio.svg',tag:'Your studio',title:'Create with style',sub:'From fabric to finished outfit, all in one place.',alt:'A tailor sewing in a bright studio'},
    {src:'slides/slide-delivery.svg',tag:'On-time delivery',title:'Delivered on time, loved on sight',sub:'Delivery reminders keep every order on schedule.',alt:'Tailored outfits ready for delivery'}
  ];
  const ss={slides:[],index:0,timer:null,sig:'',paused:false,failed:new Set(),startX:null,bound:false};

  function slideshowSlides(){
    // Only SEWZA illustrations are shown — never customer or profile photos.
    const extra=CUSTOM_SLIDES.filter(x=>x&&x.src).map(x=>({tag:'SEWZA',title:'',sub:'',alt:x.title||'SEWZA slide',...x}));
    return builtInSlides.concat(extra).filter(x=>!ss.failed.has(x.src));
  }
  function slideKey(s){ const x=String(s.src||''); return (x.length>120?x.slice(0,50)+x.length+x.slice(-30):x)+'|'+(s.title||'')+'|'+(s.sub||''); }
  function ssCanPlay(){
    return ss.slides.length>1 && !ss.paused && document.visibilityState==='visible' &&
      !!$('#view-dashboard')?.classList.contains('active') && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }
  function ssStopTimer(){ clearTimeout(ss.timer); ss.timer=null; const bar=$('#ssProgress'); if(bar)bar.classList.remove('run'); }
  function ssSchedule(){
    ssStopTimer();
    if(!ssCanPlay()) return;
    const bar=$('#ssProgress'); if(bar){ bar.style.setProperty('--ss-dur',SLIDE_MS+'ms'); void bar.offsetWidth; bar.classList.add('run'); }
    ss.timer=setTimeout(()=>{ ss.timer=null; if(ssCanPlay()) ssShow(ss.index+1); else ssStopTimer(); },SLIDE_MS);
  }
  function ssEnsurePlaying(){ if(!ss.timer && ssCanPlay()) ssSchedule(); }
  function ssShow(i){
    const n=ss.slides.length; if(!n) return;
    ss.index=((i%n)+n)%n;
    $$('#ssViewport .ss-slide').forEach((el,k)=>{ const on=k===ss.index; el.classList.toggle('active',on); el.setAttribute('aria-hidden',on?'false':'true'); });
    $$('#ssDots .ss-dot').forEach((el,k)=>{ const on=k===ss.index; el.classList.toggle('active',on); el.setAttribute('aria-selected',on?'true':'false'); });
    ssSchedule();
  }
  function renderSlideshow(){
    const root=$('#dashSlideshow'), vp=$('#ssViewport'), dots=$('#ssDots'); if(!root||!vp||!dots) return;
    const slides=slideshowSlides();
    const sig=slides.map(slideKey).join('~');
    if(sig!==ss.sig){
      const keep=ss.slides[ss.index]?slideKey(ss.slides[ss.index]):'';
      ss.sig=sig; ss.slides=slides;
      vp.textContent=''; dots.textContent='';
      slides.forEach((s,k)=>{
        const fig=document.createElement('figure'); fig.className='ss-slide'+(s.photo?' ss-photo':''); fig.setAttribute('role','group'); fig.setAttribute('aria-roledescription','slide'); fig.setAttribute('aria-label',`${k+1} of ${slides.length}`);
        const safeSrc=String(s.src).replace(/"/g,'%22');
        if(s.photo){ const bg=document.createElement('div'); bg.className='ss-bg'; bg.style.backgroundImage=`url("${safeSrc}")`; fig.appendChild(bg); }
        const img=document.createElement('img'); img.className='ss-img'; img.alt=s.alt||s.title||''; img.decoding='async'; img.draggable=false; if(k>0)img.loading='lazy';
        img.addEventListener('error',()=>{ ss.failed.add(s.src); renderSlideshow(); });
        img.src=s.src; fig.appendChild(img);
        if(s.title||s.sub||s.tag){
          const cap=document.createElement('figcaption'); cap.className='ss-cap';
          if(s.tag){ const t=document.createElement('span'); t.className='ss-tag'; t.textContent=s.tag; cap.appendChild(t); }
          if(s.title){ const b=document.createElement('b'); b.textContent=s.title; cap.appendChild(b); }
          if(s.sub){ const m=document.createElement('small'); m.textContent=s.sub; cap.appendChild(m); }
          fig.appendChild(cap);
        }
        vp.appendChild(fig);
        const d=document.createElement('button'); d.type='button'; d.className='ss-dot'; d.setAttribute('role','tab'); d.setAttribute('aria-label',`Go to slide ${k+1}`); d.dataset.slide=String(k); dots.appendChild(d);
      });
      root.hidden=slides.length===0;
      root.classList.toggle('single',slides.length<2);
      const at=keep?slides.findIndex(s=>slideKey(s)===keep):-1;
      ssShow(at>=0?at:0);
    }
    ssEnsurePlaying();
  }
  function bindSlideshow(){
    const root=$('#dashSlideshow'); if(!root||ss.bound) return; ss.bound=true;
    $('#ssPrev')?.addEventListener('click',()=>ssShow(ss.index-1));
    $('#ssNext')?.addEventListener('click',()=>ssShow(ss.index+1));
    $('#ssDots')?.addEventListener('click',e=>{ const d=e.target.closest('.ss-dot'); if(d) ssShow(Number(d.dataset.slide)); });
    const pause=()=>{ ss.paused=true; ssStopTimer(); };
    const resume=()=>{ ss.paused=false; ssEnsurePlaying(); };
    root.addEventListener('pointerenter',e=>{ if(e.pointerType==='mouse') pause(); });
    root.addEventListener('pointerleave',e=>{ if(e.pointerType==='mouse') resume(); });
    root.addEventListener('focusin',e=>{ if(e.target.matches?.(':focus-visible')) pause(); }); // keyboard users only; taps and clicks keep it playing
    root.addEventListener('focusout',e=>{ if(!root.contains(e.relatedTarget)) resume(); });
    root.addEventListener('keydown',e=>{ if(e.key==='ArrowLeft'){ e.preventDefault(); ssShow(ss.index-1); } else if(e.key==='ArrowRight'){ e.preventDefault(); ssShow(ss.index+1); } });
    // Swipe on phones and tablets.
    root.addEventListener('pointerdown',e=>{ if(e.target.closest('button'))return; ss.startX=e.clientX; });
    root.addEventListener('pointerup',e=>{ if(ss.startX===null)return; const dx=e.clientX-ss.startX; ss.startX=null; if(Math.abs(dx)>45) ssShow(ss.index+(dx<0?1:-1)); });
    root.addEventListener('pointercancel',()=>{ ss.startX=null; });
    document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') ssEnsurePlaying(); else ssStopTimer(); });
    // Photos that could not load while offline are tried again once the connection is back.
    window.addEventListener('online',()=>{ if(ss.failed.size){ ss.failed.clear(); renderSlideshow(); } });
  }

  // =====================================================================
  // v9 — Getting started checklist + guided tour for new users
  // =====================================================================
  const ONB_PREFIX='sewza_onb_v1_';
  const TOUR_STEPS=[
    {eyebrow:'WELCOME',title:'Welcome to SEWZA',text:'Your digital measurement book. Here is a one-minute tour of how everything works.',
     points:['Never lose a customer\'s measurements again','Works on your phone, even without internet'],
     art:'<img class="tour-logo" src="sewza-mark.png" alt=""><i class="tour-spark s1"></i><i class="tour-spark s2"></i><i class="tour-spark s3"></i>'},
    {eyebrow:'STEP 1 · CUSTOMERS',title:'Add a customer',text:'Tap the gold ＋ button to create a customer profile.',
     points:['Only the name is required','A photo is optional — add one if you like','Set a delivery date so SEWZA can remind you'],
     art:'<svg viewBox="0 0 320 160"><rect x="108" y="14" width="104" height="170" rx="18" fill="#fff"/><rect x="121" y="32" width="78" height="9" rx="4.5" fill="#cfe5dc"/><rect x="121" y="50" width="78" height="9" rx="4.5" fill="#cfe5dc"/><rect x="121" y="68" width="52" height="9" rx="4.5" fill="#cfe5dc"/><circle class="tour-pulse" cx="160" cy="116" r="18" fill="#d4af37"/><path d="M160 106v20M150 116h20" stroke="#fff" stroke-width="3.6" stroke-linecap="round"/></svg>'},
    {eyebrow:'STEP 2 · MEASUREMENTS',title:'Save measurements',text:'Type what you measured today. You can add the rest later.',
     points:['Switch between inches and centimetres','Add your own custom measurements','See an estimate of the fabric you will need'],
     art:'<svg viewBox="0 0 320 160"><rect x="58" y="30" width="204" height="112" rx="16" fill="#fff"/><rect x="40" y="12" width="240" height="20" rx="5" fill="#f2d27b"/><line x1="48" y1="32" x2="272" y2="32" stroke="#8b6f47" stroke-width="9" stroke-dasharray="1.6 8.4" opacity=".55"/><g font-family="Manrope,sans-serif" font-size="13" font-weight="800" fill="#0b6b5e"><text x="78" y="68">Bust</text><text x="244" y="68" text-anchor="end">34 in</text><text x="78" y="94">Waist</text><text x="244" y="94" text-anchor="end">28 in</text><text x="78" y="120">Hip</text><text x="244" y="120" text-anchor="end">38 in</text></g><g stroke="#dcebe4" stroke-width="1.5"><line x1="78" y1="77" x2="244" y2="77"/><line x1="78" y1="103" x2="244" y2="103"/></g></svg>'},
    {eyebrow:'STEP 3 · DELIVERY',title:'Never miss a delivery',text:'Set a delivery date and SEWZA colour-codes every order for you.',
     points:['Green is on schedule, yellow is close, red is due','Turn on alarms in Help for a ringing reminder'],
     art:'<svg viewBox="0 0 320 160"><rect x="66" y="14" width="188" height="140" rx="18" fill="#fff"/><path d="M66 32a18 18 0 0 1 18-18h152a18 18 0 0 1 18 18v14H66z" fill="#0b6b5e"/><g><circle cx="94" cy="72" r="7" fill="#35c978"/><rect x="112" y="66" width="86" height="11" rx="5.5" fill="#d8e9e1"/><rect x="206" y="66" width="30" height="11" rx="5.5" fill="#bfe8d0"/><circle cx="94" cy="100" r="7" fill="#e7b83f"/><rect x="112" y="94" width="70" height="11" rx="5.5" fill="#d8e9e1"/><rect x="206" y="94" width="30" height="11" rx="5.5" fill="#f6e3a8"/><circle cx="94" cy="128" r="7" fill="#ef5b5b"/><rect x="112" y="122" width="92" height="11" rx="5.5" fill="#d8e9e1"/><rect x="206" y="122" width="30" height="11" rx="5.5" fill="#f5c0c0"/></g></svg>'},
    {eyebrow:'STEP 4 · MONEY',title:'Get paid on time',text:'Open a customer, enter the price, then record each payment as it comes in.',
     points:['SEWZA works out the balance automatically','Send reminders and receipts on WhatsApp','The Business page shows who owes you'],
     art:'<svg viewBox="0 0 320 160"><circle cx="104" cy="82" r="42" fill="#e7c75c"/><circle cx="104" cy="82" r="33" fill="none" stroke="#a77a22" stroke-width="2.5"/><text x="104" y="96" text-anchor="middle" font-family="Georgia,serif" font-size="40" font-weight="700" fill="#8a5f12">₦</text><path d="M178 22h104v112l-9-7-9 7-9-7-9 7-9-7-9 7-9-7-9 7-9-7-9 7z" fill="#fff"/><rect x="192" y="40" width="48" height="8" rx="4" fill="#cfe5dc"/><rect x="192" y="58" width="76" height="8" rx="4" fill="#cfe5dc"/><rect x="192" y="76" width="64" height="8" rx="4" fill="#cfe5dc"/><circle cx="262" cy="108" r="14" fill="#25a36a"/><path d="M255 108l5 5 9-10" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'},
    {eyebrow:'STEP 5 · TOOLS',title:'Handy tools, always with you',text:'Use the Calculator for sums, unit conversions and price quotes.',
     points:['Install SEWZA on your home screen','Export a backup any time from Help','Replay this tour from Help whenever you like'],
     art:'<svg viewBox="0 0 320 160"><rect x="70" y="14" width="92" height="140" rx="16" fill="#fff"/><rect x="82" y="28" width="68" height="26" rx="8" fill="#0b6b5e"/><text x="144" y="47" text-anchor="end" font-family="Manrope,sans-serif" font-size="14" font-weight="800" fill="#f7e28f">1,250</text><g fill="#cfe5dc"><circle cx="94" cy="76" r="7"/><circle cx="116" cy="76" r="7"/><circle cx="138" cy="76" r="7"/><circle cx="94" cy="100" r="7"/><circle cx="116" cy="100" r="7"/><circle cx="138" cy="100" r="7"/><circle cx="94" cy="124" r="7"/><circle cx="116" cy="124" r="7"/></g><circle cx="138" cy="124" r="7" fill="#d4af37"/><path d="M200 112a22 22 0 0 1 4-43 30 30 0 0 1 57 8 19 19 0 0 1 1 35z" fill="#fff"/><path d="M219 92l9 9 17-19" fill="none" stroke="#25a36a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>'}
  ];
  let tourIdx=0, tourOpen=false, tourReturnFocus=null;

  function onbKey(){ return currentUser?.id ? ONB_PREFIX+currentUser.id : null; }
  function getOnb(){ const k=onbKey(); return k ? safeJSON(localStorage.getItem(k),{}) || {} : {}; }
  function setOnb(patch){ const k=onbKey(); if(!k) return; try{ localStorage.setItem(k,JSON.stringify({...getOnb(),...patch})); }catch{} }
  function isNewAccount(){ return !!currentUser && customers.length===0; }

  function updateGreeting(){
    const t=$('#view-dashboard h1'); if(!t||!currentUser) return;
    const m=currentUser.user_metadata||{};
    const display=((currentProfile?.business_name||m.business_name||'').trim())||((currentProfile?.full_name||m.full_name||m.name||'').trim())||currentUser.email?.split('@')[0]||'SEWZA';
    t.textContent=`${isNewAccount()?'Welcome':'Welcome back'}, ${display}.`;
  }

  function checklistItems(){
    const hasC=customers.length>0;
    const hasM=customers.some(c=>Object.keys(c.measurements||{}).length>0||(c.customMeasurements||[]).some(x=>x&&x.value));
    const hasD=customers.some(c=>!!c.deliveryDate);
    const hasP=customers.some(c=>(c.paymentHistory||[]).length>0||Number(c.paid||0)>0);
    const next=hasC?'customers':'add';
    return [
      {t:'Add your first customer',d:'Just a name is enough to begin.',done:hasC,go:'add'},
      {t:'Save their measurements',d:'Bust, waist, length — whatever you measured.',done:hasM,go:next},
      {t:'Set a delivery date',d:'SEWZA will remind you before it is due.',done:hasD,go:next},
      {t:'Record a payment',d:'Keep every naira and every balance clear.',done:hasP,go:next}
    ];
  }
  function renderChecklist(){
    updateGreeting();
    const card=$('#gsCard'); if(!card) return;
    if(!currentUser){ card.hidden=true; return; }
    const items=checklistItems(), done=items.filter(i=>i.done).length, o=getOnb();
    if(done===items.length){
      if(!o.doneToast){ setOnb({doneToast:1,hide:1}); showToast('You are all set','Your measurement book is ready for real customers.'); }
      card.hidden=true; return;
    }
    card.hidden=!!o.hide;
    if(card.hidden) return;
    const list=$('#gsSteps');
    list.innerHTML=items.map((i,k)=>`<li><button type="button" class="gs-step${i.done?' done':''}" data-gs-go="${i.go}"><span class="gs-check" aria-hidden="true">${i.done?'✓':k+1}</span><span class="gs-text"><b>${escapeHTML(i.t)}</b><small>${escapeHTML(i.d)}</small></span><i aria-hidden="true">→</i></button></li>`).join('');
    $('#gsCount').textContent=`${done}/${items.length}`;
    const fg=$('#gsRingFg'); if(fg){ const C=2*Math.PI*19; fg.style.strokeDasharray=C.toFixed(2); fg.style.strokeDashoffset=(C*(1-done/items.length)).toFixed(2); }
  }

  function renderTourStep(animate=true){
    const st=TOUR_STEPS[tourIdx], last=tourIdx===TOUR_STEPS.length-1;
    $('#tourArt').innerHTML=st.art;
    $('#tourEyebrow').textContent=st.eyebrow;
    $('#tourTitle').textContent=st.title;
    $('#tourText').textContent=st.text;
    $('#tourPoints').innerHTML=st.points.map(p=>`<li>${escapeHTML(p)}</li>`).join('');
    $('#tourDots').innerHTML=TOUR_STEPS.map((_,k)=>`<i class="${k===tourIdx?'on':''}"></i>`).join('');
    const back=$('#tourBack'); back.style.visibility=tourIdx===0?'hidden':'visible';
    $('#tourNext').innerHTML=last?(customers.length?'Finish':'Add my first customer')+' <span>→</span>':'Next <span>→</span>';
    $('#tourSkip').hidden=last;
    const body=$('#tourBody'), art=$('#tourArt');
    if(animate){ [body,art].forEach(el=>{ el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap'); }); }
  }
  function openTour(start=0){
    const m=$('#tourModal'); if(!m) return;
    tourIdx=Math.max(0,Math.min(start,TOUR_STEPS.length-1));
    tourReturnFocus=document.activeElement;
    renderTourStep(false);
    m.classList.add('show'); m.setAttribute('aria-hidden','false'); tourOpen=true;
    document.body.classList.add('modal-open');
    setTimeout(()=>$('#tourNext')?.focus(),60);
  }
  function closeTour(){
    const m=$('#tourModal'); if(!m||!tourOpen) return;
    m.classList.remove('show'); m.setAttribute('aria-hidden','true'); tourOpen=false;
    document.body.classList.remove('modal-open');
    setOnb({tour:1});
    try{ tourReturnFocus?.focus?.({preventScroll:true}); }catch{}
    updateGreeting();
  }
  function tourNext(){
    if(tourIdx<TOUR_STEPS.length-1){ tourIdx++; renderTourStep(); return; }
    const goAdd=customers.length===0;
    closeTour();
    if(goAdd) showView('add');
  }
  function tourBack(){ if(tourIdx>0){ tourIdx--; renderTourStep(); } }

  // First sign-in on an empty account: show the welcome tour once.
  function onboardingCheck(tries=0){
    if(!currentUser) return;
    const o=getOnb(); if(o.tour||tourOpen) return;
    if(customers.length>0){ setOnb({tour:1}); updateGreeting(); return; } // existing users are never interrupted
    if($('#installSheet')?.classList.contains('show') && tries<6){ setTimeout(()=>onboardingCheck(tries+1),3500); return; }
    setTimeout(()=>{
      if(!currentUser||tourOpen||getOnb().tour||customers.length||currentViewName()!=='dashboard') return;
      openTour(0);
    },900);
  }

  function bindOnboarding(){
    $('#gsTour')?.addEventListener('click',()=>openTour(0));
    $('#helpTourBtn')?.addEventListener('click',()=>openTour(0));
    $('#gsHide')?.addEventListener('click',()=>{ setOnb({hide:1}); renderChecklist(); showToast('Checklist hidden','You can replay the tour any time from Help.'); });
    $('#gsSteps')?.addEventListener('click',e=>{ const b=e.target.closest('[data-gs-go]'); if(b) showView(b.dataset.gsGo); });
    $('#recentCustomers')?.addEventListener('click',e=>{ if(e.target.closest('[data-empty-add]')) showView('add'); });
    $('#tourNext')?.addEventListener('click',tourNext);
    $('#tourBack')?.addEventListener('click',tourBack);
    $('#tourSkip')?.addEventListener('click',closeTour);
    $('#tourModal')?.addEventListener('click',e=>{ if(e.target.id==='tourModal') closeTour(); });
    document.addEventListener('keydown',e=>{
      if(!tourOpen) return;
      if(e.key==='Escape') closeTour();
      else if(e.key==='ArrowRight') tourNext();
      else if(e.key==='ArrowLeft') tourBack();
    });
  }

  function bindEvents(){
    $$('[data-view]').forEach(btn=>btn.addEventListener('click',e=>{e.preventDefault();showView(btn.dataset.view);}));
    $$('[data-scroll]').forEach(btn=>btn.addEventListener('click',e=>{e.preventDefault();document.getElementById(btn.dataset.scroll)?.scrollIntoView({behavior:'smooth',block:'start'});}));
    $('#loginForm')?.addEventListener('submit',handleAuthSubmit);
    $('#authToggleBtn')?.addEventListener('click',()=>setAuthMode($('#signupFields')?.hidden));
    $('#showPass')?.addEventListener('click',()=>{const i=$('#loginPassword');i.type=i.type==='password'?'text':'password';$('#showPass').textContent=i.type==='password'?'Show':'Hide';});
    bindPasswordReset();
    $('#themeQuickBtn')?.addEventListener('click',()=>showView('themes')); $('#profileBtn')?.addEventListener('click',()=>{renderAccountPanel();showView('account');}); $('#signOutBtn')?.addEventListener('click',signOut); $('#saveAccountBtn')?.addEventListener('click',async()=>{try{await saveProfileSettings();}catch(e){console.error(e);if(isNetworkError(e))showToast(INTERNET_FAILED,INTERNET_FAILED_HELP);else showToast('Could not save profile','Check your Supabase Storage bucket and RLS policies.');}}); $('#accountAvatarInput')?.addEventListener('change',e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>5*1024*1024){showToast('Image too large','Choose a profile photo under 5MB.');e.target.value='';return;}const r=new FileReader();r.onload=ev=>{avatarRemoveRequested=false;const x=$('#accountAvatarPreview');x.style.backgroundImage=`url("${ev.target.result}")`;x.textContent='';x.classList.add('has-photo');};r.readAsDataURL(f);});
    { // Optional profile picture: "Remove picture" appears only while a picture is shown.
      const avatarBox=$('#accountAvatarPreview'), removeAvatarBtn=$('#removeAvatarBtn');
      if(avatarBox&&removeAvatarBtn){
        const syncAvatarBtn=()=>{removeAvatarBtn.hidden=!avatarBox.classList.contains('has-photo');};
        new MutationObserver(syncAvatarBtn).observe(avatarBox,{attributes:true,attributeFilter:['class']});
        removeAvatarBtn.addEventListener('click',()=>{
          avatarRemoveRequested=true;
          avatarBox.style.backgroundImage=''; avatarBox.classList.remove('has-photo');
          avatarBox.textContent=((currentProfile?.business_name||currentUser?.user_metadata?.business_name||currentProfile?.full_name||'S')+'').trim().charAt(0).toUpperCase()||'S';
          const input=$('#accountAvatarInput'); if(input)input.value='';
          syncAvatarBtn(); showToast('Picture removed','Choose Save profile to finish.');
        });
        syncAvatarBtn();
      }
    }
    $$('.sidebar [data-view="login"]').forEach(btn=>btn.addEventListener('click',e=>{e.preventDefault();signOut();}));
    $('#customerForm')?.addEventListener('submit',createCustomer);
    $('#searchInput')?.addEventListener('input',e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>renderCustomers(e.target.value),80);});
    $('#customerPhoto')?.addEventListener('change',e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>5*1024*1024){showToast('Photo too large','Choose a photo under 5MB.');e.target.value='';return;}const r=new FileReader();r.onload=ev=>{delete $('#photoPreview').dataset.photoRemoved;$('#photoPreview').dataset.photo=ev.target.result;$('#photoPreview').style.backgroundImage=`url("${ev.target.result}")`;$(`#photoPreview`).classList.add('has-photo');};r.readAsDataURL(f);});
    // Optional photo: show "Remove photo" only while a photo is attached, and let the person take it away.
    const photoBox=$('#photoPreview'), removePhotoBtn=$('#removePhotoBtn');
    if(photoBox&&removePhotoBtn){
      const syncRemoveBtn=()=>{removePhotoBtn.hidden=!photoBox.classList.contains('has-photo');};
      new MutationObserver(syncRemoveBtn).observe(photoBox,{attributes:true,attributeFilter:['class']});
      removePhotoBtn.addEventListener('click',()=>{
        photoBox.style.backgroundImage=''; photoBox.classList.remove('has-photo');
        delete photoBox.dataset.photo; photoBox.dataset.photoRemoved='1';
        const input=$('#customerPhoto'); if(input)input.value='';
        syncRemoveBtn(); showToast('Photo removed','This customer will be saved without a photo.');
      });
      syncRemoveBtn();
    }
    $$('.template').forEach(btn=>btn.addEventListener('click',()=>{currentTemplate=btn.dataset.template;$$('.template').forEach(b=>b.classList.toggle('active',b===btn));renderFields();}));
    $('#measurementGender')?.addEventListener('change',e=>{ $('#customerGender').value=e.target.value; renderFields({gender:e.target.value,unit:currentUnit}); });
    $('#customerGender')?.addEventListener('change',e=>{ if($('#measurementGender'))$('#measurementGender').value=e.target.value; renderFields({gender:e.target.value,unit:currentUnit}); });
    $('#includeTrouser')?.addEventListener('change',()=>renderFields({gender:currentGender(),unit:currentUnit}));
    $('#fabricWidth')?.addEventListener('change',()=>{ if(selectedCustomer)renderFabricEstimate(selectedCustomer); renderDraftFabricEstimate(); });
    $('#customerCategory')?.addEventListener('change',renderDraftFabricEstimate);
    $('#customerForm')?.addEventListener('input',e=>{if(e.target.matches('[data-measure]')||e.target.id==='measurementGender'||e.target.id==='includeTrouser')renderDraftFabricEstimate();});
    $$('.unit-btn').forEach(btn=>btn.addEventListener('click',()=>setUnit(btn.dataset.unit)));
    $('#addCustomMeasurement')?.addEventListener('click',()=>{const wrap=$('#customMeasurementFields');const index=wrap.children.length;wrap.insertAdjacentHTML('beforeend',customFieldHTML('','',currentUnit,index));});
    $('#customMeasurementFields')?.addEventListener('click',e=>{const b=e.target.closest('[data-remove-custom]');if(b)b.closest('.custom-measure-row').remove();});
    $$('[data-theme-choice]').forEach(btn=>btn.addEventListener('click',()=>{setTheme(btn.dataset.themeChoice);showToast('Theme applied','Your workspace appearance was updated.');}));
    $$('button[data-text-theme]').forEach(btn=>btn.addEventListener('click',()=>{setTextTheme(btn.dataset.textTheme);showToast('Text style applied','Your text style was updated.');}));
    $('#newMeasurementBtn')?.addEventListener('click',()=>{if(!selectedCustomer)return;editProfile();});
    $('#editProfileBtn')?.addEventListener('click',editProfile); $('#deleteProfileBtn')?.addEventListener('click',deleteProfile);
    $('#whatsappBtn')?.addEventListener('click',()=>{if(selectedCustomer)sendWhatsApp(selectedCustomer,`Hello ${selectedCustomer.name}, this is ${currentProfile?.business_name||'your tailor'}. How can we help you today?`);});
    $('#recordPaymentBtn')?.addEventListener('click',recordPayment);
    $('#receiptBtn')?.addEventListener('click',openReceipt);
    $('#receiptClose')?.addEventListener('click',closeReceipt);
    $('#receiptCloseBottom')?.addEventListener('click',closeReceipt);
    $('#receiptWhatsAppBtn')?.addEventListener('click',sendReceiptWhatsApp);
    $('#remindFromProfileBtn')?.addEventListener('click',()=>{if(selectedCustomer && balance(selectedCustomer)>0)sendWhatsApp(selectedCustomer,owingReminderMessage(selectedCustomer));else showToast('No reminder needed','This customer has no outstanding balance.');});
    $('#receiptModal')?.addEventListener('click',e=>{if(e.target.id==='receiptModal')closeReceipt();});

    $('#alarmBtn')?.addEventListener('click',()=>setAlarmEnabled(!isAlarmEnabled()));
    $('#helpAlarmToggle')?.addEventListener('click',()=>setAlarmEnabled(!isAlarmEnabled()));
    $('#alarmTime')?.addEventListener('change',e=>{settings.alarmTime=e.target.value||'08:00';saveSettings();showToast('Reminder time saved',`Due-today alerts will use ${settings.alarmTime}.`);});
    $('#testToneBtn')?.addEventListener('click',()=>{unlockAudio();playTone(settings.tone);showToast('Tone preview','Playing the selected reminder tone.');});
    $('#celebrationClose')?.addEventListener('click',closeCelebration); $('#reminderClose')?.addEventListener('click',closeReminder);
    $('#celebration')?.addEventListener('click',e=>{if(e.target.id==='celebration')closeCelebration();}); $('#reminderModal')?.addEventListener('click',e=>{if(e.target.id==='reminderModal')closeReminder();});
    $('#exportBackup')?.addEventListener('click',exportData); $('#exportCSV')?.addEventListener('click',downloadCSV); $('#importBackup')?.addEventListener('change',e=>importData(e.target.files?.[0]));
    document.addEventListener('click',()=>{if(isAlarmEnabled())unlockAudio()},{capture:true});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeCelebration();closeReminder();}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();showView('customers');setTimeout(()=>$('#searchInput')?.focus(),100);}});
    window.addEventListener('online',async()=>{
      updateOfflineBadge();
      if(currentUser){
        showToast('Back online','Syncing your SEWZA records…');
        await syncCloudData();
        updateOfflineBadge();
      }
    });
    window.addEventListener('offline',()=>{settings.cloudStatus='Local only';saveSettings();updateOfflineBadge();showToast('Offline mode','Your records continue saving on this device.');});
  }

  async function init(){
    document.body.dataset.theme=settings.theme;
    document.body.dataset.textTheme=settings.textTheme;
    setTextTheme(settings.textTheme);
    setTheme(settings.theme);
    if($('#alarmTime'))$('#alarmTime').value=settings.alarmTime;
    renderTones();
    customers=[];
    bindEvents();
    bindV7();
    bindSlideshow();
    bindOnboarding();
    bindStudio();
    resetCustomerForm();
    refreshUI();
    startReminderClock();
    updateAlarmButton();
    setAuthMode(false);
    const rememberedEmail=localStorage.getItem('sewza_last_email');
    if(rememberedEmail && $('#loginEmail')) $('#loginEmail').value=rememberedEmail;
    try{
      await restoreAuthSession();
    }catch(error){
      console.error('SEWZA startup error:',error);
      showView('login');
    }finally{
      // Let the animated SEWZA logo finish drawing, then reveal the workspace.
      const wait=Math.max(0,BOOT_MIN_MS-performance.now());
      const boot=$('#appBoot');
      const reveal=()=>{
        document.body.classList.remove('booting');
        if(boot){ boot.classList.add('leaving'); setTimeout(()=>boot.remove(),750); }
      };
      let calm=false; try{ calm=window.matchMedia('(prefers-reduced-motion: reduce)').matches; }catch{}
      // Finish the stitching with a little flourish, then fade the opening screen away.
      setTimeout(()=>{ if(boot&&!calm){ boot.classList.add('done'); setTimeout(reveal,480); } else reveal(); },wait);
    }
  }

  // =====================================================================
  // v10 — gender-aware style lists and group orders
  // =====================================================================
  const STYLE_CATALOG={
    Male:[
      {group:'Yoruba / Nigerian traditional',items:[['Agbada',null],['Agbada (3-piece set)','agbada'],['Aso-Oke Agbada','agbada'],['Buba & Sokoto','native wear'],['Dashiki / Danshiki','native wear'],['Senator / Kaftan','native wear'],['Gbariye','native wear'],['Kembe (wide trousers)','trousers'],['Ankara Native Wear','native wear'],['Lace Native Wear','native wear'],['Native Wear',null]]},
      {group:'English / Western',items:[['Suit (2-piece)','two-piece'],['Suit (3-piece)','two-piece'],['Tuxedo','two-piece'],['Blazer / Jacket','shirt'],['Waistcoat','shirt'],['Shirt',null],['Polo / T-shirt','shirt'],['Trousers',null],['Shorts','trousers'],['Two-Piece',null]]},
      {group:'Other',items:[['Custom',null]]}
    ],
    Female:[
      {group:'Yoruba / Nigerian traditional',items:[['Iro & Buba','native wear'],['Iro, Buba & Gele Set','native wear'],['Aso-Oke Iro & Buba','native wear'],['Ankara Peplum Top & Skirt','two-piece'],['Ankara Gown','dress / gown'],['Kaba & Slit','two-piece'],['Aso-Ebi Gown','dress / gown'],['Lace Gown','dress / gown'],['Boubou / Kaftan Gown','dress / gown'],['Corset Gown (Ankara)','dress / gown'],['Skirt & Blouse','two-piece'],['Native Wear',null]]},
      {group:'English / Western',items:[['Dress / Gown',null],['Flare Gown',null],['A-line Dress','dress / gown'],['Mermaid Gown','dress / gown'],['Ball Gown','flare gown'],['Wedding Gown','flare gown'],['Evening Gown','dress / gown'],['Bodycon Dress','dress / gown'],['Maxi Dress','dress / gown'],['Wrap Dress','dress / gown'],['Shift Dress','dress / gown'],['Peplum Dress','dress / gown'],['Jumpsuit','two-piece'],['Palazzo Set','two-piece'],['Pencil Skirt','skirt'],['Skirt',null],['Blouse / Top','shirt'],['Shirt',null],['Trousers',null],['Two-Piece',null]]},
      {group:'Other',items:[['Custom',null]]}
    ]
  };
  const STYLE_UNIFORM=['School Shirt & Trousers','School Shirt & Shorts','Blouse & Skirt (uniform)','Pinafore / Tunic','School Gown','PE Kit / Tracksuit','Office Shirt & Trousers','Native Uniform','Choir Robe','Apron / Overall'];
  const STYLE_DEFAULT={Female:'Dress / Gown',Male:'Native Wear',Other:'Dress / Gown'};
  const STYLE_BASE={}, STYLE_LABEL={};
  Object.values(STYLE_CATALOG).forEach(cat=>cat.forEach(gr=>gr.items.forEach(([label,base])=>{ if(base){ STYLE_BASE[label.toLowerCase()]=base; STYLE_LABEL[label.toLowerCase()]=label; } })));
  // New style names behave like the existing garment family they belong to (fabric guide, measurement template).
  function baseCategoryKey(category){ const x=String(category||'').toLowerCase(); return STYLE_BASE[x]||x; }
  function styleDisplayLabel(category){ return STYLE_LABEL[String(category||'').toLowerCase()]||''; }
  function styleGroupsFor(g){
    const src=g==='Male'?[STYLE_CATALOG.Male]:g==='Female'?[STYLE_CATALOG.Female]:[STYLE_CATALOG.Female,STYLE_CATALOG.Male];
    const order=[], map={};
    src.forEach(cat=>cat.forEach(gr=>{ if(!map[gr.group]){map[gr.group]=[];order.push(gr.group);} gr.items.forEach(([label])=>{ if(!map[gr.group].includes(label)) map[gr.group].push(label); }); }));
    return order.map(name=>({group:name,labels:map[name]}));
  }
  function styleOptionsHTML(groups,desired){
    let html=groups.map(gr=>`<optgroup label="${escapeHTML(gr.group)}">${gr.labels.map(l=>`<option value="${escapeHTML(l)}">${escapeHTML(l)}</option>`).join('')}</optgroup>`).join('');
    const all=groups.flatMap(gr=>gr.labels);
    if(desired && !all.includes(desired)) html+=`<optgroup label="Saved style"><option value="${escapeHTML(desired)}">${escapeHTML(desired)}</option></optgroup>`;
    return html;
  }
  function updateMeasureFor(gender){
    const t=$('#measureForText'), i=$('#measureFor .mf-ico'); if(!t||!i) return;
    const g=gender==='Male'?'Male':gender==='Female'?'Female':'Other';
    t.textContent=g==='Other'?'Other (standard fields)':g; i.textContent=g==='Male'?'♂':g==='Female'?'♀':'⚥';
  }
  function renderStyleOptions(gender,desired){
    const sel=$('#customerCategory'); if(!sel) return;
    const g=gender==='Male'||gender==='Female'?gender:'Other';
    sel.innerHTML=styleOptionsHTML(styleGroupsFor(g),desired||'');
    sel.value=(desired&&[...sel.options].some(o=>o.value===desired))?desired:STYLE_DEFAULT[g];
    updateMeasureFor(gender);
  }

  // ---------- group orders ----------
  const GS_LIB_PREFIX='sewza_groups_', GS_DRAFT_PREFIX='sewza_draft_group_', GS_MODE_PREFIX='sewza_addmode_';
  const GS_MAX_MEMBERS=150, GS_MAX_CLOTH=6;
  const GS_CATS={
    uniform:['School uniform','Church / Choir','Office / Corporate','Club / Association','Sports / PE','Other'],
    dress:['Aso-ebi / Wedding','Burial / Memorial','Birthday / Party','Church event','Family / Naming','Graduation','Other']
  };
  const GS_ICON={
    uniform:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3c-.5 1.5-1.8 2.3-4 2.3S8.5 4.5 8 3z"/></svg>',
    dress:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6l-.8 5.5L19 21H5l4.8-12.5z"/><path d="M9.8 8.5h4.4"/></svg>',
    cam:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.6-2.4h6.8L17 8h3v11H4z"/><circle cx="12" cy="13.2" r="3.4"/></svg>',
    trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    chev:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>'
  };
  let groups=[], groupsUid=null, groupsReady=false, gsLoading=null;
  let gs=null, addMode='single', gsFirstShow=true, gsWasActive=false, gsDraftTimer=null, gsSaving=false;
  let gsFilter='all', gsQuery='', gsOpenId='', gsLastFocus=null, gsDeleteTimer=null, gsSearchTimer=null, gsFreshId='';

  function gsUid(){ return currentUser?.id||'guest'; }
  function gsCloudPhotoPrefix(){ const u=window.SEWZA_SUPABASE_CONFIG&&window.SEWZA_SUPABASE_CONFIG.url; return u?String(u).replace(/\/$/,'')+'/storage/v1/object/public/customer-photos/':null; }
  function gsSafePhoto(p){ if(typeof p!=='string') return ''; if(p.startsWith('data:image/')) return p; const pre=gsCloudPhotoPrefix(); return pre&&p.startsWith(pre)?p:''; }
  function gsCleanMeasures(m){ const o={}; if(m&&typeof m==='object') Object.entries(m).forEach(([k,v])=>{ const val=String(v??'').trim(); if(val) o[String(k).slice(0,40)]=val.slice(0,12); }); return o; }
  function gsBlankMember(prev){ return {id:uid('member'),name:'',cls:prev?.cls||'',phone:'',gender:prev?.gender==='Male'?'Male':'Female',photo:'',m:{},note:'',open:false}; }
  function gsDefaultStyle(type,gender){ if(type==='uniform') return 'School Shirt & Trousers'; return gender==='Female'?'Dress / Gown':'Native Wear'; }
  function gsBlank(){
    return {id:'',type:'uniform',name:'',category:GS_CATS.uniform[0],gender:'Mixed',genderTouched:false,style:gsDefaultStyle('uniform','Mixed'),fabricWidth:45,unit:'in',includeTrouser:false,
      startDate:localDateInputValue(),deliveryDate:localDateInputValue(new Date(Date.now()+14*86400000)),price:'',notes:'',cloth:[],members:[gsBlankMember(null)],createdAt:'',updatedAt:''};
  }
  function gsNormalizeState(s){
    if(!s||typeof s!=='object') return gsBlank();
    const type=s.type==='dress'?'dress':'uniform';
    const gender=['Female','Male','Mixed'].includes(s.gender)?s.gender:(type==='uniform'?'Mixed':'Female');
    const members=(Array.isArray(s.members)?s.members:[]).slice(0,GS_MAX_MEMBERS).map(m=>({
      id:String(m?.id||uid('member')),name:String(m?.name||'').slice(0,80),cls:String(m?.cls||'').slice(0,40),phone:String(m?.phone||'').slice(0,30),
      gender:m?.gender==='Male'?'Male':'Female',photo:gsSafePhoto(m?.photo),m:gsCleanMeasures(m?.m),note:String(m?.note||'').slice(0,160),open:false}));
    if(!members.length) members.push(gsBlankMember(null));
    return {id:String(s.id||''),type,name:String(s.name||'').slice(0,80),category:GS_CATS[type].includes(s.category)?s.category:GS_CATS[type][0],gender,genderTouched:!!s.genderTouched,
      style:String(s.style||'').slice(0,60)||gsDefaultStyle(type,gender),fabricWidth:Number(s.fabricWidth)===60?60:45,unit:s.unit==='cm'?'cm':'in',includeTrouser:!!s.includeTrouser,
      startDate:String(s.startDate||''),deliveryDate:String(s.deliveryDate||''),price:String(s.price||'').replace(/[^0-9.]/g,'').slice(0,12),notes:String(s.notes||'').slice(0,600),
      cloth:(Array.isArray(s.cloth)?s.cloth:[]).map(gsSafePhoto).filter(Boolean).slice(0,GS_MAX_CLOTH),members,createdAt:String(s.createdAt||''),updatedAt:String(s.updatedAt||'')};
  }
  function gsMemberGender(src,m){ return src.gender==='Mixed'?(m.gender==='Male'?'Male':'Female'):src.gender; }
  function gsMeasureNames(g,incl){ const male=g==='Male'; const top=male?templates.maleTop:templates.femaleTop; const tr=male?templates.maleTrouser:templates.femaleTrouser; return incl?[...top,...tr]:[...top]; }
  function gsHasContent(s){
    return !!(s.name.trim()||s.notes.trim()||String(s.price).trim()||s.cloth.length||s.members.some(m=>m.name.trim()||m.phone.trim()||m.note.trim()||m.photo||Object.keys(m.m||{}).length));
  }
  function gsStats(src){
    const members=src.members.filter(m=>String(m.name||'').trim());
    let yards=0;
    if(src.type==='dress') members.forEach(m=>{
      const div=src.unit==='cm'?2.54:1, meas={};
      Object.entries(m.m||{}).forEach(([k,v])=>{ const n=Number(String(v).replace(/[^0-9.]/g,'')); if(n) meas[k]=String(n/div); });
      try{ yards+=estimateFabricYards({gender:gsMemberGender(src,m),category:src.style,fabricWidth:src.fabricWidth,measurements:meas}).yards; }catch{}
    });
    const price=Number(String(src.price||'').replace(/[^0-9.]/g,''))||0;
    return {people:members.length,yards,total:price*members.length};
  }
  const fmtYd=y=>`${+y.toFixed(2)} yd`;
  function gsFmtDate(v){ return v?formatDate(v):'Not set'; }

  // ----- storage -----
  function gsLibKey(){ return GS_LIB_PREFIX+gsUid(); }
  function gsDraftKey(){ return GS_DRAFT_PREFIX+gsUid(); }
  async function gsPersist(list){
    const key=gsLibKey(); let ok=false;
    try{ ok=await idbSet(key,list); }catch{ ok=false; }
    let ok2=false; try{ localStorage.setItem(key,JSON.stringify(list)); ok2=true; }catch{}
    return ok||ok2;
  }
  async function gsEnsure(){
    const uidNow=gsUid();
    if(groupsReady&&groupsUid===uidNow) return;
    if(gsLoading) return gsLoading;
    gsLoading=(async()=>{
      const a=await idbGet(GS_LIB_PREFIX+uidNow); const b=safeJSON(localStorage.getItem(GS_LIB_PREFIX+uidNow),null);
      const raw=Array.isArray(a)?a:(Array.isArray(b)?b:[]);
      groups=raw.filter(g=>g&&typeof g==='object').map(g=>gsNormalizeState(g)).filter(g=>g.id&&g.name);
      let d=null; try{ const da=await idbGet(GS_DRAFT_PREFIX+uidNow); const db=safeJSON(localStorage.getItem(GS_DRAFT_PREFIX+uidNow),null); const x=da||db; d=x&&x.v&&x.state?x.state:null; }catch{}
      gs=d?gsNormalizeState(d):gsBlank();
      if(gs.id&&!groups.some(g=>g.id===gs.id)) gs.id='';
      groupsUid=uidNow; groupsReady=true;
    })().catch(e=>{ console.warn('SEWZA groups load failed:',e); groups=[]; gs=gsBlank(); groupsUid=uidNow; groupsReady=true; }).finally(()=>{ gsLoading=null; });
    gsLoading.then(()=>{ if(currentUser&&navigator.onLine) gsSyncSoon(); }).catch(()=>{});
    return gsLoading;
  }
  function gsTouch(){ clearTimeout(gsDraftTimer); gsDraftTimer=setTimeout(gsWriteDraft,500); }
  function gsWriteDraft(){
    clearTimeout(gsDraftTimer);
    if(!currentUser||!groupsReady||groupsUid!==gsUid()) return;
    const key=gsDraftKey();
    if(!gsHasContent(gs)&&!gs.id){ try{localStorage.removeItem(key);}catch{} idbDel(key); return; }
    const snap={v:1,savedAt:Date.now(),state:gs};
    try{ localStorage.setItem(key,JSON.stringify(snap,(k,v)=>(typeof v==='string'&&v.startsWith('data:'))?'':v)); }catch{}
    idbSet(key,snap);
  }
  function gsDiscardDraft(){ clearTimeout(gsDraftTimer); const key=gsDraftKey(); try{localStorage.removeItem(key);}catch{} idbDel(key); }

  // ----- cloud sync (Supabase table `customer_groups` + Storage bucket `customer-photos`) -----
  // The device copy stays the fast, offline-first copy. Every save/delete is queued and pushed to
  // Supabase in the background; on every sync the cloud copy is also pulled so a new phone sees the same groups.
  const GS_PENDING_PREFIX='sewza_gpending_', GS_SYNCED_PREFIX='sewza_gsynced_';
  let gsSyncRunning=null, gsSyncQueued=false, gsWarnedMissing=false;
  const gsTime=v=>{ const t=Date.parse(v||''); return Number.isFinite(t)?t:0; };
  function gsPendRead(u){ const p=safeJSON(localStorage.getItem(GS_PENDING_PREFIX+u),null)||{}; return {up:Array.isArray(p.up)?p.up.map(String):[],del:Array.isArray(p.del)?p.del.map(String):[]}; }
  function gsPendWrite(u,p){ try{ if(p.up.length||p.del.length) localStorage.setItem(GS_PENDING_PREFIX+u,JSON.stringify(p)); else localStorage.removeItem(GS_PENDING_PREFIX+u); }catch{} }
  function gsMarkUp(id){ if(!currentUser) return; const u=currentUser.id, p=gsPendRead(u); p.del=p.del.filter(x=>x!==id); if(!p.up.includes(id)) p.up.push(id); gsPendWrite(u,p); }
  function gsMarkDel(id){ if(!currentUser) return; const u=currentUser.id, p=gsPendRead(u); p.up=p.up.filter(x=>x!==id); if(!p.del.includes(id)) p.del.push(id); gsPendWrite(u,p); }
  function gsPendDrop(u,kind,id){ const p=gsPendRead(u); p[kind]=p[kind].filter(x=>x!==id); gsPendWrite(u,p); }
  function gsPhotoPaths(g){
    const pre=gsCloudPhotoPrefix(), set=new Set(); if(!pre) return set;
    [...g.members.map(m=>m.photo),...g.cloth].forEach(src=>{ if(typeof src==='string'&&src.startsWith(pre)) set.add(decodeURIComponent(src.slice(pre.length).split('?')[0])); });
    return set;
  }
  async function gsUploadPhotos(g,u){
    const copy=JSON.parse(JSON.stringify(g));
    const put=async src=>{
      if(typeof src!=='string'||!src.startsWith('data:')) return src;
      const url=await uploadToBucket('customer-photos',`${u}/groups/${g.id}/p_${uid('p')}.jpg`,src);
      if(!url) throw new Error('group photo upload failed');
      return url;
    };
    for(const m of copy.members) m.photo=m.photo?await put(m.photo):'';
    for(let i=0;i<copy.cloth.length;i++) copy.cloth[i]=await put(copy.cloth[i]);
    return copy;
  }
  // Removes uploaded photo files that no saved group refers to any more (never files younger than minAgeMs).
  async function gsCleanupPhotos(client,u,gid,keepPaths,minAgeMs){
    try{
      const folder=`${u}/groups/${gid}`, bucket=client.storage.from('customer-photos');
      const {data,error}=await bucket.list(folder,{limit:1000});
      if(error||!Array.isArray(data)) return;
      const gone=data.filter(f=>f&&f.name&&f.id!==null&&!keepPaths.has(`${folder}/${f.name}`)&&(!minAgeMs||!f.created_at||Date.now()-gsTime(f.created_at)>minAgeMs)).map(f=>`${folder}/${f.name}`);
      if(gone.length) await bucket.remove(gone);
    }catch(e){ console.warn('SEWZA group photo cleanup skipped:',e); }
  }
  function gsSyncProblem(e){
    console.warn('SEWZA group cloud sync problem:',e);
    const text=`${e?.code||''} ${e?.message||''}`;
    if(!gsWarnedMissing&&/42P01|PGRST205|customer_groups/i.test(text)&&!isNetworkError(e)){
      gsWarnedMissing=true; showToast('Groups are not in the cloud yet','Run SUPABASE_GROUPS_MIGRATION.sql in your Supabase SQL Editor.');
    }
  }
  function gsSyncSoon(){ gsSync().catch(e=>console.warn('SEWZA group sync skipped:',e)); }
  function gsSync(){
    if(gsSyncRunning){ gsSyncQueued=true; return gsSyncRunning; }
    gsSyncRunning=(async()=>{
      try{ return await gsSyncNow(); }
      finally{ gsSyncRunning=null; if(gsSyncQueued){ gsSyncQueued=false; gsSyncSoon(); } }
    })();
    return gsSyncRunning;
  }
  async function gsSyncNow(){
    const client=supabaseClient();
    if(!client||!currentUser||!navigator.onLine) return false;
    const u=currentUser.id;
    await gsEnsure();
    const same=()=>!!currentUser&&currentUser.id===u&&groupsUid===u;
    if(!same()) return false;
    let allOk=true, wasSynced=false;
    try{ wasSynced=localStorage.getItem(GS_SYNCED_PREFIX+u)==='1'; }catch{}
    // First sync on this device: everything already saved on the phone is uploaded once.
    if(!wasSynced){ const p=gsPendRead(u); groups.forEach(g=>{ if(!p.up.includes(g.id)&&!p.del.includes(g.id)) p.up.push(g.id); }); gsPendWrite(u,p); }

    // 1) deletions
    for(const id of gsPendRead(u).del){
      try{
        const {error}=await client.from('customer_groups').delete().eq('user_id',u).eq('id',id);
        if(error) throw error;
        await gsCleanupPhotos(client,u,id,new Set(),0);
        gsPendDrop(u,'del',id);
      }catch(e){ allOk=false; gsSyncProblem(e); }
    }
    // 2) saves / edits
    for(const id of gsPendRead(u).up){
      if(!same()) return false;
      const g=groups.find(x=>x.id===id);
      if(!g){ gsPendDrop(u,'up',id); continue; }
      try{
        const stamp=g.updatedAt;
        const copy=await gsUploadPhotos(g,u);
        if(!same()) return false;
        const row={id:g.id,user_id:u,name:g.name,type:g.type,data:copy,updated_at:gsTime(g.updatedAt)?g.updatedAt:new Date().toISOString()};
        if(gsTime(g.createdAt)) row.created_at=g.createdAt;
        const {error}=await client.from('customer_groups').upsert(row,{onConflict:'user_id,id'});
        if(error) throw error;
        const cur=groups.find(x=>x.id===id);
        if(cur&&cur.updatedAt===stamp){
          // Unchanged since the upload started: keep the cloud photo links on the device and mark it done.
          groups=groups.map(x=>x.id===id?gsNormalizeState(copy):x);
          await gsPersist(groups);
          gsPendDrop(u,'up',id);
        }
        await gsCleanupPhotos(client,u,id,gsPhotoPaths(copy),10*60*1000);
      }catch(e){ allOk=false; gsSyncProblem(e); }
    }
    if(!same()) return false;
    // 3) pull everything the cloud has (new phone, or another device) and merge
    try{
      const {data:rows,error}=await client.from('customer_groups').select('id,data,created_at,updated_at').eq('user_id',u);
      if(error) throw error;
      if(!same()) return false;
      const pend=gsPendRead(u), pendUp=new Set(pend.up), pendDel=new Set(pend.del);
      const localById=new Map(groups.map(g=>[g.id,g])), cloudIds=new Set(), merged=[];
      (rows||[]).forEach(r=>{
        const id=String(r.id); cloudIds.add(id);
        if(pendDel.has(id)) return;
        const local=localById.get(id), cloudData=(r.data&&typeof r.data==='object')?r.data:{};
        if(local&&(pendUp.has(id)||gsTime(local.updatedAt)>=gsTime(cloudData.updatedAt||r.updated_at))){ merged.push(local); return; }
        const cg=gsNormalizeState({...cloudData,id});
        if(!cg.name) return;
        if(!cg.createdAt) cg.createdAt=r.created_at||''; if(!cg.updatedAt) cg.updatedAt=r.updated_at||'';
        merged.push(cg);
      });
      groups.forEach(g=>{ if(!cloudIds.has(g.id)&&(pendUp.has(g.id)||!wasSynced)) merged.push(g); });
      merged.sort((a,b)=>gsTime(b.createdAt)-gsTime(a.createdAt));
      const changed=merged.length!==groups.length||merged.some((g,i)=>g!==groups[i]);
      if(changed){
        groups=merged;
        await gsPersist(groups);
        if(gs&&gs.id&&!groups.some(g=>g.id===gs.id)) gs.id='';
        if(gsOpenId&&!groups.some(g=>g.id===gsOpenId)) gsCloseGroup(true);
        gsRenderStats(); gsRenderLibrary(); gsRefreshTabDot();
      }
      if(allOk){ try{ localStorage.setItem(GS_SYNCED_PREFIX+u,'1'); }catch{} }
    }catch(e){ allOk=false; gsSyncProblem(e); }
    return allOk;
  }

  // ----- images -----
  function gsCompress(file,maxDim,quality){
    return new Promise((resolve,reject)=>{
      if(!file||!/^image\//.test(file.type||'')) return reject(new Error('not-image'));
      const url=URL.createObjectURL(file), img=new Image();
      img.onload=()=>{
        try{
          const r=Math.min(1,maxDim/Math.max(img.naturalWidth,img.naturalHeight)||1);
          const w=Math.max(1,Math.round(img.naturalWidth*r)), h=Math.max(1,Math.round(img.naturalHeight*r));
          const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
          const ctx=cv.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,w,h); ctx.drawImage(img,0,0,w,h);
          URL.revokeObjectURL(url); resolve(cv.toDataURL('image/jpeg',quality));
        }catch(e){ URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error('load-failed')); };
      img.src=url;
    });
  }

  // ----- add-page mode -----
  function setAddMode(mode){
    mode=mode==='group'?'group':'single'; addMode=mode;
    const view=$('#view-add'); if(!view) return;
    view.classList.toggle('mode-group',mode==='group');
    const tabs=$('#addModeTabs'); if(tabs) tabs.dataset.mode=mode;
    $$('#addModeTabs [data-add-mode]').forEach(b=>{ const on=b.dataset.addMode===mode; b.classList.toggle('active',on); b.setAttribute('aria-selected',on?'true':'false'); });
    try{ localStorage.setItem(GS_MODE_PREFIX+gsUid(),mode); }catch{}
    if(mode==='group') gsEnsure().then(()=>{ if(addMode==='group') gsRenderAll(); }).catch(e=>console.warn('SEWZA group view skipped:',e));
    else gsRefreshTabDot();
  }
  function gsRefreshTabDot(){ const d=$('#amGroupDot'); if(d) d.hidden=!(addMode!=='group'&&groupsReady&&gs&&gsHasContent(gs)); }
  function gsOnShowAdd(){
    let target=addMode;
    if(gsFirstShow){ gsFirstShow=false; let stored='single'; try{stored=localStorage.getItem(GS_MODE_PREFIX+gsUid())||'single';}catch{} if(stored==='group'&&!$('#customerForm')?.dataset.editingId) target='group'; }
    setAddMode(target);
    gsEnsure().then(()=>{ gsRefreshTabDot(); gsRenderStats(); }).catch(()=>{});
  }
  function gsOnLeaveAdd(){ if(gsOpenId) gsCloseGroup(true); if(groupsReady) gsWriteDraft(); setAddMode('single'); }
  function gsWatchAddView(){
    const view=$('#view-add'); if(!view||typeof MutationObserver==='undefined') return;
    gsWasActive=view.classList.contains('active');
    new MutationObserver(()=>{ const on=view.classList.contains('active'); if(on&&!gsWasActive) gsOnShowAdd(); else if(!on&&gsWasActive) gsOnLeaveAdd(); gsWasActive=on; }).observe(view,{attributes:true,attributeFilter:['class']});
  }

  // ----- builder rendering -----
  function gsRenderAll(){ if(!gs) return; gsRenderStats(); gsRenderBuilderFields(); gsRenderCloth(); gsRenderMembers(); gsRenderSummary(); gsRenderLibrary(); gsRefreshTabDot(); }
  function gsRenderStats(){
    const set=(id,v)=>{ const e=$(id); if(e) e.textContent=v; };
    set('#grpStatGroups',groups.length); set('#grpStatPeople',groups.reduce((n,g)=>n+g.members.length,0)); set('#grpStatUniform',groups.filter(g=>g.type==='uniform').length);
  }
  function gsFillStyleSelect(){
    const sel=$('#grpStyle'); if(!sel) return;
    const groupsList=styleGroupsFor(gs.gender==='Mixed'?'Other':gs.gender);
    const uni=gs.type==='uniform'?`<optgroup label="Uniform pieces">${STYLE_UNIFORM.map(l=>`<option value="${escapeHTML(l)}">${escapeHTML(l)}</option>`).join('')}</optgroup>`:'';
    const all=[...(gs.type==='uniform'?STYLE_UNIFORM:[]),...groupsList.flatMap(g=>g.labels)];
    sel.innerHTML=uni+styleOptionsHTML(groupsList,all.includes(gs.style)?'':gs.style);
    if(![...sel.options].some(o=>o.value===gs.style)) gs.style=gsDefaultStyle(gs.type,gs.gender);
    if(![...sel.options].some(o=>o.value===gs.style)) gs.style=sel.options[0]?.value||'Custom';
    sel.value=gs.style;
  }
  function gsRenderBuilderFields(){
    $$('#groupBuilder [data-gtype]').forEach(b=>{ const on=b.dataset.gtype===gs.type; b.classList.toggle('active',on); b.setAttribute('aria-checked',on?'true':'false'); });
    const uni=gs.type==='uniform';
    const nl=$('#grpNameLabel'); if(nl) nl.textContent=uni?'School / group name':'Event / group name';
    const ni=$('#grpName'); if(ni){ ni.placeholder=uni?'e.g. Greenfield College, JSS 2':'e.g. Adeyemi Wedding Aso-ebi'; if(document.activeElement!==ni) ni.value=gs.name; }
    const cats=$('#grpCats'); if(cats) cats.innerHTML=GS_CATS[gs.type].map(c=>`<button type="button" role="radio" aria-checked="${c===gs.category}" class="grp-chip${c===gs.category?' active':''}" data-gcat="${escapeHTML(c)}">${escapeHTML(c)}</button>`).join('');
    const seg=$('#grpGender'); if(seg){ const i=['Female','Male','Mixed'].indexOf(gs.gender); seg.dataset.i=String(i); $$('#grpGender [data-gg]').forEach(b=>{ const on=b.dataset.gg===gs.gender; b.classList.toggle('active',on); b.setAttribute('aria-checked',on?'true':'false'); }); }
    const hint=$('#grpGenderHint'); if(hint) hint.textContent=gs.gender==='Mixed'?'Each person gets their own Female / Male switch.':`Measurement fields for everyone follow this choice (${gs.gender}).`;
    gsFillStyleSelect();
    const set=(id,v)=>{ const e=$(id); if(e&&document.activeElement!==e) e.value=v; };
    set('#grpStart',gs.startDate); set('#grpDelivery',gs.deliveryDate); set('#grpFabricWidth',String(gs.fabricWidth)); set('#grpPrice',gs.price); set('#grpNotes',gs.notes);
    const tr=$('#grpTrouser'); if(tr) tr.checked=!!gs.includeTrouser;
    $$('#groupBuilder [data-gunit]').forEach(b=>b.classList.toggle('active',b.dataset.gunit===gs.unit));
    const pl=$('#grpPasteLabel'); if(pl) pl.textContent=uni?'One person per line. Add the class after a comma, e.g. Tunde Bello, JSS 2A':'One name per line';
    const ph=$('#grpPeopleHint'); if(ph) ph.textContent=uni?'Name, class, measurements and a photo for each student.':'Name and measurements for each person.';
    const ed=$('#grpEditing'); if(ed){ const editing=!!gs.id; ed.hidden=!editing; const n=$('#grpEditingName'); if(n) n.textContent=gs.name||'group'; }
    const sb=$('#grpSave'); if(sb) sb.firstChild.textContent=gs.id?'Update group ':'Save group ';
  }
  function gsRenderCloth(){
    const box=$('#grpCloth'), drop=$('#grpDrop'); if(!box) return;
    box.innerHTML=gs.cloth.map((src,i)=>`<figure class="grp-thumb" style="--d:${i*50}ms"><img src="${src}" alt="Cloth photo ${i+1}">${i===0?'<span class="grp-cover-tag">Cover</span>':''}<button type="button" class="grp-thumb-x" data-cloth-del="${i}" aria-label="Remove photo ${i+1}">${GS_ICON.x}</button></figure>`).join('');
    if(drop){ drop.hidden=gs.cloth.length>=GS_MAX_CLOTH; const s=drop.querySelector('small'); if(s) s.textContent=gs.cloth.length?`${GS_MAX_CLOTH-gs.cloth.length} more allowed`:'Up to 6 photos'; }
  }
  function gsMemberHTML(m,i){
    const uni=gs.type==='uniform', g=gsMemberGender(gs,m), names=gsMeasureNames(g,gs.includeTrouser);
    const filled=names.filter(n=>String(m.m[n]||'').trim()).length;
    const photo=gsSafePhoto(m.photo);
    const genderSeg=gs.gender==='Mixed'?`<div class="grp-mg" role="radiogroup" aria-label="Gender of person ${i+1}"><button type="button" role="radio" aria-checked="${g==='Female'}" class="${g==='Female'?'active':''}" data-act="mgender" data-g="Female">Female</button><button type="button" role="radio" aria-checked="${g==='Male'}" class="${g==='Male'?'active':''}" data-act="mgender" data-g="Male">Male</button></div>`:'';
    return `<article class="grp-member${m.open?' open':''}" data-mid="${escapeHTML(m.id)}">
      <div class="grp-m-head">
        <span class="grp-m-no">${i+1}</span>
        <label class="grp-m-photo${photo?' has':''}" ${photo?`style="background-image:url('${photo}')"`:''} title="Add photo" aria-label="Add photo for person ${i+1}">${photo?'':GS_ICON.cam}<input type="file" accept="image/*" data-mphoto></label>
        <div class="grp-m-fields${uni?' two':''}">
          <input data-f="name" value="${escapeHTML(m.name)}" maxlength="80" placeholder="Full name" aria-label="Name of person ${i+1}" autocomplete="off">
          ${uni?`<input data-f="cls" value="${escapeHTML(m.cls)}" maxlength="40" placeholder="Class, e.g. JSS 2A" aria-label="Class of person ${i+1}" autocomplete="off">`:''}
        </div>
        <button type="button" class="grp-m-btn" data-act="toggle" aria-expanded="${m.open?'true':'false'}"><span>Measurements</span><small data-prog>${filled}/${names.length}</small>${GS_ICON.chev}</button>
        <button type="button" class="grp-m-del" data-act="remove" aria-label="Remove person ${i+1}">${GS_ICON.trash}</button>
      </div>
      <div class="grp-m-body"><div class="grp-m-in">
        ${genderSeg}
        <div class="grp-m-meas">${names.map(n=>`<label><span>${escapeHTML(n)}<small>${gs.unit}</small></span><input inputmode="decimal" data-meas="${escapeHTML(n)}" value="${escapeHTML(m.m[n]||'')}" maxlength="8" placeholder="e.g. 34.5"></label>`).join('')}</div>
        <div class="grp-m-extra">
          <label><span>Phone (optional)</span><input data-f="phone" inputmode="tel" value="${escapeHTML(m.phone)}" maxlength="30" placeholder="e.g. 0803 123 4567"></label>
          <label><span>Note (optional)</span><input data-f="note" value="${escapeHTML(m.note)}" maxlength="160" placeholder="e.g. loose fit"></label>
        </div>
      </div></div>
    </article>`;
  }
  function gsRenderMembers(){
    const box=$('#grpMembers'); if(!box) return;
    box.innerHTML=gs.members.length?gs.members.map(gsMemberHTML).join(''):'<p class="grp-empty">No one added yet. Tap “Add person” to start.</p>';
    const c=$('#grpCount'); if(c) c.textContent=gs.members.filter(m=>m.name.trim()).length;
  }
  function gsRenumber(){ $$('#grpMembers .grp-member').forEach((el,i)=>{ const n=el.querySelector('.grp-m-no'); if(n) n.textContent=i+1; }); const c=$('#grpCount'); if(c) c.textContent=gs.members.filter(m=>m.name.trim()).length; }
  function gsRenderSummary(){
    const box=$('#grpSummary'); if(!box) return;
    const st=gsStats(gs), parts=[`<div><b>${st.people}</b><span>${st.people===1?'person':'people'}</span></div>`];
    if(gs.type==='dress'&&st.people) parts.push(`<div><b>≈ ${fmtYd(st.yards)}</b><span>fabric (planning)</span></div>`);
    if(st.total) parts.push(`<div><b>${formatMoney(st.total)}</b><span>total price</span></div>`);
    box.innerHTML=parts.join('');
    const c=$('#grpCount'); if(c) c.textContent=st.people;
  }
  function gsFindMember(id){ return gs.members.find(m=>m.id===id); }
  function gsAddMember(focus=true){
    if(gs.members.length>=GS_MAX_MEMBERS){ showToast('Group is full',`A group can hold up to ${GS_MAX_MEMBERS} people. Save it and start another group.`); return null; }
    const prev=gs.members[gs.members.length-1]||null, m=gsBlankMember(prev); gs.members.push(m);
    const box=$('#grpMembers'); box.querySelector('.grp-empty')?.remove();
    box.insertAdjacentHTML('beforeend',gsMemberHTML(m,gs.members.length-1));
    const el=box.lastElementChild; el.classList.add('pop');
    gsRenumber(); gsRenderSummary(); gsTouch();
    if(focus){ el.scrollIntoView({behavior:'smooth',block:'center'}); setTimeout(()=>el.querySelector('[data-f="name"]')?.focus({preventScroll:true}),250); }
    return m;
  }
  function gsParseNames(text,uni){
    return String(text||'').split(/\r?\n/).map(l=>l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/,'').trim()).filter(Boolean).map(line=>{
      let name=line, cls='';
      if(uni){
        const t=line.split(/\t+|\s+[—–-]\s+/); if(t.length>1){ name=t[0].trim(); cls=t.slice(1).join(' ').trim(); }
        else { const i=line.lastIndexOf(','); if(i>0){ name=line.slice(0,i).trim(); cls=line.slice(i+1).trim(); } }
      }
      return {name:name.slice(0,80),cls:cls.slice(0,40)};
    }).filter(x=>x.name);
  }
  function gsPasteNames(){
    const ta=$('#grpPasteText'); const list=gsParseNames(ta.value,gs.type==='uniform');
    if(!list.length){ showToast('Nothing to add','Type or paste at least one name.'); return; }
    gs.members=gs.members.filter(m=>m.name.trim()||m.phone.trim()||m.note.trim()||m.photo||Object.keys(m.m).length);
    const room=GS_MAX_MEMBERS-gs.members.length, take=list.slice(0,Math.max(0,room));
    const prev=gs.members[gs.members.length-1]||null;
    take.forEach(x=>{ const m=gsBlankMember(prev); m.name=x.name; m.cls=x.cls||''; gs.members.push(m); });
    ta.value=''; $('#grpPaste').hidden=true; $('#grpPasteToggle').setAttribute('aria-expanded','false');
    gsRenderMembers(); gsRenderSummary(); gsTouch();
    showToast('People added',`${take.length} ${take.length===1?'person was':'people were'} added.${take.length<list.length?' The rest did not fit in this group.':''}`);
  }
  async function gsAddCloth(files){
    const room=GS_MAX_CLOTH-gs.cloth.length; const list=[...files].slice(0,room); if(!list.length) return;
    const drop=$('#grpDrop'); drop?.classList.add('busy'); let failed=0;
    for(const f of list){
      if(f.size>15*1024*1024){ failed++; continue; }
      try{ gs.cloth.push(await gsCompress(f,1100,.8)); }catch{ failed++; }
    }
    drop?.classList.remove('busy'); gsRenderCloth(); gsTouch();
    if(failed) showToast('Some photos were skipped','Use photos under 15MB in JPG, PNG or WebP format.');
    if(files.length>room) showToast('Photo limit reached',`Only ${GS_MAX_CLOTH} photos can be kept per group.`);
  }
  async function gsSetMemberPhoto(id,file){
    const m=gsFindMember(id); if(!m||!file) return;
    if(file.size>15*1024*1024){ showToast('Photo too large','Choose a photo under 15MB.'); return; }
    try{
      m.photo=await gsCompress(file,360,.82);
      const el=$(`#grpMembers [data-mid="${CSS.escape(id)}"] .grp-m-photo`);
      if(el){ el.classList.add('has'); el.style.backgroundImage=`url('${m.photo}')`; el.querySelector('svg')?.remove(); }
      gsTouch();
    }catch{ showToast('Could not read that photo','Try a JPG or PNG photo.'); }
  }
  function gsResetBuilder(){ gs=gsBlank(); gsDiscardDraft(); }

  async function gsSave(){
    if(gsSaving||!gs) return;
    const name=gs.name.trim();
    if(!name){ showToast('Group name needed','Give this group or event a name.'); $('#grpName')?.focus(); return; }
    const named=gs.members.filter(m=>m.name.trim());
    if(!named.length){ showToast('Add at least one person','Type a name for the first person.'); return; }
    if(gs.deliveryDate&&gs.startDate&&parseDateOnly(gs.deliveryDate)<parseDateOnly(gs.startDate)){ showToast('Check the dates','Delivery date cannot be before the starting date.'); return; }
    gsSaving=true; const btn=$('#grpSave'); if(btn){ btn.disabled=true; btn.classList.add('busy'); }
    try{
      const now=new Date().toISOString(), old=gs.id?groups.find(g=>g.id===gs.id):null;
      const rec=gsNormalizeState({...gs,id:old?old.id:uid('group'),name,members:named.map(m=>{
        const keep=new Set(gsMeasureNames(gsMemberGender(gs,m),gs.includeTrouser)), meas={};
        Object.entries(m.m).forEach(([k,v])=>{ if(keep.has(k)) meas[k]=v; });
        return {...m,name:m.name.trim(),cls:gs.type==='uniform'?m.cls.trim():'',m:meas};
      })});
      rec.createdAt=old?(old.createdAt||now):now; rec.updatedAt=now;
      const next=old?groups.map(g=>g.id===rec.id?rec:g):[rec,...groups];
      if(!(await gsPersist(next))){ showToast('Could not save','Your device storage may be full. Remove some photos and try again.'); return; }
      groups=next; gsMarkUp(rec.id); gsSyncSoon(); gsFresh(rec.id);
      gsResetBuilder(); gsFilter='all'; gsQuery=''; const s=$('#grpSearch'); if(s) s.value='';
      gsRenderAll();
      showToast(old?'Group updated':'Group saved',`${rec.name} · ${rec.members.length} ${rec.members.length===1?'person':'people'} saved.`);
      setTimeout(()=>$('#groupLibrary')?.scrollIntoView({behavior:'smooth',block:'start'}),120);
    }catch(err){ console.error('SEWZA group save failed:',err); showToast('Could not save','Please try again.'); }
    finally{ gsSaving=false; if(btn){ btn.disabled=false; btn.classList.remove('busy'); } }
  }
  function gsFresh(id){ gsFreshId=id; setTimeout(()=>{ if(gsFreshId===id){ gsFreshId=''; $$('.grp-card.fresh').forEach(c=>c.classList.remove('fresh')); } },3500); }

  // ----- library -----
  function gsFilteredGroups(){
    const q=gsQuery.trim().toLowerCase();
    return groups.filter(g=>{
      if(gsFilter==='type:uniform'&&g.type!=='uniform') return false;
      if(gsFilter==='type:dress'&&g.type!=='dress') return false;
      if(gsFilter.startsWith('cat:')&&g.category!==gsFilter.slice(4)) return false;
      if(!q) return true;
      return `${g.name} ${g.category} ${g.style} ${g.members.map(m=>`${m.name} ${m.cls}`).join(' ')}`.toLowerCase().includes(q);
    });
  }
  function gsRenderLibrary(){
    const f=$('#grpFilters'), c=$('#grpCards'); if(!f||!c) return;
    const cats=[...new Set(groups.map(g=>g.category))];
    const chip=(key,label,n)=>`<button type="button" class="grp-chip${gsFilter===key?' active':''}" data-gfilter="${escapeHTML(key)}">${escapeHTML(label)} <em>${n}</em></button>`;
    if(!cats.includes(gsFilter.slice(4))&&gsFilter.startsWith('cat:')) gsFilter='all';
    f.innerHTML=groups.length?chip('all','All',groups.length)+chip('type:uniform','Uniforms',groups.filter(g=>g.type==='uniform').length)+chip('type:dress','Dresses',groups.filter(g=>g.type==='dress').length)+cats.map(k=>chip('cat:'+k,k,groups.filter(g=>g.category===k).length)).join(''):'';
    const list=gsFilteredGroups();
    if(!groups.length){ c.innerHTML=`<div class="grp-empty-lib"><div class="grp-empty-ico">${GS_ICON.uniform}</div><b>No groups yet</b><p>Your saved uniforms and event orders will appear here, grouped by category.</p></div>`; return; }
    if(!list.length){ c.innerHTML='<div class="grp-empty-lib"><b>No matching groups</b><p>Try a different search or filter.</p></div>'; return; }
    c.innerHTML=list.map((g,i)=>{
      const cover=g.cloth[0], left=g.members.slice(0,4);
      return `<article class="grp-card${g.id===gsFreshId?' fresh':''}" data-gid="${escapeHTML(g.id)}" tabindex="0" role="button" aria-label="Open ${escapeHTML(g.name)}" style="--d:${Math.min(i,10)*55}ms">
        <div class="grp-card-cover ${cover?'':'plain '+g.type}" ${cover?`style="background-image:url('${cover}')"`:''}>${cover?'':`<span class="grp-card-ico">${GS_ICON[g.type]}</span>`}<span class="grp-badge ${g.type}">${g.type==='uniform'?'Uniform':'Dress'}</span>${g.cloth.length>1?`<span class="grp-photos">${g.cloth.length} photos</span>`:''}</div>
        <div class="grp-card-body"><h4>${escapeHTML(g.name)}</h4><p>${escapeHTML(g.category)} · ${escapeHTML(g.style)}</p>
        <div class="grp-card-meta"><span>${g.members.length} ${g.members.length===1?'person':'people'}</span><span>Due ${escapeHTML(gsFmtDate(g.deliveryDate))}</span></div>
        <div class="grp-avatars">${left.map(m=>`<i>${gsSafePhoto(m.photo)?`<img src="${m.photo}" alt="">`:escapeHTML((m.name[0]||'?').toUpperCase())}</i>`).join('')}${g.members.length>4?`<i class="more">+${g.members.length-4}</i>`:''}</div></div>
      </article>`;
    }).join('');
  }

  // ----- detail sheet -----
  function gsOpenGroup(id,trigger){
    const g=groups.find(x=>x.id===id); const modal=$('#grpModal'), sheet=$('#grpSheet'); if(!g||!modal||!sheet) return;
    gsOpenId=id; gsLastFocus=trigger||document.activeElement;
    const st=gsStats(g);
    const gallery=g.cloth.length?`<div class="grp-gallery">${g.cloth.map((s,i)=>`<img src="${s}" alt="Cloth photo ${i+1} of ${g.cloth.length}">`).join('')}</div>`:`<div class="grp-gallery plain ${g.type}"><span class="grp-card-ico">${GS_ICON[g.type]}</span></div>`;
    const stats=[`<div><b>${st.people}</b><span>${st.people===1?'person':'people'}</span></div>`];
    if(g.type==='dress') stats.push(`<div><b>≈ ${fmtYd(st.yards)}</b><span>fabric (planning)</span></div>`);
    if(st.total) stats.push(`<div><b>${formatMoney(st.total)}</b><span>total price</span></div>`);
    const rows=g.members.map(m=>{
      const ent=Object.entries(m.m||{});
      return `<div class="grp-prow"><button type="button" class="grp-prow-head" aria-expanded="false" data-prow><i class="grp-pav">${gsSafePhoto(m.photo)?`<img src="${m.photo}" alt="">`:escapeHTML((m.name[0]||'?').toUpperCase())}</i><span class="grp-pname"><b>${escapeHTML(m.name)}</b><small>${g.type==='uniform'&&m.cls?escapeHTML(m.cls)+' · ':''}${gsMemberGender(g,m)} · ${ent.length} measurement${ent.length===1?'':'s'}</small></span>${GS_ICON.chev}</button>
        <div class="grp-pbody"><div>${ent.length?`<div class="grp-pchips">${ent.map(([k,v])=>`<span><small>${escapeHTML(k)}</small><b>${escapeHTML(v)} ${g.unit}</b></span>`).join('')}</div>`:'<p class="muted">No measurements saved yet.</p>'}${m.phone?`<p class="grp-pmeta">Phone: ${escapeHTML(m.phone)}</p>`:''}${m.note?`<p class="grp-pmeta">Note: ${escapeHTML(m.note)}</p>`:''}</div></div></div>`;
    }).join('');
    sheet.innerHTML=`<button type="button" class="grp-x" data-grp-close aria-label="Close">${GS_ICON.x}</button>${gallery}
      <div class="grp-sheet-body"><p class="eyebrow">${g.type==='uniform'?'UNIFORM':'DRESS / EVENT'} · ${escapeHTML(g.category.toUpperCase())}</p><h2 id="grpModalTitle">${escapeHTML(g.name)}</h2>
      <div class="grp-pills"><span>${escapeHTML(g.style)}</span><span>${g.unit==='cm'?'Centimetres':'Inches'}</span><span>${g.fabricWidth}" fabric</span><span>Start ${escapeHTML(gsFmtDate(g.startDate))}</span><span>Due ${escapeHTML(gsFmtDate(g.deliveryDate))}</span></div>
      <div class="grp-stats">${stats.join('')}</div>
      ${g.notes?`<p class="grp-notes">${escapeHTML(g.notes)}</p>`:''}
      <h3 class="grp-ph">People (${g.members.length})</h3><div class="grp-plist">${rows}</div>
      <div class="grp-sheet-actions"><button type="button" class="primary-btn" data-grp-edit>Edit group</button><button type="button" class="ghost-btn grp-del" data-grp-delete>Delete group</button></div></div>`;
    modal.classList.add('show'); modal.setAttribute('aria-hidden','false');
    document.body.classList.add('grp-lock');
    sheet.scrollTop=0; setTimeout(()=>sheet.querySelector('.grp-x')?.focus({preventScroll:true}),60);
  }
  function gsCloseGroup(silent){
    const modal=$('#grpModal'); if(!modal) return;
    clearTimeout(gsDeleteTimer); gsOpenId='';
    modal.classList.remove('show'); modal.setAttribute('aria-hidden','true'); document.body.classList.remove('grp-lock');
    if(!silent&&gsLastFocus&&document.contains(gsLastFocus)) try{ gsLastFocus.focus({preventScroll:true}); }catch{}
    gsLastFocus=null;
  }
  function gsStartEdit(id){
    const g=groups.find(x=>x.id===id); if(!g) return;
    if(gsHasContent(gs)&&gs.id!==id&&!window.confirm('Replace the unfinished group in the form with this one?')) return;
    gs=gsNormalizeState(JSON.parse(JSON.stringify(g)));
    gs.includeTrouser=!!g.includeTrouser; gs.genderTouched=true;
    gsCloseGroup(true); setAddMode('group'); gsRenderAll(); gsTouch();
    setTimeout(()=>$('#groupBuilder')?.scrollIntoView({behavior:'smooth',block:'start'}),80);
  }
  async function gsDelete(id){
    const next=groups.filter(g=>g.id!==id);
    if(!(await gsPersist(next))){ showToast('Could not delete','Please try again.'); return; }
    const gone=groups.find(g=>g.id===id); groups=next; gsMarkDel(id); gsSyncSoon();
    if(gs.id===id){ gs.id=''; gsTouch(); }
    gsCloseGroup(true); gsRenderAll(); showToast('Group deleted',`${gone?.name||'The group'} was removed.`);
  }

  // ----- events -----
  function bindStudio(){
    $('#customerGender')?.addEventListener('change',e=>{ const g=e.target.value==='Male'||e.target.value==='Female'?e.target.value:'Other'; const cur=$('#customerCategory')?.value||''; const inList=styleGroupsFor(g).some(gr=>gr.labels.includes(cur)); renderStyleOptions(e.target.value,inList?cur:''); renderDraftFabricEstimate(); });
    $('#addModeTabs')?.addEventListener('click',e=>{ const b=e.target.closest('[data-add-mode]'); if(b) setAddMode(b.dataset.addMode); });
    gsWatchAddView();
    const bld=$('#groupBuilder'); if(!bld) return;
    bld.addEventListener('click',e=>{
      const t=e.target;
      const type=t.closest('[data-gtype]');
      if(type){ const nt=type.dataset.gtype; if(nt!==gs.type){ gs.type=nt; if(!GS_CATS[nt].includes(gs.category)) gs.category=GS_CATS[nt][0]; if(!gs.genderTouched&&!gs.id) gs.gender=nt==='uniform'?'Mixed':'Female'; gs.style=gsDefaultStyle(nt,gs.gender); gsRenderBuilderFields(); gsRenderMembers(); gsRenderSummary(); gsTouch(); } return; }
      const cat=t.closest('[data-gcat]'); if(cat){ gs.category=cat.dataset.gcat; gsRenderBuilderFields(); gsTouch(); return; }
      const gg=t.closest('[data-gg]'); if(gg){ gs.gender=gg.dataset.gg; gs.genderTouched=true; gsRenderBuilderFields(); gsRenderMembers(); gsRenderSummary(); gsTouch(); return; }
      const un=t.closest('[data-gunit]'); if(un){ gs.unit=un.dataset.gunit; gsRenderBuilderFields(); gsRenderMembers(); gsRenderSummary(); gsTouch(); return; }
      const cd=t.closest('[data-cloth-del]'); if(cd){ gs.cloth.splice(Number(cd.dataset.clothDel),1); gsRenderCloth(); gsTouch(); return; }
      const act=t.closest('[data-act]');
      if(act){
        const card=act.closest('.grp-member'); const m=card&&gsFindMember(card.dataset.mid); if(!m) return;
        if(act.dataset.act==='toggle'){ m.open=!m.open; card.classList.toggle('open',m.open); act.setAttribute('aria-expanded',m.open?'true':'false'); }
        else if(act.dataset.act==='remove'){ card.classList.add('leaving'); setTimeout(()=>{ gs.members=gs.members.filter(x=>x.id!==m.id); card.remove(); if(!gs.members.length) gsRenderMembers(); gsRenumber(); gsRenderSummary(); gsTouch(); },220); }
        else if(act.dataset.act==='mgender'){ m.gender=act.dataset.g==='Male'?'Male':'Female'; m.open=true; card.outerHTML=gsMemberHTML(m,gs.members.indexOf(m)); gsRenderSummary(); gsTouch(); }
        return;
      }
      if(t.closest('#grpAddMember')){ gsAddMember(true); return; }
      if(t.closest('#grpPasteToggle')){ const p=$('#grpPaste'); p.hidden=!p.hidden; $('#grpPasteToggle').setAttribute('aria-expanded',p.hidden?'false':'true'); if(!p.hidden) setTimeout(()=>$('#grpPasteText')?.focus(),60); return; }
      if(t.closest('#grpPasteGo')){ gsPasteNames(); return; }
      if(t.closest('#grpSave')){ gsSave(); return; }
      if(t.closest('#grpCancelEdit')){ gsResetBuilder(); gsRenderAll(); return; }
      if(t.closest('#grpClear')){ if(!gsHasContent(gs)&&!gs.id){ gsResetBuilder(); gsRenderAll(); return; } if(window.confirm('Clear everything in this form?')){ gsResetBuilder(); gsRenderAll(); } return; }
    });
    bld.addEventListener('input',e=>{
      const t=e.target;
      if(t.id==='grpName'){ gs.name=t.value; const n=$('#grpEditingName'); if(n) n.textContent=gs.name||'group'; }
      else if(t.id==='grpPrice'){ gs.price=t.value.replace(/[^0-9.]/g,''); if(t.value!==gs.price) t.value=gs.price; gsRenderSummary(); }
      else if(t.id==='grpNotes') gs.notes=t.value;
      else if(t.matches('[data-f],[data-meas]')){
        const card=t.closest('.grp-member'); const m=card&&gsFindMember(card.dataset.mid); if(!m) return;
        if(t.dataset.meas){ const v=t.value.trim(); if(v) m.m[t.dataset.meas]=v; else delete m.m[t.dataset.meas]; const names=gsMeasureNames(gsMemberGender(gs,m),gs.includeTrouser); const p=card.querySelector('[data-prog]'); if(p) p.textContent=`${names.filter(n=>String(m.m[n]||'').trim()).length}/${names.length}`; gsRenderSummary(); }
        else { m[t.dataset.f]=t.value; if(t.dataset.f==='name') gsRenderSummary(); }
      } else return;
      gsTouch();
    });
    bld.addEventListener('change',e=>{
      const t=e.target;
      if(t.id==='grpStyle'){ gs.style=t.value; gsRenderSummary(); }
      else if(t.id==='grpStart') gs.startDate=t.value;
      else if(t.id==='grpDelivery') gs.deliveryDate=t.value;
      else if(t.id==='grpFabricWidth'){ gs.fabricWidth=Number(t.value)===60?60:45; gsRenderSummary(); }
      else if(t.id==='grpTrouser'){ gs.includeTrouser=t.checked; gsRenderMembers(); gsRenderSummary(); }
      else if(t.id==='grpClothInput'){ gsAddCloth(t.files||[]).finally(()=>{ t.value=''; }); return; }
      else if(t.matches('[data-mphoto]')){ const card=t.closest('.grp-member'); const f=t.files?.[0]; if(card&&f) gsSetMemberPhoto(card.dataset.mid,f).finally(()=>{ t.value=''; }); return; }
      else return;
      gsTouch();
    });
    $('#grpSearch')?.addEventListener('input',e=>{ clearTimeout(gsSearchTimer); const v=e.target.value; gsSearchTimer=setTimeout(()=>{ gsQuery=v; gsRenderLibrary(); },150); });
    $('#grpFilters')?.addEventListener('click',e=>{ const b=e.target.closest('[data-gfilter]'); if(b){ gsFilter=b.dataset.gfilter; gsRenderLibrary(); } });
    const open=e=>{ const c=e.target.closest('.grp-card'); if(c) gsOpenGroup(c.dataset.gid,c); };
    $('#grpCards')?.addEventListener('click',open);
    $('#grpCards')?.addEventListener('keydown',e=>{ if((e.key==='Enter'||e.key===' ')&&e.target.classList.contains('grp-card')){ e.preventDefault(); open(e); } });
    const modal=$('#grpModal');
    modal?.addEventListener('click',e=>{
      if(e.target===modal||e.target.closest('[data-grp-close]')){ gsCloseGroup(); return; }
      const row=e.target.closest('[data-prow]'); if(row){ const p=row.parentElement; const on=!p.classList.contains('open'); p.classList.toggle('open',on); row.setAttribute('aria-expanded',on?'true':'false'); return; }
      if(e.target.closest('[data-grp-edit]')){ gsStartEdit(gsOpenId); return; }
      const del=e.target.closest('[data-grp-delete]');
      if(del){ if(del.classList.contains('confirm')){ gsDelete(gsOpenId); } else { del.classList.add('confirm'); del.textContent='Tap again to delete'; clearTimeout(gsDeleteTimer); gsDeleteTimer=setTimeout(()=>{ del.classList.remove('confirm'); del.textContent='Delete group'; },4000); } }
    });
    document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&gsOpenId) gsCloseGroup(); });
    window.addEventListener('online',()=>{ if(currentUser) gsSyncSoon(); });
    window.addEventListener('pagehide',()=>{ if(groupsReady) gsWriteDraft(); });
    document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden'&&groupsReady) gsWriteDraft(); });
  }
  // =====================================================================
  // Work Gallery / Tailor Portfolio — editor (public page: portfolio.html)
  // Table: tailor_portfolios · Storage bucket: portfolio-media · See SUPABASE_PORTFOLIO_MIGRATION.sql
  // =====================================================================
  const PF_BUCKET='portfolio-media', PF_MAX_WORKS=60, PF_MAX_SPEC=10, PF_SLUG_RE=/^[a-z0-9][a-z0-9-]{2,39}$/;
  const PF_SOCIALS=[['instagram','Instagram','@yourname'],['tiktok','TikTok','@yourname'],['facebook','Facebook','page name or link'],['twitter','X (Twitter)','@yourname'],['youtube','YouTube','@channel or link'],['website','Website','www.yourwebsite.com']];
  const PF_SUGGEST=['Aso-ebi','Wedding gowns','Agbada','Native wear','Corset dresses','Kaftan','Men’s suits','Kids wear','School uniforms','Lace outfits','Ankara styles','Alterations'];
  const PF_CATS=['Native wear','Gowns','Aso-ebi','Wedding','Men’s wear','Women’s wear','Kids','Corporate','Uniforms'];
  const PF_MAX_SVC=10, PF_MAX_FAQ=10;
  const PF_THEMES=[
    {id:'emerald',name:'Emerald & Gold',c:['#04382b','#064e3b','#0f766e','#d4af37']},
    {id:'royal',name:'Royal Navy',c:['#091633','#11285c','#2349a8','#d4af37']},
    {id:'rose',name:'Rose Gold',c:['#4a1830','#86254f','#bf3f6e','#d99a85']},
    {id:'plum',name:'Plum & Champagne',c:['#24093f','#46198a','#6d34c4','#e0b84a']},
    {id:'noir',name:'Noir & Gold',c:['#09090b','#16161a','#2e2e38','#c9a227']},
    {id:'terracotta',name:'Terracotta',c:['#351405','#7a2c10','#b24f1f','#d6b58c']},
    {id:'burgundy',name:'Burgundy',c:['#330814','#651225','#9a2438','#d4af37']},
    {id:'ocean',name:'Ocean & Coral',c:['#052a33','#0a4b5c','#0e7f92','#f0a58b']}
  ];
  const PF_FONTS=[{id:'classic',name:'Classic',ff:'"Playfair Display",Georgia,serif'},{id:'luxe',name:'Luxe',ff:'"Cormorant Garamond","Playfair Display",Georgia,serif'},{id:'modern',name:'Modern',ff:'"Syne","Manrope",system-ui,sans-serif'}];
  const PF_SVC_SUGGEST=['Custom outfits','Wedding gowns','Aso-ebi sets','Native wear','Men’s suits','Kids wear','Alterations'];
  const PF_FAQ_SUGGEST=['How long does an outfit take?','Do you deliver?','How much deposit do I pay?','Can you copy a style from a photo?'];
  const PF_TABS=['profile','design','work','services','reviews'];
  let pf={uid:null,loaded:false,loading:null,dirty:false,saving:false,busyPhotos:false,saved:null,form:null,slugTimer:null,slugSeq:0,notice:'',tab:'profile',noSettings:false};
  let pfRv={loaded:false,loading:false,items:[],missing:false,error:'',filter:'all',busy:''};

  function pfBlank(){
    return {slug:'',slugTouched:false,business_name:'',tagline:'',about:'',location:'',whatsapp:'',logo:'',specialties:[],socials:{},works:[],published:false,views:0,settings:pfDefaultSettings()};
  }
  function pfDefaultSettings(){
    return {theme:'emerald',font:'classic',hero:{image:''},slideshow:{on:true,auto:true},chat:{on:true,msg:'',bubble:''},banner:'',services:[],faqs:[],hours:'',mapUrl:'',show:{steps:true,reviews:true}};
  }
  function pfNormSettings(raw){
    const s=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{}, o=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
    const hero=o(s.hero), sw=o(s.slideshow), ch=o(s.chat), sh=o(s.show), t=x=>String(x==null?'':x);
    return {
      theme:PF_THEMES.some(x=>x.id===s.theme)?s.theme:'emerald', font:PF_FONTS.some(x=>x.id===s.font)?s.font:'classic',
      hero:{image:pfIsCloud(hero.image)?hero.image:''}, slideshow:{on:sw.on!==false,auto:sw.auto!==false},
      chat:{on:ch.on!==false,msg:t(ch.msg).slice(0,160),bubble:t(ch.bubble).slice(0,40)}, banner:t(s.banner).slice(0,140),
      services:(Array.isArray(s.services)?s.services:[]).filter(x=>x&&typeof x==='object').slice(0,PF_MAX_SVC).map(x=>({id:t(x.id)||uid('s'),name:t(x.name).slice(0,60),price:t(x.price).slice(0,30),desc:t(x.desc).slice(0,160)})),
      faqs:(Array.isArray(s.faqs)?s.faqs:[]).filter(x=>x&&typeof x==='object').slice(0,PF_MAX_FAQ).map(x=>({id:t(x.id)||uid('q'),q:t(x.q).slice(0,120),a:t(x.a).slice(0,400)})),
      hours:t(s.hours).slice(0,200), mapUrl:t(s.mapUrl).slice(0,300), show:{steps:sh.steps!==false,reviews:sh.reviews!==false}
    };
  }
  function pfSlugify(t){
    return String(t||'').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/&/g,' and ').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40).replace(/-+$/,'');
  }
  function pfUrl(slug){
    const u=new URL('portfolio.html',location.href); u.search='?t='+encodeURIComponent(slug); u.hash=''; return u.href;
  }
  function pfMediaPrefix(){ const u=window.SEWZA_SUPABASE_CONFIG&&window.SEWZA_SUPABASE_CONFIG.url; return u?String(u).replace(/\/$/,'')+'/storage/v1/object/public/'+PF_BUCKET+'/':null; }
  function pfIsCloud(u){ const pre=pfMediaPrefix(); return typeof u==='string'&&!!pre&&u.startsWith(pre); }
  function pfFromRow(r){
    const soc=r.socials&&typeof r.socials==='object'?r.socials:{};
    return {slug:String(r.slug||''),slugTouched:true,business_name:String(r.business_name||''),tagline:String(r.tagline||''),about:String(r.about||''),location:String(r.location||''),
      whatsapp:String(r.whatsapp||''),logo:pfIsCloud(r.logo_url)?r.logo_url:'',specialties:(Array.isArray(r.specialties)?r.specialties:[]).map(x=>String(x)).filter(Boolean).slice(0,PF_MAX_SPEC),
      socials:Object.fromEntries(PF_SOCIALS.map(s=>[s[0],String(soc[s[0]]||'')]).filter(x=>x[1])),
      works:(Array.isArray(r.works)?r.works:[]).filter(w=>w&&pfIsCloud(w.url)).slice(0,PF_MAX_WORKS).map(w=>({id:String(w.id||uid('w')),url:w.url,title:String(w.title||''),category:String(w.category||''),caption:String(w.caption||''),featured:w.featured===true})),
      published:!!r.published,views:Number(r.views)||0,settings:pfNormSettings(r.settings)};
  }
  function pfSocialUrl(key,raw){
    const v=String(raw||'').trim(); if(!v) return '';
    let url=v;
    if(!/^https?:\/\//i.test(v)){
      const h=v.replace(/^@/,'');
      if(/^[A-Za-z0-9._]{1,60}$/.test(h)&&(key==='instagram'||key==='tiktok'||key==='facebook'||key==='twitter'||(key==='youtube'&&v.startsWith('@')))){
        url=({instagram:'https://instagram.com/'+h,tiktok:'https://tiktok.com/@'+h,facebook:'https://facebook.com/'+h,twitter:'https://x.com/'+h,youtube:'https://youtube.com/@'+h})[key];
      } else url='https://'+v.replace(/^\/+/,'');
    }
    try{ const x=new URL(url); if((x.protocol==='https:'||x.protocol==='http:')&&x.hostname.includes('.')) return x.href; }catch{}
    return null;
  }
  function pfWaDigits(raw){ const d=nigeriaWhatsAppPhone(raw); return d.length>=8&&d.length<=15?d:''; }

  // ----- small UI helpers -----
  function pfNotice(text){ pf.notice=text||''; const n=$('#pfNotice'); if(!n) return; n.textContent=pf.notice; n.hidden=!pf.notice; }
  function pfMarkDirty(){ pf.dirty=true; pfRenderStatus(); }
  function pfRenderStatus(){
    const el=$('#pfStatus'); if(!el) return;
    let state='new', text='Not set up';
    if(pf.dirty){ state='unsaved'; text='Unsaved changes'; }
    else if(pf.saved){ if(pf.saved.published){ state='live'; text='Live'; } else { state='draft'; text='Saved · not published'; } }
    el.dataset.state=state; el.textContent=text;
    const live=!!(pf.saved&&pf.saved.published);
    ['#pfShareWa','#pfCopy','#pfPreview','#pfRvInvite','#pfRvCopy'].forEach(s=>{ const b=$(s); if(b) b.disabled=!(pf.saved&&live); });
    const hint=$('#pfShareHint');
    if(hint) hint.textContent=!pf.saved?'Save and publish your portfolio to start sharing.':!live?'Your portfolio is saved but hidden. Turn on “Publish my portfolio” and save to share it.':(pf.dirty?'You have unsaved changes. Save them so customers see the latest version.':'Your portfolio is live. Send the link to customers on WhatsApp.');
    const v=$('#pfViews'); if(v){ const n=pf.form?.views||0; v.hidden=!(pf.saved&&live); v.textContent=`${n} ${n===1?'visit':'visits'}`; }
    const ph=$('#pfPublishHint'); const pub=$('#pfPublished'); if(ph&&pub) ph.textContent=pub.checked?'Anyone with your link can see it.':'Hidden. Only you can see it for now.';
    pfRenderProgress(); pfRenderLive();
  }
  function pfRenderLink(){
    const pre=$('#pfLinkPre'); if(pre){ try{ const u=new URL('portfolio.html',location.href); pre.textContent=u.host+u.pathname.replace(/[^/]*$/,'')+'portfolio.html?t='; }catch{ pre.textContent='portfolio.html?t='; } }
  }
  function pfRenderLogo(){
    const el=$('#pfLogo'), f=pf.form; if(!el||!f) return;
    if(f.logo){ el.style.backgroundImage=`url("${f.logo}")`; el.classList.add('has'); el.textContent=''; }
    else { el.style.backgroundImage=''; el.classList.remove('has'); el.textContent=(f.business_name||'S').trim().charAt(0).toUpperCase()||'S'; }
    const rm=$('#pfLogoRemove'); if(rm) rm.hidden=!f.logo;
  }
  function pfRenderSpecs(){
    const f=pf.form; if(!f) return;
    const list=$('#pfSpecList'); if(list) list.innerHTML=f.specialties.map((s,i)=>`<span class="pf-chip"><span>${escapeHTML(s)}</span><button type="button" data-pf-spec-del="${i}" aria-label="Remove ${escapeHTML(s)}">×</button></span>`).join('');
    const sug=$('#pfSpecSuggest'); if(sug){
      const have=new Set(f.specialties.map(x=>x.toLowerCase()));
      sug.innerHTML=f.specialties.length>=PF_MAX_SPEC?'':PF_SUGGEST.filter(x=>!have.has(x.toLowerCase())).slice(0,8).map(x=>`<button type="button" class="pf-sug" data-pf-spec-add="${escapeHTML(x)}">+ ${escapeHTML(x)}</button>`).join('');
    }
  }
  function pfRenderWorks(){
    const f=pf.form, box=$('#pfWorks'); if(!f||!box) return;
    box.innerHTML=f.works.map((w,i)=>`<div class="pf-work" data-wid="${escapeHTML(w.id)}">
      <div class="pf-work-img"><img src="${escapeHTML(w.url)}" alt="Design ${i+1}" loading="lazy" decoding="async"><span class="pf-work-n">${i+1}</span>${w.url.startsWith('data:')?'<span class="pf-work-new">NEW</span>':''}</div>
      <div class="pf-work-body">
        <input type="text" data-wf="title" maxlength="70" placeholder="Design name" value="${escapeHTML(w.title)}" aria-label="Name of design ${i+1}">
        <input type="text" data-wf="category" maxlength="40" list="pfCatList" placeholder="Category e.g. Gowns" value="${escapeHTML(w.category)}" aria-label="Category of design ${i+1}">
        <textarea data-wf="caption" maxlength="240" rows="2" placeholder="Short note (optional)" aria-label="Note for design ${i+1}">${escapeHTML(w.caption)}</textarea>
        <div class="pf-work-tools"><button type="button" data-pf-act="first" ${i===0?'disabled':''} title="Show first on your page" aria-label="Move design ${i+1} to the front">⤒ First</button><button type="button" class="pf2-star${w.featured?' on':''}" data-pf-act="star" aria-pressed="${w.featured?'true':'false'}" title="Feature in the slideshow" aria-label="Feature design ${i+1} in the slideshow">★</button><button type="button" data-pf-act="left" ${i===0?'disabled':''} aria-label="Move design ${i+1} earlier">←</button><button type="button" data-pf-act="right" ${i===f.works.length-1?'disabled':''} aria-label="Move design ${i+1} later">→</button><button type="button" class="pf-del" data-pf-act="del" aria-label="Delete design ${i+1}">Delete</button></div>
      </div></div>`).join('')+(f.works.length?`<datalist id="pfCatList">${PF_CATS.map(c=>`<option value="${escapeHTML(c)}"></option>`).join('')}</datalist>`:'');
    const hint=$('#pfDropHint'); if(hint) hint.textContent=f.works.length>=PF_MAX_WORKS?`You have reached the limit of ${PF_MAX_WORKS} photos.`:`${f.works.length} of ${PF_MAX_WORKS} photos added. They are made smaller automatically.${f.works.some(x=>x.featured)?` ${f.works.filter(x=>x.featured).length} starred for the slideshow.`:''}`;
  }
  function pfRenderSocials(){
    const box=$('#pfSocials'); if(!box) return;
    if(!box.dataset.ready){
      box.innerHTML=PF_SOCIALS.map(s=>`<label>${escapeHTML(s[1])}<input type="text" data-pf-soc="${s[0]}" maxlength="200" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="${escapeHTML(s[2])}"></label>`).join('');
      box.dataset.ready='1';
    }
    PF_SOCIALS.forEach(s=>{ const i=box.querySelector(`[data-pf-soc="${s[0]}"]`); if(i) i.value=pf.form.socials[s[0]]||''; });
  }
  function pfFillForm(){
    const f=pf.form; if(!f) return;
    const set=(id,v)=>{ const e=$(id); if(e) e.value=v; };
    set('#pfName',f.business_name); set('#pfLocation',f.location); set('#pfWhatsapp',f.whatsapp?(/^\d+$/.test(f.whatsapp)?'+'+f.whatsapp:f.whatsapp):''); set('#pfTagline',f.tagline); set('#pfAbout',f.about); set('#pfSlug',f.slug);
    const p=$('#pfPublished'); if(p) p.checked=!!f.published;
    pfRenderLink(); pfRenderLogo(); pfRenderSpecs(); pfRenderWorks(); pfRenderSocials(); pfRenderDesign(); pfRenderRows(); pfRenderReviews(); pfRenderUpgrade(); pfRenderStatus(); pfSlugHint('');
  }
  function pfSlugHint(msg,kind){
    const h=$('#pfSlugHint'); if(!h) return;
    h.textContent=msg||'Letters, numbers and dashes only. Customers will see this in your link.'; h.classList.toggle('ok',kind==='ok'); h.classList.toggle('bad',kind==='bad');
  }

  // ----- loading -----
  function pfPrefill(f){
    const p=currentProfile||{}, m=currentUser?.user_metadata||{};
    f.business_name=p.business_name||m.business_name||'';
    if(f.business_name){ f.slug=pfSlugify(f.business_name); }
    return f;
  }
  function pfStatusFromError(e){
    const t=`${e?.code||''} ${e?.message||''}`;
    if(/42P01|PGRST205|tailor_portfolios/i.test(t)&&!isNetworkError(e)) return 'Portfolio is not set up in Supabase yet. Run SUPABASE_PORTFOLIO_MIGRATION.sql once in your Supabase SQL Editor, then reopen this page.';
    return isNetworkError(e)?`${INTERNET_FAILED}. ${INTERNET_FAILED_HELP}`:'Could not load your portfolio. Please try again.';
  }
  async function pfEnsure(force){
    if(!currentUser) return;
    const uidNow=currentUser.id;
    if(pf.uid!==uidNow){ pf={uid:uidNow,loaded:false,loading:null,dirty:false,saving:false,busyPhotos:false,saved:null,form:pfPrefill(pfBlank()),slugTimer:null,slugSeq:0,notice:'',tab:pf.tab||'profile',noSettings:false}; pfRv={loaded:false,loading:false,items:[],missing:false,error:'',filter:'all',busy:''}; pfFillForm(); }
    if(pf.loading) return pf.loading;
    if(pf.loaded&&!force){ pfRenderStatus(); return; }
    const client=supabaseClient();
    if(!client||!navigator.onLine){ pfNotice(`${INTERNET_FAILED}. Connect to the internet to set up or change your portfolio.`); pfFillForm(); return; }
    const panel=$('#pfPanel'); panel?.classList.add('pf-loading');
    pf.loading=(async()=>{
      try{
        const {data,error}=await client.from('tailor_portfolios').select('*').eq('user_id',uidNow).maybeSingle();
        if(error) throw error;
        if(!currentUser||currentUser.id!==uidNow||pf.uid!==uidNow) return;
        if(data){ if(!pf.dirty){ pf.form=pfFromRow(data); } pf.saved={slug:data.slug,published:!!data.published}; pf.form.views=Number(data.views)||0; pf.noSettings=!('settings' in data); }
        pf.loaded=true; pfNotice('');
        if(!data&&pf.form.slug) pfCheckSlug();
        pfFillForm();
        if(data) pfLoadReviews().catch(()=>{});
      }catch(e){ console.warn('SEWZA portfolio load failed:',e); pfNotice(pfStatusFromError(e)); pfFillForm(); }
      finally{ pf.loading=null; panel?.classList.remove('pf-loading'); }
    })();
    return pf.loading;
  }

  // ----- slug availability -----
  function pfCheckSlug(){
    clearTimeout(pf.slugTimer); const f=pf.form; if(!f) return;
    const slug=f.slug;
    if(!slug){ pfSlugHint(''); return; }
    if(!PF_SLUG_RE.test(slug)){ pfSlugHint('Use 3 to 40 letters, numbers or dashes.','bad'); return; }
    const client=supabaseClient(); if(!client||!navigator.onLine){ pfSlugHint(''); return; }
    const seq=++pf.slugSeq; pfSlugHint('Checking…');
    pf.slugTimer=setTimeout(async()=>{
      try{
        const {data,error}=await client.rpc('portfolio_slug_available',{p_slug:slug});
        if(seq!==pf.slugSeq||!pf.form||pf.form.slug!==slug) return;
        if(error) throw error;
        pfSlugHint(data===false?'That link name is already taken. Try another one.':'Great — this link name is available.'+(pf.saved&&pf.saved.slug!==slug?' Links you already shared will stop working.':''),data===false?'bad':'ok');
      }catch(e){ if(seq===pf.slugSeq) pfSlugHint(''); }
    },450);
  }

  // ----- photos -----
  async function pfSetLogo(file){
    try{ pf.form.logo=await gsCompress(file,480,.9); pfRenderLogo(); pfMarkDirty(); }
    catch{ showToast('Could not read that picture','Try a JPG or PNG picture.'); }
  }
  async function pfAddWorks(files){
    const f=pf.form; if(!f||pf.busyPhotos) return;
    const room=PF_MAX_WORKS-f.works.length;
    const list=[...files].filter(x=>x&&/^image\//.test(x.type||'')); 
    if(!list.length){ if(files.length) showToast('Photos only','Please choose JPG or PNG photos.'); return; }
    if(room<=0){ showToast('Photo limit reached',`You can add up to ${PF_MAX_WORKS} photos.`); return; }
    const take=list.slice(0,room); pf.busyPhotos=true; $('#pfDrop')?.classList.add('busy');
    let failed=0, added=0;
    try{
      for(let i=0;i<take.length;i++){
        const hint=$('#pfDropHint'); if(hint) hint.textContent=`Preparing photo ${i+1} of ${take.length}…`;
        try{ f.works.push({id:uid('w'),url:await gsCompress(take[i],1400,.82),title:'',category:'',caption:'',featured:false}); added++; }catch{ failed++; }
      }
    } finally{ pf.busyPhotos=false; $('#pfDrop')?.classList.remove('busy'); }
    pfRenderWorks(); if(added) pfMarkDirty();
    if(list.length>take.length) showToast('Photo limit reached',`Only ${take.length} of ${list.length} photos fit. The limit is ${PF_MAX_WORKS}.`);
    else if(failed) showToast('Some photos were skipped',`${failed} ${failed===1?'photo':'photos'} could not be read. Try JPG or PNG.`);
  }

  // ----- saving -----
  async function pfCleanup(client,uidNow,keepUrls){
    try{
      const pre=pfMediaPrefix(); const keep=new Set(keepUrls.filter(u=>typeof u==='string'&&u.startsWith(pre)).map(u=>decodeURIComponent(u.slice(pre.length).split('?')[0])));
      const bucket=client.storage.from(PF_BUCKET);
      const {data,error}=await bucket.list(uidNow,{limit:1000}); if(error||!Array.isArray(data)) return;
      const gone=data.filter(x=>x&&x.name&&x.id!==null&&!keep.has(`${uidNow}/${x.name}`)&&(!x.created_at||Date.now()-Date.parse(x.created_at)>10*60*1000)).map(x=>`${uidNow}/${x.name}`);
      if(gone.length) await bucket.remove(gone);
    }catch(e){ console.warn('SEWZA portfolio cleanup skipped:',e); }
  }
  function pfSetSaving(on,label){
    const b=$('#pfSave'); if(!b) return; b.disabled=!!on; b.classList.toggle('busy',!!on);
    b.firstChild.textContent=on?(label||'Saving… '):'Save portfolio ';
  }
  async function pfSave(){
    if(pf.saving||pf.busyPhotos||!currentUser||!pf.form) return;
    const f=pf.form, client=supabaseClient(), uidNow=currentUser.id;
    if(!client||!navigator.onLine){ showToast(INTERNET_FAILED,INTERNET_FAILED_HELP); return; }
    if(pf.loading) await pf.loading;
    if(!pf.loaded){ showToast('Still loading','Please wait a moment and try again.'); return; }
    // ---- validate ----
    const name=f.business_name.trim();
    if(!name){ showToast('Business name needed','Type your business name first.'); $('#pfName')?.focus(); return; }
    const slug=pfSlugify(f.slug);
    if(!PF_SLUG_RE.test(slug)){ showToast('Check your link name','Use 3 to 40 letters, numbers or dashes.'); $('#pfSlug')?.focus(); return; }
    const waRaw=f.whatsapp.trim(), wa=waRaw?pfWaDigits(waRaw):'';
    if(waRaw&&!wa){ showToast('Check your WhatsApp number','Enter a valid phone number, for example 0803 123 4567.'); $('#pfWhatsapp')?.focus(); return; }
    const socials={};
    for(const s of PF_SOCIALS){
      const r=pfSocialUrl(s[0],f.socials[s[0]]); if(r===null){ showToast(`Check your ${s[1]} link`,'Type @yourname or paste the full link.'); $(`[data-pf-soc="${s[0]}"]`)?.focus(); return; }
      if(r) socials[s[0]]=r;
    }
    const st=f.settings; let mapUrl='';
    if(st.mapUrl.trim()){ const r=pfSocialUrl('website',st.mapUrl); if(r===null){ pfSetTab('services'); showToast('Check your map link','Paste the full Google Maps link.'); $('#pfMapUrl')?.focus(); return; } mapUrl=r; }
    const published=!!$('#pfPublished')?.checked;
    if(published){
      if(!wa){ showToast('WhatsApp number needed','Customers order through WhatsApp. Add your number before publishing.'); $('#pfWhatsapp')?.focus(); return; }
      if(!f.works.length){ showToast('Add at least one photo','Upload a photo of your work before publishing.'); return; }
    }
    pf.saving=true; pfSetSaving(true);
    try{
      // ---- link name must be free ----
      try{ const {data:free,error:fe}=await client.rpc('portfolio_slug_available',{p_slug:slug}); if(!fe&&free===false){ showToast('Link name taken','Choose a different link name.'); pfSlugHint('That link name is already taken. Try another one.','bad'); $('#pfSlug')?.focus(); return; } }catch{}
      // ---- upload new pictures (each one is kept as soon as it is uploaded, so a retry never repeats it) ----
      const pending=f.works.filter(w=>w.url.startsWith('data:')).length+(f.logo.startsWith('data:')?1:0)+(st.hero.image.startsWith('data:')?1:0);
      let done=0;
      const send=async(dataUrl,prefix)=>{
        done++; pfSetSaving(true,`Uploading ${done} of ${pending}… `);
        let url=null;
        try{ url=await uploadToBucket(PF_BUCKET,`${uidNow}/${prefix}_${uid('f')}.jpg`,dataUrl); }catch(err){ if(err&&typeof err==='object') err.pfUpload=true; throw err; }
        if(!url){ const err=new Error('upload failed'); err.pfUpload=true; throw err; } return url;
      };
      if(f.logo.startsWith('data:')) f.logo=await send(f.logo,'logo');
      if(st.hero.image.startsWith('data:')) st.hero.image=await send(st.hero.image,'hero');
      for(const w of f.works){ if(w.url.startsWith('data:')) w.url=await send(w.url,'w'); }
      if(!currentUser||currentUser.id!==uidNow) return;
      pfSetSaving(true,'Saving… ');
      const row={user_id:uidNow,slug,business_name:name.slice(0,80),tagline:f.tagline.trim().slice(0,120),about:f.about.trim().slice(0,900),location:f.location.trim().slice(0,100),
        whatsapp:wa,logo_url:f.logo||null,socials,specialties:f.specialties.slice(0,PF_MAX_SPEC),
        works:f.works.slice(0,PF_MAX_WORKS).map(w=>({id:w.id,url:w.url,title:w.title.trim().slice(0,70),category:w.category.trim().slice(0,40),caption:w.caption.trim().slice(0,240),featured:!!w.featured})),
        published,updated_at:new Date().toISOString(),settings:pfBuildSettings(st,mapUrl)};
      let {data,error}=await client.from('tailor_portfolios').upsert(row,{onConflict:'user_id'}).select().single();
      let settingsMissing=false;
      if(error&&/settings|PGRST204|42703/.test(`${error.code||''} ${error.message||''}`)&&!isNetworkError(error)){
        // The upgrade migration has not been run yet: still save everything that was already supported.
        const {settings:_skip,...plain}=row; settingsMissing=true;
        ({data,error}=await client.from('tailor_portfolios').upsert(plain,{onConflict:'user_id'}).select().single());
      }
      if(error){
        if(error.code==='23505'){ showToast('Link name taken','Choose a different link name.'); pfSlugHint('That link name is already taken. Try another one.','bad'); return; }
        throw error;
      }
      const keepSettings=st;
      pf.form=pfFromRow(data); if(settingsMissing) pf.form.settings=keepSettings;
      pf.noSettings=settingsMissing||!('settings' in data);
      pf.saved={slug:data.slug,published:!!data.published}; pf.dirty=false; pf.loaded=true; pfNotice('');
      pfFillForm();
      if(settingsMissing) showToast('Saved without the new look','Run SUPABASE_PORTFOLIO_UPGRADE_MIGRATION.sql once in Supabase to save colours, hero photo and services.');
      else showToast(published?'Your portfolio is live':'Portfolio saved',published?'Share your link with customers on WhatsApp.':'It is hidden until you publish it.');
      pfCleanup(client,uidNow,[data.logo_url,pf.form.settings.hero.image,...(data.works||[]).map(w=>w&&w.url)]);
    }catch(e){
      console.error('SEWZA portfolio save failed:',e);
      pfRenderWorks(); pfRenderLogo(); pfRenderDesign();
      if(isNetworkError(e)) showToast(INTERNET_FAILED,INTERNET_FAILED_HELP);
      else if(/42P01|PGRST205/.test(`${e?.code||''} ${e?.message||''}`)) showToast('Portfolio is not set up yet','Run SUPABASE_PORTFOLIO_MIGRATION.sql in your Supabase SQL Editor.');
      else if(e&&e.pfUpload) showToast('Photos were not sent','Your work is kept here. Check that SUPABASE_PORTFOLIO_MIGRATION.sql was run in Supabase, then press Save again.');
      else showToast('Could not save','Please try again.');
    }finally{ pf.saving=false; pfSetSaving(false); pfRenderStatus(); }
  }

  // ----- sharing -----
  function pfShareUrl(){ return pf.saved&&pf.saved.published?pfUrl(pf.saved.slug):''; }
  function pfShareText(){ const n=(pf.form&&pf.form.business_name)||'my tailoring business'; return `Hello \u{1F44B} See the latest designs by ${n} and order directly on WhatsApp:\n${pfShareUrl()}`; }
  async function pfCopyLink(){
    const url=pfShareUrl(); if(!url) return;
    try{
      if(navigator.clipboard&&window.isSecureContext) await navigator.clipboard.writeText(url);
      else { const t=document.createElement('textarea'); t.value=url; t.setAttribute('readonly',''); t.style.cssText='position:fixed;opacity:0'; document.body.appendChild(t); t.select(); const ok=document.execCommand('copy'); document.body.removeChild(t); if(!ok) throw new Error('copy'); }
      showToast('Link copied','Paste it anywhere to share your portfolio.');
    }catch{ window.prompt('Copy your portfolio link:',url); }
  }

  // ----- settings helpers (look & feel, services, reviews) -----
  function pfBuildSettings(st,mapUrl){
    return {theme:st.theme,font:st.font,hero:{image:st.hero.image||''},slideshow:{on:!!st.slideshow.on,auto:!!st.slideshow.auto},
      chat:{on:!!st.chat.on,msg:st.chat.msg.trim().slice(0,160),bubble:st.chat.bubble.trim().slice(0,40)},banner:st.banner.trim().slice(0,140),
      services:st.services.map(x=>({id:x.id,name:x.name.trim().slice(0,60),price:x.price.trim().slice(0,30),desc:x.desc.trim().slice(0,160)})).filter(x=>x.name).slice(0,PF_MAX_SVC),
      faqs:st.faqs.map(x=>({id:x.id,q:x.q.trim().slice(0,120),a:x.a.trim().slice(0,400)})).filter(x=>x.q&&x.a).slice(0,PF_MAX_FAQ),
      hours:st.hours.trim().slice(0,200),mapUrl:mapUrl||'',show:{steps:!!st.show.steps,reviews:!!st.show.reviews}};
  }
  function pfLoadFonts(){
    if(pfLoadFonts.done) return; pfLoadFonts.done=true;
    try{ const l=document.createElement('link'); l.rel='stylesheet'; l.href='https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;0,700;1,600&family=Syne:wght@700;800&display=swap'; document.head.appendChild(l); }catch{}
  }
  function pfRenderUpgrade(){
    const el=$('#pfUpgrade'); if(!el) return;
    const need=(pf.loaded&&pf.noSettings)||pfRv.missing;
    el.hidden=!need;
    el.textContent=need?'To unlock colours, the hero photo, services and customer reviews, run SUPABASE_PORTFOLIO_UPGRADE_MIGRATION.sql once in your Supabase SQL Editor, then reopen this page. Everything else keeps working.':'';
  }

  // ----- tabs -----
  function pfSetTab(name,focusSel){
    if(!PF_TABS.includes(name)) name='profile'; pf.tab=name;
    PF_TABS.forEach(t=>{
      const on=t===name, b=$(`#pfTab-${t}`), pane=$(`#pfPane-${t}`);
      if(b){ b.setAttribute('aria-selected',on?'true':'false'); b.tabIndex=on?0:-1; }
      if(pane) pane.hidden=!on;
    });
    if(name==='design'){ pfLoadFonts(); pfRenderDesign(); }
    if(name==='reviews'){ pfLoadReviews().catch(()=>{}); }
    const active=$(`#pfTab-${name}`); active?.scrollIntoView?.({block:'nearest',inline:'center'});
    if(focusSel){ setTimeout(()=>{ const t=$(focusSel); if(t){ t.scrollIntoView({behavior:'smooth',block:'center'}); if(/^(INPUT|TEXTAREA|BUTTON)$/.test(t.tagName)) t.focus({preventScroll:true}); t.classList.add('pf2-flash'); setTimeout(()=>t.classList.remove('pf2-flash'),1500); } },60); }
  }

  // ----- setup progress -----
  function pfChecklist(){
    const f=pf.form; if(!f) return [];
    const s=f.settings;
    return [
      {t:'Business name',ok:!!f.business_name.trim(),tab:'profile',sel:'#pfName'},
      {t:'WhatsApp number',ok:!!pfWaDigits(f.whatsapp.trim()),tab:'profile',sel:'#pfWhatsapp'},
      {t:'Logo',ok:!!f.logo,tab:'profile',sel:'#pfLogo'},
      {t:'About you',ok:f.about.trim().length>=20,tab:'profile',sel:'#pfAbout'},
      {t:'3 work photos',ok:f.works.length>=3,tab:'work',sel:'#pfDrop'},
      {t:'Hero photo',ok:!!s.hero.image,tab:'design',sel:'#pfHero'},
      {t:'A service & price',ok:s.services.some(x=>x.name.trim()),tab:'services',sel:'#pfSvcAdd'},
      {t:'Publish your page',ok:!!(pf.saved&&pf.saved.published),tab:'profile',sel:'#pfPublished'}
    ];
  }
  function pfRenderProgress(){
    const box=$('#pfSetup'); if(!box||!pf.form) return;
    const list=pfChecklist(), done=list.filter(x=>x.ok).length, pct=Math.round(done/list.length*100);
    const fg=$('#pfRingFg'); if(fg) fg.style.strokeDashoffset=String(119.38*(1-pct/100));
    const pe=$('#pfRingPct'); if(pe) pe.textContent=pct+'%';
    box.classList.toggle('done',pct===100);
    const title=$('#pfSetupTitle'), sub=$('#pfSetupSub');
    if(title) title.textContent=pct===100?'Your portfolio is complete':pct>=60?'Looking good, almost there':pct>0?'Nice start, keep going':'Let’s set up your page';
    if(sub) sub.textContent=pct===100?'Customers will love what they see. Share your link!':`${done} of ${list.length} steps done. Tap a step to finish it.`;
    const todo=$('#pfTodo'); if(todo) todo.innerHTML=list.map((x,i)=>x.ok?'':`<button type="button" class="pf2-todo-chip" data-pf-goto="${i}">+ ${escapeHTML(x.t)}</button>`).join('');
  }

  // ----- look & feel -----
  function pfRenderLive(){
    const live=$('#pfLive'), f=pf.form; if(!live||!f) return;
    const th=PF_THEMES.find(x=>x.id===f.settings.theme)||PF_THEMES[0], fo=PF_FONTS.find(x=>x.id===f.settings.font)||PF_FONTS[0];
    live.style.setProperty('--n',th.c[0]); live.style.setProperty('--d',th.c[1]); live.style.setProperty('--m',th.c[2]); live.style.setProperty('--g',th.c[3]); live.style.setProperty('--ff',fo.ff);
    const nm=$('#pfLiveName'); if(nm) nm.textContent=f.business_name.trim()||'Your business';
    const tg=$('#pfLiveTag'); if(tg) tg.textContent=f.tagline.trim()||'Your tagline appears here';
    const lg=$('#pfLiveLogo'); if(lg){ if(f.logo){ lg.style.backgroundImage=`url("${f.logo}")`; lg.textContent=''; lg.classList.add('has'); } else { lg.style.backgroundImage=''; lg.classList.remove('has'); lg.textContent=(f.business_name.trim()||'S').charAt(0).toUpperCase(); } }
    const bg=live.querySelector('.pf2-live-bg'); if(bg){ const img=f.settings.hero.image||(f.works[0]&&f.works[0].url)||''; bg.style.backgroundImage=img?`url("${img}")`:''; }
    const wa=live.querySelector('.pf2-live-wa'); if(wa) wa.hidden=!f.settings.chat.on;
  }
  function pfRenderDesign(){
    const f=pf.form; if(!f) return; const s=f.settings;
    const th=$('#pfThemes'); if(th) th.innerHTML=PF_THEMES.map(t=>`<button type="button" class="pf2-theme${t.id===s.theme?' on':''}" role="radio" aria-checked="${t.id===s.theme}" data-pf-theme="${t.id}" style="--a:${t.c[0]};--b:${t.c[1]};--c:${t.c[2]};--d:${t.c[3]}"><span class="pf2-sw" aria-hidden="true"><i></i><i></i><i></i></span><b>${escapeHTML(t.name)}</b><em aria-hidden="true">✓</em></button>`).join('');
    const fo=$('#pfFonts'); if(fo) fo.innerHTML=PF_FONTS.map(x=>`<button type="button" class="pf2-font${x.id===s.font?' on':''}" role="radio" aria-checked="${x.id===s.font}" data-pf-font="${x.id}" style="--ff:${x.ff}"><span aria-hidden="true">Aa</span><b>${escapeHTML(x.name)}</b></button>`).join('');
    const hi=$('#pfHeroImg'); if(hi){ hi.style.backgroundImage=s.hero.image?`url("${s.hero.image}")`:''; hi.classList.toggle('has',!!s.hero.image); }
    const hr=$('#pfHeroRemove'); if(hr) hr.hidden=!s.hero.image;
    const chk=(id,v)=>{ const e=$(id); if(e) e.checked=!!v; }, val=(id,v)=>{ const e=$(id); if(e&&e!==document.activeElement) e.value=v; };
    chk('#pfSlideOn',s.slideshow.on); chk('#pfSlideAuto',s.slideshow.auto); chk('#pfChatOn',s.chat.on); chk('#pfShowSteps',s.show.steps); chk('#pfShowReviews',s.show.reviews);
    val('#pfBanner',s.banner); val('#pfChatBubble',s.chat.bubble); val('#pfChatMsg',s.chat.msg); val('#pfHours',s.hours); val('#pfMapUrl',s.mapUrl);
    const sa=$('#pfSlideAuto'); if(sa) sa.disabled=!s.slideshow.on;
    pfRenderLive();
  }
  async function pfSetHero(file){
    try{ pf.form.settings.hero.image=await gsCompress(file,1920,.82); pfRenderDesign(); pfMarkDirty(); }
    catch{ showToast('Could not read that picture','Try a JPG or PNG picture.'); }
  }

  // ----- services + questions -----
  function pfRenderRows(){
    const f=pf.form; if(!f) return; const s=f.settings;
    const sl=$('#pfSvcList'); if(sl) sl.innerHTML=s.services.map((x,i)=>`<div class="pf2-row" data-rid="${escapeHTML(x.id)}"><span class="pf2-row-n">${i+1}</span><div class="pf2-row-body"><div class="pf2-row-top"><input data-rf="name" type="text" maxlength="60" autocomplete="off" placeholder="Service e.g. Wedding gowns" value="${escapeHTML(x.name)}" aria-label="Service ${i+1} name"><input data-rf="price" type="text" maxlength="30" autocomplete="off" placeholder="From e.g. ₦25,000" value="${escapeHTML(x.price)}" aria-label="Service ${i+1} starting price"></div><input data-rf="desc" type="text" maxlength="160" autocomplete="off" placeholder="Short description (optional)" value="${escapeHTML(x.desc)}" aria-label="Service ${i+1} description"></div><div class="pf2-row-tools"><button type="button" data-pf-row="up" ${i===0?'disabled':''} aria-label="Move service ${i+1} up">↑</button><button type="button" data-pf-row="down" ${i===s.services.length-1?'disabled':''} aria-label="Move service ${i+1} down">↓</button><button type="button" class="pf-del" data-pf-row="del" aria-label="Delete service ${i+1}">✕</button></div></div>`).join('');
    const fl=$('#pfFaqList'); if(fl) fl.innerHTML=s.faqs.map((x,i)=>`<div class="pf2-row" data-rid="${escapeHTML(x.id)}"><span class="pf2-row-n">${i+1}</span><div class="pf2-row-body"><input data-rf="q" type="text" maxlength="120" autocomplete="off" placeholder="Question e.g. How long does it take?" value="${escapeHTML(x.q)}" aria-label="Question ${i+1}"><textarea data-rf="a" rows="2" maxlength="400" placeholder="Your answer" aria-label="Answer ${i+1}">${escapeHTML(x.a)}</textarea></div><div class="pf2-row-tools"><button type="button" data-pf-row="up" ${i===0?'disabled':''} aria-label="Move question ${i+1} up">↑</button><button type="button" data-pf-row="down" ${i===s.faqs.length-1?'disabled':''} aria-label="Move question ${i+1} down">↓</button><button type="button" class="pf-del" data-pf-row="del" aria-label="Delete question ${i+1}">✕</button></div></div>`).join('');
    const have=new Set(s.services.map(x=>x.name.trim().toLowerCase())), ss=$('#pfSvcSuggest');
    if(ss) ss.innerHTML=s.services.length>=PF_MAX_SVC?'':PF_SVC_SUGGEST.filter(x=>!have.has(x.toLowerCase())).slice(0,6).map(x=>`<button type="button" class="pf-sug" data-pf-svc-sug="${escapeHTML(x)}">+ ${escapeHTML(x)}</button>`).join('');
    const haveQ=new Set(s.faqs.map(x=>x.q.trim().toLowerCase())), fs=$('#pfFaqSuggest');
    if(fs) fs.innerHTML=s.faqs.length>=PF_MAX_FAQ?'':PF_FAQ_SUGGEST.filter(x=>!haveQ.has(x.toLowerCase())).map(x=>`<button type="button" class="pf-sug" data-pf-faq-sug="${escapeHTML(x)}">+ ${escapeHTML(x)}</button>`).join('');
    const a1=$('#pfSvcAdd'); if(a1) a1.disabled=s.services.length>=PF_MAX_SVC;
    const a2=$('#pfFaqAdd'); if(a2) a2.disabled=s.faqs.length>=PF_MAX_FAQ;
  }

  // ----- customer reviews (customers write them; the tailor can only approve, hide, reply or delete) -----
  const pfStars=n=>'★'.repeat(n)+'☆'.repeat(5-n);
  function pfRvDate(iso){ const d=new Date(iso); return isNaN(d.getTime())?'':d.toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}); }
  async function pfLoadReviews(){
    if(!currentUser||pfRv.loading) return;
    const client=supabaseClient(); if(!client||!navigator.onLine){ pfRv.error=`${INTERNET_FAILED}. ${INTERNET_FAILED_HELP}`; pfRenderReviews(); return; }
    const uidNow=currentUser.id; pfRv.loading=true; pfRenderReviews();
    try{
      const {data,error}=await client.from('portfolio_reviews').select('id,reviewer_name,rating,comment,status,owner_reply,created_at').eq('portfolio_user_id',uidNow).order('created_at',{ascending:false}).limit(200);
      if(error) throw error;
      if(!currentUser||currentUser.id!==uidNow) return;
      pfRv.items=(data||[]).map(r=>({...r,draft:r.owner_reply||''})); pfRv.missing=false; pfRv.error=''; pfRv.loaded=true;
    }catch(e){
      if(/42P01|PGRST205|portfolio_reviews/i.test(`${e?.code||''} ${e?.message||''}`)&&!isNetworkError(e)){ pfRv.missing=true; pfRv.error=''; }
      else pfRv.error=isNetworkError(e)?`${INTERNET_FAILED}. ${INTERNET_FAILED_HELP}`:'Could not load your reviews. Please try again.';
    }finally{ pfRv.loading=false; pfRenderReviews(); pfRenderUpgrade(); }
  }
  function pfRenderReviews(){
    const list=$('#pfRvList'); if(!list) return;
    const items=pfRv.items, pend=items.filter(x=>x.status==='pending').length, appr=items.filter(x=>x.status==='approved');
    const badge=$('#pfRvBadge'); if(badge){ badge.hidden=!pend; badge.textContent=String(pend); }
    const avg=appr.length?appr.reduce((n,x)=>n+x.rating,0)/appr.length:0;
    const sum=$('#pfRvSum'); if(sum) sum.innerHTML=`<div class="pf2-rv-avg"><b>${appr.length?avg.toFixed(1):'–'}</b><span class="pf2-rv-stars" aria-hidden="true">${pfStars(Math.round(avg))}</span></div><div class="pf2-rv-counts"><span><b>${appr.length}</b> showing</span><span class="${pend?'hot':''}"><b>${pend}</b> waiting</span><span><b>${items.filter(x=>x.status==='hidden').length}</b> hidden</span></div>`;
    const fl=$('#pfRvFilters'); if(fl) fl.innerHTML=[['all','All'],['pending','Waiting'],['approved','Showing'],['hidden','Hidden']].map(([k,l])=>`<button type="button" class="pf2-fchip${pfRv.filter===k?' on':''}" data-pf-rvf="${k}" aria-pressed="${pfRv.filter===k}">${l}</button>`).join('');
    const rb=$('#pfRvRefresh'); if(rb) rb.disabled=pfRv.loading;
    if(pfRv.missing){ list.innerHTML='<div class="pf2-empty"><b>Reviews are not switched on yet</b>Run SUPABASE_PORTFOLIO_UPGRADE_MIGRATION.sql once in your Supabase SQL Editor, then press Refresh.</div>'; return; }
    if(pfRv.loading&&!pfRv.loaded){ list.innerHTML='<div class="pf2-empty">Loading your reviews…</div>'; return; }
    if(pfRv.error&&!pfRv.loaded){ list.innerHTML=`<div class="pf2-empty"><b>${escapeHTML(pfRv.error)}</b>Press Refresh to try again.</div>`; return; }
    const shownItems=items.filter(x=>pfRv.filter==='all'||x.status===pfRv.filter);
    if(!shownItems.length){ list.innerHTML=`<div class="pf2-empty"><b>${items.length?'Nothing here':'No reviews yet'}</b>${items.length?'No reviews match this filter.':'Share your review link with happy customers. Their reviews will appear here for you to approve.'}</div>`; return; }
    const lab={pending:'Waiting for you',approved:'Showing on your page',hidden:'Hidden'};
    list.innerHTML=shownItems.map(x=>`<article class="pf2-rv" data-st="${escapeHTML(x.status)}" data-rvid="${escapeHTML(x.id)}"><header><span class="pf2-av" aria-hidden="true">${escapeHTML((x.reviewer_name||'?').charAt(0).toUpperCase())}</span><div><b>${escapeHTML(x.reviewer_name)}</b><small>${escapeHTML(pfRvDate(x.created_at))}</small></div><span class="pf2-rvstat">${lab[x.status]||escapeHTML(x.status)}</span></header><div class="pf2-rv-stars" role="img" aria-label="${x.rating} out of 5 stars">${pfStars(x.rating)}</div><p>${escapeHTML(x.comment||'(no comment)')}</p><label class="pf2-reply">Your reply (optional, shown under the review)<textarea data-rv-reply rows="2" maxlength="400" placeholder="Say thank you or answer a question">${escapeHTML(x.draft)}</textarea></label><div class="pf2-rv-act">${x.status==='approved'?'<button type="button" class="ghost-btn" data-pf-rv="hidden">Hide</button>':'<button type="button" class="primary-btn" data-pf-rv="approved">Approve</button>'}${x.status==='pending'?'<button type="button" class="ghost-btn" data-pf-rv="hidden">Hide</button>':''}<button type="button" class="ghost-btn" data-pf-rv="reply">Save reply</button><button type="button" class="ghost-btn pf2-danger" data-pf-rv="delete">Delete</button></div></article>`).join('');
  }
  async function pfReviewAction(id,act){
    const client=supabaseClient(); const r=pfRv.items.find(x=>x.id===id); if(!client||!r||pfRv.busy) return;
    if(!navigator.onLine){ showToast(INTERNET_FAILED,INTERNET_FAILED_HELP); return; }
    if(act==='delete'&&!window.confirm('Delete this review for good? This cannot be undone.')) return;
    pfRv.busy=id;
    try{
      let res;
      if(act==='delete') res=await client.from('portfolio_reviews').delete().eq('id',id).select('id');
      else if(act==='reply') res=await client.from('portfolio_reviews').update({owner_reply:r.draft.trim().slice(0,400)}).eq('id',id).select('id');
      else res=await client.from('portfolio_reviews').update({status:act}).eq('id',id).select('id');
      if(res.error) throw res.error;
      if(!res.data||!res.data.length) throw new Error('not allowed');
      if(act==='delete') pfRv.items=pfRv.items.filter(x=>x.id!==id);
      else if(act==='reply'){ r.owner_reply=r.draft.trim().slice(0,400); r.draft=r.owner_reply; }
      else r.status=act;
      showToast(act==='approved'?'Review is now showing':act==='hidden'?'Review hidden':act==='delete'?'Review deleted':'Reply saved',act==='approved'?'Visitors can see it on your page.':act==='hidden'?'Visitors can no longer see it.':act==='delete'?'It has been removed.':'Visitors will see your reply.');
    }catch(e){ console.warn('SEWZA review action failed:',e); showToast(isNetworkError(e)?INTERNET_FAILED:'Could not update the review',isNetworkError(e)?INTERNET_FAILED_HELP:'Please try again.'); }
    finally{ pfRv.busy=''; pfRenderReviews(); }
  }
  function pfReviewLink(){ return pfShareUrl()?pfShareUrl()+'#review':''; }
  function pfReviewText(){ const n=(pf.form&&pf.form.business_name)||'us'; return `Hello \u{1F44B} Thank you for choosing ${n}. Please take one minute to rate our work and tell others about your experience:\n${pfReviewLink()}`; }
  async function pfCopyText(text,title,msg){
    try{
      if(navigator.clipboard&&window.isSecureContext) await navigator.clipboard.writeText(text);
      else { const t=document.createElement('textarea'); t.value=text; t.setAttribute('readonly',''); t.style.cssText='position:fixed;opacity:0'; document.body.appendChild(t); t.select(); const ok=document.execCommand('copy'); document.body.removeChild(t); if(!ok) throw new Error('copy'); }
      showToast(title,msg);
    }catch{ window.prompt('Copy this link:',text); }
  }

  // ----- events -----
  function bindPortfolioSettings(){
    const panel=$('#pfPanel'); if(!panel) return;
    const st=()=>pf.form&&pf.form.settings;
    // tabs
    $('#pfTabs')?.addEventListener('click',e=>{ const b=e.target.closest?.('[data-pf-tab]'); if(b) pfSetTab(b.dataset.pfTab); });
    $('#pfTabs')?.addEventListener('keydown',e=>{
      if(!['ArrowRight','ArrowLeft','Home','End'].includes(e.key)) return;
      e.preventDefault(); let i=PF_TABS.indexOf(pf.tab);
      i=e.key==='Home'?0:e.key==='End'?PF_TABS.length-1:(i+(e.key==='ArrowRight'?1:-1)+PF_TABS.length)%PF_TABS.length;
      pfSetTab(PF_TABS[i]); $(`#pfTab-${PF_TABS[i]}`)?.focus();
    });
    $('#pfTodo')?.addEventListener('click',e=>{ const b=e.target.closest?.('[data-pf-goto]'); if(!b) return; const it=pfChecklist()[Number(b.dataset.pfGoto)]; if(it) pfSetTab(it.tab,it.sel); });
    // look & feel
    $('#pfThemes')?.addEventListener('click',e=>{ const b=e.target.closest?.('[data-pf-theme]'); if(!b||!st()) return; st().theme=b.dataset.pfTheme; pfRenderDesign(); pfMarkDirty(); });
    $('#pfFonts')?.addEventListener('click',e=>{ const b=e.target.closest?.('[data-pf-font]'); if(!b||!st()) return; st().font=b.dataset.pfFont; pfRenderDesign(); pfMarkDirty(); });
    $('#pfHeroInput')?.addEventListener('change',e=>{ const file=e.target.files?.[0]; if(file&&pf.form) pfSetHero(file).finally(()=>{ e.target.value=''; }); });
    $('#pfHeroRemove')?.addEventListener('click',()=>{ if(!st()) return; st().hero.image=''; pfRenderDesign(); pfMarkDirty(); });
    const tog=(id,fn)=>$(id)?.addEventListener('change',e=>{ if(!st()) return; fn(st(),e.target.checked); pfRenderDesign(); pfMarkDirty(); });
    tog('#pfSlideOn',(s,v)=>{ s.slideshow.on=v; }); tog('#pfSlideAuto',(s,v)=>{ s.slideshow.auto=v; }); tog('#pfChatOn',(s,v)=>{ s.chat.on=v; });
    tog('#pfShowSteps',(s,v)=>{ s.show.steps=v; }); tog('#pfShowReviews',(s,v)=>{ s.show.reviews=v; });
    const txt=(id,fn)=>$(id)?.addEventListener('input',e=>{ if(!st()) return; fn(st(),e.target.value); pfMarkDirty(); });
    txt('#pfBanner',(s,v)=>{ s.banner=v; }); txt('#pfChatBubble',(s,v)=>{ s.chat.bubble=v; }); txt('#pfChatMsg',(s,v)=>{ s.chat.msg=v; });
    txt('#pfHours',(s,v)=>{ s.hours=v; }); txt('#pfMapUrl',(s,v)=>{ s.mapUrl=v; });
    // services + questions
    const listFor=el=>el.closest('#pfFaqList')?'faqs':'services';
    const addSvc=name=>{ if(!st()||st().services.length>=PF_MAX_SVC) return; st().services.push({id:uid('s'),name:name||'',price:'',desc:''}); pfRenderRows(); pfMarkDirty(); if(!name){ const l=$$('#pfSvcList .pf2-row'); l[l.length-1]?.querySelector('input')?.focus(); } };
    const addFaq=q=>{ if(!st()||st().faqs.length>=PF_MAX_FAQ) return; st().faqs.push({id:uid('q'),q:q||'',a:''}); pfRenderRows(); pfMarkDirty(); const l=$$('#pfFaqList .pf2-row'); const r=l[l.length-1]; (q?r?.querySelector('textarea'):r?.querySelector('input'))?.focus(); };
    $('#pfSvcAdd')?.addEventListener('click',()=>addSvc(''));
    $('#pfFaqAdd')?.addEventListener('click',()=>addFaq(''));
    $('#pfSvcSuggest')?.addEventListener('click',e=>{ const b=e.target.closest?.('[data-pf-svc-sug]'); if(b) addSvc(b.dataset.pfSvcSug); });
    $('#pfFaqSuggest')?.addEventListener('click',e=>{ const b=e.target.closest?.('[data-pf-faq-sug]'); if(b) addFaq(b.dataset.pfFaqSug); });
    ['#pfSvcList','#pfFaqList'].forEach(sel=>{
      const box=$(sel); if(!box) return;
      box.addEventListener('input',e=>{ const k=e.target.dataset?.rf; if(!k||!st()) return; const id=e.target.closest('[data-rid]')?.dataset.rid; const it=st()[listFor(box)].find(x=>x.id===id); if(!it) return; it[k]=e.target.value; pfMarkDirty(); });
      box.addEventListener('click',e=>{
        const b=e.target.closest?.('[data-pf-row]'); if(!b||!st()) return; const id=b.closest('[data-rid]')?.dataset.rid; const arr=st()[listFor(box)]; const i=arr.findIndex(x=>x.id===id); if(i<0) return;
        const a=b.dataset.pfRow;
        if(a==='del') arr.splice(i,1); else if(a==='up'&&i>0) [arr[i-1],arr[i]]=[arr[i],arr[i-1]]; else if(a==='down'&&i<arr.length-1) [arr[i+1],arr[i]]=[arr[i],arr[i+1]]; else return;
        pfRenderRows(); pfMarkDirty();
      });
    });
    // reviews
    $('#pfRvFilters')?.addEventListener('click',e=>{ const b=e.target.closest?.('[data-pf-rvf]'); if(!b) return; pfRv.filter=b.dataset.pfRvf; pfRenderReviews(); });
    $('#pfRvRefresh')?.addEventListener('click',()=>{ pfLoadReviews().catch(()=>{}); });
    $('#pfRvList')?.addEventListener('input',e=>{ if(!e.target.matches?.('[data-rv-reply]')) return; const r=pfRv.items.find(x=>x.id===e.target.closest('[data-rvid]')?.dataset.rvid); if(r) r.draft=e.target.value; });
    $('#pfRvList')?.addEventListener('click',e=>{ const b=e.target.closest?.('[data-pf-rv]'); if(!b) return; const id=b.closest('[data-rvid]')?.dataset.rvid; if(id) pfReviewAction(id,b.dataset.pfRv); });
    $('#pfRvInvite')?.addEventListener('click',()=>{ const u=pfReviewLink(); if(u) window.open('https://wa.me/?text='+encodeURIComponent(pfReviewText()),'_blank','noopener'); });
    $('#pfRvCopy')?.addEventListener('click',()=>{ const u=pfReviewLink(); if(u) pfCopyText(u,'Review link copied','Send it to customers who ordered from you.'); });
    pfRenderProgress();
  }

  function bindPortfolio(){
    const panel=$('#pfPanel'); if(!panel) return;
    const text=(id,key)=>$(id)?.addEventListener('input',e=>{ if(!pf.form) return; pf.form[key]=e.target.value; pfMarkDirty(); });
    text('#pfLocation','location'); text('#pfTagline','tagline'); text('#pfAbout','about'); text('#pfWhatsapp','whatsapp');
    $('#pfName')?.addEventListener('input',e=>{
      if(!pf.form) return; pf.form.business_name=e.target.value;
      if(!pf.form.slugTouched&&!pf.saved){ pf.form.slug=pfSlugify(e.target.value); const s=$('#pfSlug'); if(s) s.value=pf.form.slug; pfCheckSlug(); }
      if(!pf.form.logo) pfRenderLogo(); pfMarkDirty();
    });
    $('#pfSlug')?.addEventListener('input',e=>{
      if(!pf.form) return; const v=e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,40);
      if(v!==e.target.value) e.target.value=v; pf.form.slug=v; pf.form.slugTouched=true; pfCheckSlug(); pfMarkDirty();
    });
    $('#pfPublished')?.addEventListener('change',()=>{ pfMarkDirty(); });
    $('#pfSocials')?.addEventListener('input',e=>{ const k=e.target.dataset?.pfSoc; if(!k||!pf.form) return; pf.form.socials[k]=e.target.value; pfMarkDirty(); });
    $('#pfLogoInput')?.addEventListener('change',e=>{ const file=e.target.files?.[0]; if(file) pfSetLogo(file).finally(()=>{ e.target.value=''; }); });
    $('#pfLogoRemove')?.addEventListener('click',()=>{ if(!pf.form) return; pf.form.logo=''; pfRenderLogo(); pfMarkDirty(); });
    const addSpec=raw=>{
      const v=String(raw||'').trim().replace(/\s+/g,' ').slice(0,40); if(!v||!pf.form) return false;
      if(pf.form.specialties.length>=PF_MAX_SPEC){ showToast('Specialty limit',`You can add up to ${PF_MAX_SPEC}.`); return false; }
      if(pf.form.specialties.some(x=>x.toLowerCase()===v.toLowerCase())) return true;
      pf.form.specialties.push(v); pfRenderSpecs(); pfMarkDirty(); return true;
    };
    $('#pfSpecAdd')?.addEventListener('click',()=>{ const i=$('#pfSpecInput'); if(i&&addSpec(i.value)) i.value=''; i?.focus(); });
    $('#pfSpecInput')?.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===','){ e.preventDefault(); const i=e.target; if(addSpec(i.value)) i.value=''; } });
    panel.addEventListener('click',e=>{
      const t=e.target instanceof Element?e.target:null; if(!t||!pf.form) return;
      const del=t.closest('[data-pf-spec-del]'); if(del){ pf.form.specialties.splice(Number(del.dataset.pfSpecDel),1); pfRenderSpecs(); pfMarkDirty(); return; }
      const sug=t.closest('[data-pf-spec-add]'); if(sug){ addSpec(sug.dataset.pfSpecAdd); return; }
      const act=t.closest('[data-pf-act]'); if(act){
        const card=act.closest('[data-wid]'); const i=pf.form.works.findIndex(w=>w.id===card?.dataset.wid); if(i<0) return;
        const a=act.dataset.pfAct, w=pf.form.works;
        if(a==='del'){ w.splice(i,1); }
        else if(a==='star'){ w[i].featured=!w[i].featured; }
        else if(a==='first'&&i>0){ w.unshift(w.splice(i,1)[0]); }
        else if(a==='left'&&i>0){ [w[i-1],w[i]]=[w[i],w[i-1]]; }
        else if(a==='right'&&i<w.length-1){ [w[i+1],w[i]]=[w[i],w[i+1]]; }
        else return;
        pfRenderWorks(); pfMarkDirty();
      }
    });
    $('#pfWorks')?.addEventListener('input',e=>{
      const k=e.target.dataset?.wf; if(!k||!pf.form) return; const card=e.target.closest('[data-wid]'); const w=pf.form.works.find(x=>x.id===card?.dataset.wid); if(!w) return;
      w[k]=e.target.value; pfMarkDirty();
    });
    $('#pfWorkInput')?.addEventListener('change',e=>{ const files=[...(e.target.files||[])]; pfAddWorks(files).finally(()=>{ e.target.value=''; }); });
    const drop=$('#pfDrop');
    if(drop){
      ['dragenter','dragover'].forEach(n=>drop.addEventListener(n,e=>{ e.preventDefault(); drop.classList.add('drag'); }));
      ['dragleave','drop'].forEach(n=>drop.addEventListener(n,e=>{ e.preventDefault(); drop.classList.remove('drag'); }));
      drop.addEventListener('drop',e=>{ const files=[...(e.dataTransfer?.files||[])]; if(files.length) pfAddWorks(files); });
    }
    $('#pfSave')?.addEventListener('click',pfSave);
    $('#pfCopy')?.addEventListener('click',pfCopyLink);
    $('#pfPreview')?.addEventListener('click',()=>{ const u=pfShareUrl(); if(u) window.open(u,'_blank','noopener'); });
    $('#pfShareWa')?.addEventListener('click',()=>{ const u=pfShareUrl(); if(u) window.open('https://wa.me/?text='+encodeURIComponent(pfShareText()),'_blank','noopener'); });
    window.addEventListener('beforeunload',e=>{ if(pf.dirty){ e.preventDefault(); e.returnValue=''; } });
    window.addEventListener('online',()=>{ if(currentUser&&$('#view-account')?.classList.contains('active')) pfEnsure().catch(()=>{}); });
    // Load the portfolio whenever the Profile page opens.
    const view=$('#view-account');
    if(view&&typeof MutationObserver!=='undefined'){
      let wasActive=view.classList.contains('active');
      new MutationObserver(()=>{ const on=view.classList.contains('active'); if(on&&!wasActive) pfEnsure().catch(e=>console.warn('SEWZA portfolio skipped:',e)); wasActive=on; }).observe(view,{attributes:true,attributeFilter:['class']});
    }
  }
  bindPortfolio();
  bindPortfolioSettings();

  gs=gsBlank();

  init();
})();
